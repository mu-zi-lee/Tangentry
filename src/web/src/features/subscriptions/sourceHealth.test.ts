import { describe, expect, it } from 'vitest'
import type { SubscriptionSource } from '../../shared/api/types'
import { healthTone, intervalLabel, matchesManageFilter, needsAttention, refreshLabel, relativeTime, sortByHealth } from './sourceHealth'

const source = (id: string, status: SubscriptionSource['refresh']['status'], extra: Partial<SubscriptionSource['refresh']> = {}, name = id): SubscriptionSource => ({
  id, creatorId: id, name, groupId: '', url: '', createdAt: 0, lastUpdatedAt: 0, sourceTitle: '', itemCount: 0, total: 0, hasMore: false, active: false,
  refresh: { enabled: true, intervalSeconds: 3600, lastAttemptAt: 0, lastFailureAt: 0, lastCheckedAt: 0, nextCheckAt: 0, failures: 0, status, contentRevision: 0, ...extra },
})

describe('source health', () => {
  it('separates quiet sources from sources that cannot sync', () => {
    expect(['healthy', 'never_checked', 'paused'].map(status => needsAttention(source('a', status as SubscriptionSource['refresh']['status'])))).toEqual([false, false, false])
    expect(['stale', 'auth_required', 'rate_limited', 'not_found', 'upstream_error'].every(status => healthTone(status as SubscriptionSource['refresh']['status']) === 'attention')).toBe(true)
  })

  it('orders problems first, then by consecutive failures and name', () => {
    const sorted = sortByHealth([source('ok', 'healthy'), source('new', 'never_checked'), source('limited', 'rate_limited', { failures: 1 }), source('missing', 'not_found', { failures: 4 })])
    expect(sorted.map(item => item.id)).toEqual(['missing', 'limited', 'new', 'ok'])
  })

  it('labels refresh policies and filters the manager list', () => {
    expect(intervalLabel(900)).toBe('15 分钟')
    expect(intervalLabel(7200)).toBe('2 小时')
    expect(intervalLabel(3 * 86400)).toBe('3 天')
    expect(intervalLabel(2700)).toBe('45 分钟')
    expect(refreshLabel(source('a', 'healthy'))).toBe('每 1 小时')
    expect(refreshLabel(source('b', 'healthy', { enabled: false }))).toBe('手动更新')
    const manual = source('m', 'healthy', { enabled: false })
    const failing = source('f', 'upstream_error')
    expect([manual, failing].filter(item => matchesManageFilter(item, 'manual')).map(item => item.id)).toEqual(['m'])
    expect([manual, failing].filter(item => matchesManageFilter(item, 'attention')).map(item => item.id)).toEqual(['f'])
    expect([manual, failing].filter(item => matchesManageFilter(item, 'automatic')).map(item => item.id)).toEqual(['f'])
  })

  it('describes ages briefly for list rows', () => {
    const now = 1_800_000_000
    expect(relativeTime(0, now)).toBe('尚未更新')
    expect(relativeTime(now - 20, now)).toBe('刚刚')
    expect(relativeTime(now - 5 * 60, now)).toBe('5 分钟前')
    expect(relativeTime(now - 3 * 3600, now)).toBe('3 小时前')
    expect(relativeTime(now - 30 * 3600, now)).toBe('昨天')
    expect(relativeTime(now - 4 * 86400, now)).toBe('4 天前')
    expect(relativeTime(now + 2 * 3600, now)).toBe('2 小时后')
  })
})
