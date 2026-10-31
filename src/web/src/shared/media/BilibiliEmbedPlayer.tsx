import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { PlaybackHandle } from './types'
import { captureDisplayedElement } from './captureFrame'

// A user-installed bridge may supply the real clock. Without it the official
// embed only supports URL seeking, and must never fabricate playback time.
export const BilibiliEmbedPlayer = forwardRef<PlaybackHandle, {
  id: string; title: string; start?: number; autoplay?: boolean
  onPosition?: (seconds: number | null) => void; onReady?: (ready: boolean) => void
  onSeekTarget?: (seconds: number) => void
  onProgress?: (position: number, duration: number, immediate?: boolean) => void
  onPlaying?: (playing: boolean) => void
}>(function BilibiliEmbedPlayer({ id, title, start = 0, autoplay = true, onPosition, onReady, onSeekTarget, onProgress, onPlaying }, ref) {
  const [target, setTarget] = useState({ seconds: Math.max(0, Math.floor(start)), revision: 0 })
  const frame = useRef<HTMLIFrameElement>(null)
  const token = useRef('')
  const clock = useRef<{ position: number; duration: number; paused: boolean; at: number } | null>(null)
  const engaged = useRef(false)
  const seekPending = useRef<{ target: number; at: number } | null>(null)
  const sequence = useRef(-1)
  const callbacks = useRef({ onPosition, onReady, onProgress, onPlaying })
  useLayoutEffect(() => { callbacks.current = { onPosition, onReady, onProgress, onPlaying } }, [onPosition, onReady, onProgress, onPlaying])
  const [connected, setConnected] = useState(false)
  const valid = /^BV[0-9A-Za-z]{10}$/.test(id)
  const freshClock = () => clock.current && performance.now() - clock.current.at < 2500 ? clock.current : null
  const getPosition = () => !seekPending.current ? freshClock()?.position ?? null : null
  useImperativeHandle(ref, () => ({
    getPosition,
    // The capture action lives outside the iframe, so Bilibili's hover controls
    // are not active. Keep the full rectangle so bottom-edge subtitles/danmu
    // are not accidentally lost to a fixed-height crop.
    captureFrame: () => captureDisplayedElement(frame.current, getPosition(), 0),
    seek: seconds => {
      if (!valid || !Number.isFinite(seconds) || seconds < 0) return false
      if (freshClock() && clock.current) {
        if (seconds > clock.current.duration) return false
        seekPending.current = { target: seconds, at: performance.now() }
        onPosition?.(null)
        engaged.current = true
        frame.current?.contentWindow?.postMessage({ type: 'tangentry:bilibili:seek', id, token: token.current, position: seconds }, 'https://player.bilibili.com')
        onSeekTarget?.(seconds)
        return true
      }
      setTarget(value => ({ seconds: Math.floor(seconds), revision: value.revision + 1 }))
      onSeekTarget?.(Math.floor(seconds))
      return true
    },
  }), [valid, id, onPosition, onSeekTarget])
  useEffect(() => {
    token.current = crypto.randomUUID()
    clock.current = null; engaged.current = false; seekPending.current = null; sequence.current = -1; setConnected(false)
    if (!valid) { callbacks.current.onReady?.(false); callbacks.current.onPosition?.(null); return }
    let timer: number | undefined
    const stop = () => { window.clearTimeout(timer); timer = undefined }
    const schedule = (delay: number) => {
      stop()
      if (!document.hidden) timer = window.setTimeout(connect, delay)
    }
    const connect = () => {
      stop()
      if (document.hidden) return
      if (freshClock()) { schedule(2500); return }
      if (clock.current && !freshClock()) {
        clock.current = null; seekPending.current = null; setConnected(false); callbacks.current.onPosition?.(null); callbacks.current.onPlaying?.(false)
      }
      frame.current?.contentWindow?.postMessage({ type: 'tangentry:bilibili:connect', token: token.current, id }, 'https://player.bilibili.com')
      schedule(1000)
    }
    const message = (event: MessageEvent) => {
      if (event.origin !== 'https://player.bilibili.com' || event.source !== frame.current?.contentWindow) return
      const data = event.data
      if (!data || data.type !== 'tangentry:bilibili:clock' || data.token !== token.current || data.id !== id ||
        !Number.isFinite(data.position) || !Number.isFinite(data.duration) || data.duration <= 0 || data.duration > 604800 ||
        data.position < 0 || data.position > data.duration || typeof data.paused !== 'boolean' ||
        !Number.isSafeInteger(data.sequence) || data.sequence <= sequence.current) return
      sequence.current = data.sequence
      // Clock messages act as the heartbeat; only reconnect when they stop.
      if (data.seeking === true) { clock.current = null; callbacks.current.onPosition?.(null); return }
      const previous = clock.current
      clock.current = { position: data.position, duration: data.duration, paused: data.paused, at: performance.now() }
      setConnected(true)
      callbacks.current.onPlaying?.(!data.paused)
      if (!data.paused) engaged.current = true
      const moved = !previous || Math.abs(previous.position - data.position) > 0.05
      const request = seekPending.current
      const acknowledged = Boolean(request && Math.abs(data.position - request.target) <= 0.25)
      if (acknowledged || request && performance.now() - request.at > 3000) seekPending.current = null
      callbacks.current.onPosition?.(seekPending.current ? null : data.position)
      const immediate = Boolean(previous && previous.paused !== data.paused || data.ended || acknowledged)
      if (!seekPending.current && engaged.current && (moved || immediate)) callbacks.current.onProgress?.(data.position, data.duration, immediate)
    }
    const visibility = () => { if (document.hidden) stop(); else connect() }
    window.addEventListener('message', message)
    document.addEventListener('visibilitychange', visibility)
    connect()
    callbacks.current.onPosition?.(null); callbacks.current.onReady?.(valid)
    return () => {
      stop(); window.removeEventListener('message', message)
      document.removeEventListener('visibilitychange', visibility)
      if (getPosition() !== null && clock.current && engaged.current && !seekPending.current) callbacks.current.onProgress?.(clock.current.position, clock.current.duration, true)
      clock.current = null
      callbacks.current.onReady?.(false); callbacks.current.onPosition?.(null); callbacks.current.onPlaying?.(false)
    }
  }, [id, valid, target.revision])
  if (!valid) return <p role="alert">视频地址无效。</p>
  return <div className="bilibili-embed">
    <iframe ref={frame} key={target.revision} className="platform-video" title={'B站官方播放器 ' + title}
      src={`https://player.bilibili.com/player.html?bvid=${id}&page=1&high_quality=1&qn=80&autoplay=${autoplay ? 1 : 0}&t=${target.seconds}`}
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>
    <p className="field-hint" role="status">{connected ? '官方播放器时间已同步' : <>可跳转字幕时间。实时关联笔记需在支持用户脚本的浏览器安装 <a href="/bilibili-sync.user.js" target="_blank" rel="noreferrer">B站同步脚本</a>，安装后刷新本页。</>}</p>
  </div>
})
