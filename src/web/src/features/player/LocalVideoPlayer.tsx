import { Button, Select } from '../../components/ui'
import { AlertCircle, ArrowDownToLine, Film, LoaderCircle, RefreshCw } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SubtitleTrack } from '../../shared/api/types'
import type { PlaybackHandle } from '../../shared/media/types'
import { toWebVTT } from './captions'
import { useNativePlaybackClock } from './useNativePlaybackClock'
import { captureVideoFrame } from '../../shared/media/captureFrame'
import './player.css'

export interface LocalVideoSource { id: string; label: string; url: string }
export type LocalPlayerHandle = PlaybackHandle & { getSourceID?: () => string | null }
const playbackFailure = '本地文件无法播放，可能已移动或编码不受浏览器支持。可以在下载页取回文件，用系统播放器打开。'

export const LocalVideoPlayer = forwardRef<LocalPlayerHandle, {
  sources: LocalVideoSource[]; loading: boolean; error: string; captions: SubtitleTrack | null
  onPosition: (seconds: number | null) => void; onReady: (ready: boolean) => void
  onDownloads: () => void; onRefresh: () => void
  onProgress?: (position: number, duration: number, immediate?: boolean) => void; onPlaying?: (playing: boolean) => void; onEnded?: () => void; onAudioStreamChange?: (stream: MediaStream | null) => void; overlay?: ReactNode
}>(function LocalVideoPlayer({ sources, loading, error, captions, onPosition, onReady, onDownloads, onRefresh, onProgress, onPlaying, onEnded, onAudioStreamChange, overlay }, ref) {
  const video = useRef<HTMLVideoElement>(null)
  const engaged = useRef(false)
  const [chosenID, setChosenID] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const [playbackError, setPlaybackError] = useState('')
  const [seekError, setSeekError] = useState('')
  const [captionURL, setCaptionURL] = useState('')
  const source = sources.find(item => item.id === chosenID) ?? sources[0]
  // Parent reader state changes frequently while a video is playing. Keep
  // event callbacks fresh without making the source-loading effect restart.
  const callbacks = useRef({ onPosition, onReady, onProgress, onPlaying, onEnded, onAudioStreamChange })
  callbacks.current = { onPosition, onReady, onProgress, onPlaying, onEnded, onAudioStreamChange }
  useNativePlaybackClock(video, `${source?.id}:${attempt}`, onPosition)

  useEffect(() => {
    const node = video.current
    setReady(false); setPlaybackError(''); setSeekError('')
    callbacks.current.onReady(false); callbacks.current.onPosition(null)
    engaged.current = false
    callbacks.current.onPlaying?.(false)
    // StrictMode may run cleanup/setup on the same DOM node during development.
    if (node && source && node.getAttribute('src') !== source.url) { node.src = source.url; node.load() }
    // Cached media may emit metadata before this passive effect initializes.
    if (node && source && node.readyState >= 1 && !node.error) {
      setReady(true)
      callbacks.current.onReady(true)
      callbacks.current.onPosition(node.currentTime)
      try { callbacks.current.onAudioStreamChange?.((node as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.() ?? null) } catch { callbacks.current.onAudioStreamChange?.(null) }
    }
    if (node?.error && source) setPlaybackError(playbackFailure)
    return () => {
      if (node && engaged.current && node.readyState >= 1 && !node.error) callbacks.current.onProgress?.(node.currentTime, node.duration, true)
      node?.pause()
      if (node) { node.removeAttribute('src'); node.load() }
      callbacks.current.onAudioStreamChange?.(null)
      callbacks.current.onReady(false); callbacks.current.onPosition(null)
    }
  }, [source?.id, source?.url, attempt])

  useEffect(() => {
    if (!captions) { setCaptionURL(''); return }
    const url = URL.createObjectURL(new Blob([toWebVTT(captions.cues)], { type: 'text/vtt;charset=utf-8' }))
    setCaptionURL(url)
    return () => URL.revokeObjectURL(url)
  }, [captions])

  useImperativeHandle(ref, () => ({ getSourceID: () => source?.id ?? null, getAudioStream: () => {
    const node = video.current as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null
    try { return node?.captureStream?.() ?? null } catch { return null }
  }, captureFrame: () => captureVideoFrame(ready ? video.current : null), getPosition: () => { const node = video.current; return node && ready && !node.error ? node.currentTime : null }, seek: seconds => {
    const node = video.current
    if (!node || !ready || !Number.isFinite(seconds) || seconds < 0) return false
    if (Number.isFinite(node.duration) && seconds > node.duration) {
      setSeekError('这个时间超出本地视频时长，可在原视频打开该时间点。')
      return false
    }
    try {
      node.currentTime = seconds
      onPosition(node.currentTime)
      setSeekError('')
      return true
    } catch { setSeekError('暂时无法跳转，请等待视频就绪后重试。'); return false }
  } }), [ready, onPosition, source?.id])

  const report = () => { if (video.current && video.current.readyState >= 1) callbacks.current.onPosition(video.current.currentTime) }
  const checkpoint = (immediate = false) => {
    const node = video.current
    if (node && engaged.current && node.readyState >= 1 && !node.error) callbacks.current.onProgress?.(node.currentTime, node.duration, immediate)
  }
  return <section className="local-player" aria-labelledby="local-player-title">
    <div className="player-heading"><h2 id="local-player-title"><Film size={18} aria-hidden="true" />本机视频</h2><div className="player-heading-actions">{source && <Button variant="quiet" iconOnly className="icon-button" aria-label="查看下载" title="查看下载" onClick={onDownloads}><ArrowDownToLine size={16}/></Button>}<Button variant="quiet" iconOnly className="icon-button" aria-label="重新检查本地视频" title="重新检查本地视频" onClick={onRefresh} disabled={loading}><RefreshCw size={16} /></Button></div></div>
    {error && <div className="player-error" role="alert"><AlertCircle size={16} /><p>{error} 已列出的本地视频可能不是最新记录。</p></div>}
    {loading && !source && <p className="player-hint" role="status"><LoaderCircle size={16} className="spin" />正在检查已下载视频…</p>}
    {source ? <>
      {sources.length > 1 && <label className="player-source-label">本地文件<Select aria-label="选择本地视频文件" value={source.id} onChange={event => setChosenID(event.target.value)}>{sources.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></label>}
      <div className="player-capture-stage">{overlay}
      <video key={`${source.id}:${attempt}`} ref={video} className="local-video" aria-label="本地视频播放器" controls playsInline preload="metadata" src={source.url} onLoadedMetadata={() => { setReady(true); callbacks.current.onReady(true); report(); try { callbacks.current.onAudioStreamChange?.((video.current as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null)?.captureStream?.() ?? null) } catch { callbacks.current.onAudioStreamChange?.(null) } }} onTimeUpdate={() => { report(); checkpoint() }} onSeeking={() => { engaged.current = true; report() }} onSeeked={() => { report(); checkpoint(true) }} onPlay={() => { engaged.current = true; callbacks.current.onPlaying?.(true); checkpoint(true) }} onPause={() => { callbacks.current.onPlaying?.(false); checkpoint(true) }} onEnded={() => { callbacks.current.onPlaying?.(false); report(); checkpoint(true); callbacks.current.onEnded?.() }} onError={() => { setReady(false); callbacks.current.onReady(false); callbacks.current.onPosition(null); callbacks.current.onPlaying?.(false); callbacks.current.onAudioStreamChange?.(null); setPlaybackError(playbackFailure) }}>
        {captionURL && captions && <track key={captionURL} kind="captions" src={captionURL} srcLang={captions.language === 'ai-zh' ? 'zh' : captions.language} label={captions.label} default />}
        当前浏览器无法播放此视频，可在下载页取回文件。
      </video>
      </div>
      {playbackError && <div className="player-error" role="alert"><AlertCircle size={16} /><div><p>{playbackError}</p><Button variant="secondary" className="button button-secondary" onClick={() => setAttempt(value => value + 1)}>重新加载文件</Button></div></div>}
      {seekError && <p className="player-error" role="alert">{seekError}</p>}
    </> : !loading && <div className="player-empty"><p>还没有这段视频的已完成下载。</p><p>原视频可以在线打开；需要本机播放时，请主动下载。进入阅读不会自动下载。</p><Button variant="secondary" className="button button-secondary" onClick={onDownloads}>查看下载</Button></div>}
  </section>
})
