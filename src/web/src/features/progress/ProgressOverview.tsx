import type { ReadingProgress } from '../../shared/api/types'
import { formatDuration } from '../../shared/ui/ContentCard'

export function CardProgress({ progress, supported }: { progress: ReadingProgress | null | undefined; supported: boolean }) {
  const label = !supported ? '暂不支持播放进度' : progress === undefined ? '进度暂不可用' : !progress || progress.positionSeconds === 0 ? '未开始' : progress.completed ? '看到结尾' : `进行中 · ${formatDuration(progress.positionSeconds)} / ${formatDuration(progress.durationSeconds)}`
  return <span className="card-progress"><span>{label}</span>{progress && progress.positionSeconds > 0 && <progress aria-label="已保存播放进度" value={progress.positionSeconds} max={progress.durationSeconds} />}</span>
}
