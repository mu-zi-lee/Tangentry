import { Button } from '../../components/ui'
import { AlertCircle, Clock3, RefreshCw, RotateCcw } from 'lucide-react'
import type { useReadingProgress } from './useReadingProgress'
import './progress.css'

function clock(value: number) {
  const total = Math.floor(value)
  const seconds = String(total % 60).padStart(2, '0')
  const minutes = String(Math.floor(total / 60) % 60).padStart(2, '0')
  return total >= 3600 ? `${Math.floor(total / 3600)}:${minutes}:${seconds}` : `${minutes}:${seconds}`
}

export function ReadingProgressPanel({ progress, ready, playing, position, onSeek }: {
  progress: ReturnType<typeof useReadingProgress>; ready: boolean; playing: boolean; position: number | null
  onSeek: (seconds: number) => void
}) {
  const saved = progress.saved
  const liveDuration = saved?.durationSeconds ?? 0
  const livePosition = position !== null && Number.isFinite(position) && position >= 0 ? position : null
  const displayPosition = livePosition ?? saved?.positionSeconds ?? 0
  const reachedEnd = Boolean(saved?.completed && livePosition !== null && liveDuration > 0 && livePosition >= liveDuration - 0.05)
  const hasUnsavedPosition = !reachedEnd && livePosition !== null && (!saved || Math.abs(livePosition - saved.positionSeconds) > 0.05)
  const headline = reachedEnd ? '上次已看到结尾' : livePosition !== null && liveDuration > 0 ? `${playing || hasUnsavedPosition ? '当前位置' : '已保存位置'} ${clock(displayPosition)} / ${clock(liveDuration)}` : saved ? saved.completed ? '上次已看到结尾' : `已保存位置 ${clock(saved.positionSeconds)} / ${clock(saved.durationSeconds)}` : progress.loading ? '正在读取阅读进度…' : '播放后会记住当前位置。'
  const offer = saved && saved.positionSeconds > 0 && !saved.completed && !playing && (position === null || Math.abs(position - saved.positionSeconds) > .5)
  return <section className="reading-progress" data-playing={playing ? 'true' : undefined} aria-label="阅读进度">
    <div className="progress-header"><div className="progress-caption"><Clock3 size={15} aria-hidden="true" /><span>{headline}</span></div>{progress.saving && <span className="visually-hidden" role="status">正在保存当前位置…</span>}<div className="progress-controls">
      {offer && <Button variant="quiet" className="text-button progress-resume" disabled={!ready || progress.loading || Boolean(progress.readError)} onClick={() => onSeek(saved.positionSeconds)}>继续到 {clock(saved.positionSeconds)}</Button>}
      {(offer || saved?.completed && !playing) && <Button variant="quiet" iconOnly className="icon-button" aria-label="从头开始" title="从头开始" disabled={!ready || progress.loading || Boolean(progress.readError)} onClick={() => onSeek(0)}><RotateCcw size={15} aria-hidden="true" /></Button>}
      <Button variant="quiet" iconOnly className="icon-button" aria-label="重新读取阅读进度" title={progress.saving ? '正在保存当前位置' : '重新读取阅读进度'} disabled={progress.loading || progress.saving} onClick={() => void progress.reload()}><RefreshCw size={15} className={progress.loading || progress.saving ? 'spin' : undefined} aria-hidden="true" /></Button></div></div>
    <progress value={liveDuration > 0 ? displayPosition : 0} max={liveDuration > 0 ? liveDuration : 1} aria-label={hasUnsavedPosition ? '当前位置' : '已保存阅读进度'} />
    {progress.readError && <p className="progress-error" role="alert"><AlertCircle size={15} />{progress.readError} 当前播放不受影响，自动保存暂不可用。</p>}
    {progress.writeError && <div className="progress-error" role="alert"><AlertCircle size={15} /><div><p>{progress.writeError} 上次成功记录仍保留。</p><Button variant="secondary" className="button button-secondary" disabled={progress.loading || progress.saving} onClick={() => void progress.retry()}>保存本页当前位置</Button></div></div>}
  </section>
}
