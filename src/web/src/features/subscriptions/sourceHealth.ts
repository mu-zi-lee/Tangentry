import type { SubscriptionSource } from '../../shared/api/types'

type Status = SubscriptionSource['refresh']['status']
export type HealthTone = 'healthy' | 'neutral' | 'paused' | 'attention'

export const healthLabels: Record<Status, string> = {
  healthy: '正常', never_checked: '尚未检查', stale: '长期无更新', auth_required: '需要验证', rate_limited: '请求受限', not_found: '来源不存在', upstream_error: '上游异常', paused: '已暂停',
}

export const healthTone = (status: Status): HealthTone => status === 'healthy' ? 'healthy' : status === 'never_checked' ? 'neutral' : status === 'paused' ? 'paused' : 'attention'

/** A source needs the reader's attention when it could not sync, not when it is merely quiet. */
export const needsAttention = (source: SubscriptionSource) => healthTone(source.refresh.status) === 'attention'

/** Problems first, then sources with more consecutive failures, then by name. */
export function sortByHealth(sources: SubscriptionSource[]) {
  const order = (status: Status) => status === 'healthy' ? 3 : status === 'never_checked' ? 2 : status === 'paused' ? 1 : 0
  return [...sources].sort((a, b) => order(a.refresh.status) - order(b.refresh.status) || b.refresh.failures - a.refresh.failures || a.name.localeCompare(b.name, 'zh-CN'))
}

export const refreshIntervals: [number, string][] = [[900, '15 分钟'], [1800, '30 分钟'], [3600, '1 小时'], [7200, '2 小时'], [21600, '6 小时'], [86400, '1 天'], [604800, '7 天']]

export function intervalLabel(seconds: number) {
  const known = refreshIntervals.find(([value]) => value === seconds)
  if (known) return known[1]
  if (seconds % 86400 === 0) return `${seconds / 86400} 天`
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`
}

export const refreshLabel = (source: SubscriptionSource) => source.refresh.enabled ? `每 ${intervalLabel(source.refresh.intervalSeconds)}` : '手动更新'

const absolute = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
export const formatTime = (seconds: number, empty = '尚未记录') => seconds ? absolute.format(new Date(seconds * 1000)) : empty
const compact = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
/** Month, day and time only: fits metric grids; pair with formatTime as a title. */
export const shortTime = (seconds: number, empty = '尚未记录') => seconds ? compact.format(new Date(seconds * 1000)) : empty

/** Short, scannable age for list rows; the absolute time stays available as a title. */
export function relativeTime(seconds: number, now = Date.now() / 1000, empty = '尚未更新') {
  if (!seconds) return empty
  const delta = Math.round(now - seconds)
  if (delta < 0) {
    const ahead = -delta
    if (ahead < 60) return '即将'
    if (ahead < 3600) return `${Math.round(ahead / 60)} 分钟后`
    if (ahead < 86400) return `${Math.round(ahead / 3600)} 小时后`
    return `${Math.round(ahead / 86400)} 天后`
  }
  if (delta < 60) return '刚刚'
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`
  if (delta < 86400 * 2) return '昨天'
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)} 天前`
  return formatTime(seconds, empty)
}

export type ManageFilter = 'all' | 'attention' | 'automatic' | 'manual'
export function matchesManageFilter(source: SubscriptionSource, filter: ManageFilter) {
  if (filter === 'attention') return needsAttention(source)
  if (filter === 'automatic') return source.refresh.enabled
  if (filter === 'manual') return !source.refresh.enabled
  return true
}
