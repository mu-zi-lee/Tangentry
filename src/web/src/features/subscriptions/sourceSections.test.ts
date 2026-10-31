import { describe, expect, it } from 'vitest'
import type { SubscriptionGroup, SubscriptionSource } from '../../shared/api/types'
import { sourceSections, unresolvedSectionID, visibleSourceIDs } from './sourceSections'

const source = (id: string, name: string, groupId = ''): SubscriptionSource => ({
  id: `bilibili:creator:${id}`, creatorId: id, name, groupId, url: '', createdAt: 0, lastUpdatedAt: 0, sourceTitle: '', itemCount: 0, total: 0, hasMore: false, active: false,
  refresh: { enabled: id !== '3', intervalSeconds: 3600, lastAttemptAt: 0, lastFailureAt: 0, lastCheckedAt: 0, nextCheckAt: 0, failures: 0, status: 'healthy', contentRevision: 0 },
})
const group = (id: string, name: string): SubscriptionGroup => ({ id, name, createdAt: 0, revision: 1 })

describe('source sections', () => {
  const groups = [group('g1', '科技'), group('g2', '空分组')]
  const sources = [source('1', '知识视频', 'g1'), source('2', '日常'), source('3', '游戏', 'g1'), source('4', '待读取', 'g9')]

  it('keeps group order, then ungrouped, then sources whose group is unknown', () => {
    const sections = sourceSections(sources, groups)
    expect(sections.map(section => [section.id, section.kind, section.members.length])).toEqual([['g1', 'group', 2], ['g2', 'group', 0], ['', 'ungrouped', 1], [unresolvedSectionID, 'unresolved', 1]])
    expect(visibleSourceIDs(sections)).toEqual(['bilibili:creator:1', 'bilibili:creator:3', 'bilibili:creator:2', 'bilibili:creator:4'])
  })

  it('matches by source name, platform label or group name without hiding members', () => {
    const byGroup = sourceSections(sources, groups, '科技')
    expect(byGroup[0].visible.map(item => item.name)).toEqual(['知识视频', '游戏'])
    expect(byGroup[0].members).toHaveLength(2)
    expect(visibleSourceIDs(sourceSections(sources, groups, 'uid 2'))).toEqual(['bilibili:creator:2'])
  })

  it('applies an extra predicate such as a status filter', () => {
    const manual = sourceSections(sources, groups, '', item => !item.refresh.enabled)
    expect(visibleSourceIDs(manual)).toEqual(['bilibili:creator:3'])
  })
})
