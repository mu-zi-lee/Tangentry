import { useSubtitleAssistance } from './useSubtitleAssistance'
import { useFrameCapture } from './useFrameCapture'
import { PlayerCaptureOverlay, ReaderCaptureAction } from '../features/player/CaptureButton'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { ContentItem, SubtitleAvailability, SubtitleTrack, SubtitleReference } from '../shared/api/types'
import { SubtitlePage } from '../features/subtitles/SubtitlePage'
import { NotesPanel } from '../features/notes/NotesPanel'
import type { NoteTarget } from '../features/notes/NotesPanel'
import { OnlineVideoPlayer } from '../features/player/OnlineVideoPlayer'
import { LocalVideoPlayer } from '../features/player/LocalVideoPlayer'
import type { LocalPlayerHandle, LocalVideoSource } from '../features/player/LocalVideoPlayer'
import { useReadingProgress } from '../features/progress/useReadingProgress'
import { ReadingProgressPanel } from '../features/progress/ReadingProgressPanel'
import { usePlaybackPosition } from '../features/player/usePlaybackPosition'
import { useSyncReaderPlayback } from '../shared/reader/ReaderActions'
import { AIInsights } from '../features/ai/AIInsights'
import { useSummary } from '../features/ai/useSummary'
import { SummaryControl } from '../features/ai/SummaryControl'
import { summaryTextFallback } from '../features/ai/summaryPresentation'
import { ReaderActions } from '../shared/reader/ReaderActions'

// Composition belongs to app: playback, subtitles and notes communicate through
// callbacks/contracts without importing each other's feature implementations.
export function ReadingWorkspace({ query, linkedNoteId, initialItem, onReturn, sources, loading, error, onDownloads, onRefresh }: {
  query: string; linkedNoteId?: string; initialItem?: ContentItem; onReturn: () => void; sources: LocalVideoSource[]
  loading: boolean; error: string; onDownloads: () => void; onRefresh: () => void
}) {
  const player = useRef<LocalPlayerHandle>(null)
  const sequence = useRef(0)
  const [target, setTarget] = useState<NoteTarget | null>(null)
  const [position, setPosition] = usePlaybackPosition()
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  useSyncReaderPlayback(playing)
  const progress = useReadingProgress(`bilibili:${query}`)
  const [captions, setCaptions] = useState<SubtitleTrack | null>(null)
  const [subtitleStatus, setSubtitleStatus] = useState<SubtitleAvailability | 'available' | 'login_required' | null>(null)
  const [videoItem, setVideoItem] = useState(initialItem)
  const seek = useCallback((seconds: number) => player.current?.seek(seconds) ?? false, [])
  const assistance = useSubtitleAssistance(`bilibili:${query}`, captions, ready ? seek : undefined, { contentId: `bilibili:${query}`, title: initialItem?.title, url: initialItem?.url ?? `https://www.bilibili.com/video/${query}/` })
  const trustedCaptions = captions?.mismatch ? undefined : captions ?? undefined
  const noSubtitleSummary = useSummary(`bilibili:${query}`, 'subtitle', trustedCaptions, ready ? seek : undefined, captions ? undefined : summaryTextFallback(videoItem?.description, initialItem?.description))
  const getPosition = useCallback(() => player.current?.getPosition() ?? null, [])
  const getDownloadID = useCallback(() => player.current?.getSourceID?.() ?? null, [])
  const capture = useCallback(() => player.current?.captureFrame?.(), [])
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null)
  const onAudioStreamChange = useCallback((stream: MediaStream | null) => setAudioStream(stream), [])
  const captureFrame = useFrameCapture(capture, captions)
  const captureAction = useRef<(() => void) | null>(null)
  const requestScreenshot = useCallback(() => captureAction.current?.(), [])
  const noteAt = useCallback((positionSeconds: number, subtitleReference?: SubtitleReference) => setTarget({ contentId: `bilibili:${query}`, positionSeconds, subtitleReference, token: ++sequence.current }), [query])
  const notes = useMemo(() => <NotesPanel contentId={`bilibili:${query}`} linkedNoteId={linkedNoteId} target={target} subtitleTrack={captions} captureActionRef={captureAction} getPosition={getPosition} getDownloadID={sources.length ? getDownloadID : undefined} captureFrame={captureFrame} playbackPosition={position} playbackHint="开始写笔记时自动关联当前播放时间。" onSeek={ready ? seek : undefined} />, [query, linkedNoteId, target, captions, ready, seek, getPosition, getDownloadID, captureFrame, sources.length, position])
  const summaryEmptyMessage = subtitleStatus === 'login_required' ? 'B站提示读取字幕需要登录，请先去账号设置登录 B站后再摘要。' : subtitleStatus === 'api_empty' ? 'B站返回的字幕轨道没有字幕地址。请先去账号设置配置或登录 B站，或改用转录。' : subtitleStatus === 'error' ? 'B站字幕接口读取失败，请在字幕区重试后再摘要。' : subtitleStatus === 'rate_limited' ? 'B站暂时限制访问，请稍后重试后再摘要。' : subtitleStatus === 'ai_mismatch' ? '当前 AI 字幕与标题相关性较低，可能只是标题未在开头口播；字幕仍可查看，也可先转录后摘要。' : subtitleStatus === 'none' ? '第一分 P 没有可用字幕，可以直接转录再摘要。' : undefined
  const toolbarSummary = !assistance ? <ReaderActions><SummaryControl summary={noSubtitleSummary} source={{contentId: `bilibili:${query}`, title: initialItem?.title, url: initialItem?.url ?? `https://www.bilibili.com/video/${query}/`}} emptyMessage={summaryEmptyMessage}/></ReaderActions> : null
  return <>{toolbarSummary}<SubtitlePage query={query} initialItem={initialItem} onItem={setVideoItem} onReturn={onReturn} notes={notes} insights={assistance ? <AIInsights summary={assistance.summary} onSeek={ready ? seek : undefined} contentId={`bilibili:${query}`} context={!captions?.mismatch && captions?.cues.map(cue => cue.text).join('\n') || videoItem?.description || ''} revision={assistance.summary.inspection?.settings.revision ?? 0}/> : undefined} position={position} ended={ended} onSeek={ready ? seek : undefined} onTrackChange={setCaptions} onAvailabilityChange={setSubtitleStatus} assistance={assistance} onNoteAt={noteAt} audioStream={audioStream} player={<>
    <ReaderCaptureAction onCapture={requestScreenshot}/>
    <ReadingProgressPanel progress={progress} ready={ready} playing={playing} position={position} onSeek={seek} />
    {!loading&&sources.length===0?<OnlineVideoPlayer captions={captions} ref={player} onPosition={setPosition} onReady={setReady} onProgress={progress.observe} onPlaying={value => { setPlaying(value); if (value) setEnded(false) }} onEnded={() => setEnded(true)} onAudioStreamChange={onAudioStreamChange} platform="bilibili" id={query} title={videoItem?.title??query} cover={videoItem?.thumbnailUrl} overlay={<PlayerCaptureOverlay onCapture={requestScreenshot}/>}/>:<LocalVideoPlayer ref={player} sources={sources} loading={loading} error={error} captions={captions} onPosition={setPosition} onReady={setReady} onDownloads={onDownloads} onRefresh={onRefresh} onProgress={progress.observe} onPlaying={value => { setPlaying(value); if (value) setEnded(false) }} onEnded={() => setEnded(true)} onAudioStreamChange={onAudioStreamChange} overlay={<PlayerCaptureOverlay onCapture={requestScreenshot}/>} />}
  </>} /></>
}
