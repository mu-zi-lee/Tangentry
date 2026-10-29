import { expect, test } from 'vitest'
import type { DiscoveryBatchItem } from '../../shared/api/types'
import { appendDiscoveryBatch, appendDiscoveryItems, buildDiscoveryBatchParams, buildDiscoveryTopicParam, createDiscoveryBatchSession, discoveryBatchStopped, discoveryBottomState, discoveryReasonType, discoverySourceLabel, hasDiscoveryContinuation, isDiscoverySessionStale, readDiscoveryFilterState, restoreDiscoveryBatchSession, shouldRequestDiscoveryNextBatch, updateDiscoveryFilterState } from './useDiscoveryBatch'

function entry(id: string, source = 'bilibili', reason = '来源更新'): DiscoveryBatchItem {
  return {
    item: {
      id, platform: source, platformId: id, kind: 'video', title: id, author: '作者', authorId: 'author',
      url: `https://example.com/${id}`, thumbnailUrl: '', description: '', durationSeconds: 0, publishedAt: 1,
    },
    source, reason, carriedOver: false,
  }
}

test('appends cursor items in order and removes duplicate content IDs', () => {
  const current = [entry('a'), entry('b')]
  const next = [entry('b', 'youtube'), entry('c')]
  expect(appendDiscoveryItems(current, next).map(value => value.item.id)).toEqual(['a', 'b', 'c'])
  expect(current).toHaveLength(2)
})

test('merges cursor response metadata while keeping accumulated items', () => {
  const first = { batchId: 'batch', items: [entry('a')], hasNextBatch: true, nextCursor: 'cursor-2', reason: 'x', sourceStatus: { bilibili: { status: 'ok' } } }
  const second = { batchId: 'batch', items: [entry('a'), entry('b')], hasNextBatch: false, reason: 'y', sourceStatus: { youtube: { status: 'ok' } } }
  const merged = appendDiscoveryBatch(first, second)
  expect(merged.items.map(value => value.item.id)).toEqual(['a', 'b'])
  expect(merged.hasNextBatch).toBe(false)
  expect(merged.sourceStatus).toEqual({ bilibili: { status: 'ok' }, youtube: { status: 'ok' } })
  expect(first.items).toHaveLength(1)
})

test('builds topic and cursor parameters without exposing finite-batch controls', () => {
  expect(buildDiscoveryTopicParam('  科技  ')).toBe('科技')
  expect(buildDiscoveryTopicParam('  ')).toBeUndefined()
  expect(buildDiscoveryBatchParams({ view: 'wander', topic: ' 科技 ', source: '  ' }, 'next', 7, ['a', 'a', ''])).toEqual({
    view: 'wander', topic: '科技', cursor: 'next', seed: 7, unreadIds: ['a'],
  })
})

test('maps source and reason to compact Chinese labels', () => {
  expect(discoverySourceLabel('subscriptions')).toBe('我的订阅')
  expect(discoverySourceLabel('bilibili')).toBe('B站推荐')
  expect(discoverySourceLabel('unknown')).toBe('unknown 推荐')
  expect(discoverySourceLabel('youtube', '少量随机探索')).toBe('陌生探索')
})

test('maps backend reasons to discovery badge types', () => {
  expect(discoveryReasonType('subscriptions', '最近更新')).toBe('订阅')
  expect(discoveryReasonType('bilibili', '订阅优先')).toBe('订阅')
  expect(discoveryReasonType('youtube', '少量随机探索')).toBe('探索')
  expect(discoveryReasonType('linuxdo', '平台首页推荐')).toBe('推荐')
})

test('restores a discovery session without sharing mutable response arrays', () => {
  const session = createDiscoveryBatchSession({ view: 'wander', topic: '科技', source: '' }, 42)
  session.batch = { batchId: 'batch', items: [entry('a')], hasNextBatch: true, nextCursor: 'cursor', reason: '最近更新', sourceStatus: {} }
  session.cursor = 'cursor'
  session.unreadIds = ['a']
  session.lastLoadedAt = 100
  const restored = restoreDiscoveryBatchSession(session)
  expect(restored).not.toBe(session)
  expect(restored?.batch?.items).not.toBe(session.batch.items)
  expect(restored?.options.topic).toBe('科技')
  expect(restored?.cursor).toBe('cursor')
  expect(isDiscoverySessionStale(100, 100 + 29 * 60 * 1000)).toBe(false)
  expect(isDiscoverySessionStale(100, 100 + 30 * 60 * 1000)).toBe(true)
})

test('keeps discovery source and topic filters in the session', () => {
  updateDiscoveryFilterState({ platform: 'linuxdo', topic: '技术' })
  expect(readDiscoveryFilterState()).toMatchObject({ platform: 'linuxdo', topic: '技术' })
  updateDiscoveryFilterState({ platform: 'all', topic: '' })
})

test('keeps a refreshed batch pageable only when both continuation fields exist', () => {
  const next = { batchId: 'batch', items: [entry('a')], hasNextBatch: true, nextCursor: 'cursor', reason: 'x', sourceStatus: {} }
  expect(hasDiscoveryContinuation(next)).toBe(true)
  expect(discoveryBatchStopped(next)).toBe(false)
  expect(discoveryBatchStopped({ ...next, nextCursor: '' })).toBe(true)
  expect(discoveryBatchStopped({ ...next, hasNextBatch: false })).toBe(true)
})

test('maps discovery load-more states and preserves backend end reasons', () => {
  const batch = { batchId: 'batch', items: [entry('a')], hasNextBatch: false, endReason: '部分来源暂不可用（youtube），暂时没有更多了', reason: 'x', sourceStatus: {} }
  expect(discoveryBottomState('', false, batch, 1)).toEqual({ kind: 'ended', message: batch.endReason })
  expect(discoveryBottomState('', false, { ...batch, items: [] }, 0)).toEqual({ kind: 'ended', message: batch.endReason })
  expect(discoveryBottomState('', false, batch, 0)).toEqual({ kind: 'filtered', message: '当前筛选没有匹配的内容，请调整筛选条件。' })
  expect(discoveryBottomState('', false, { ...batch, hasNextBatch: true, nextCursor: 'next' }, 0)).toEqual({ kind: 'filtered', message: '当前筛选没有匹配的内容，请调整筛选条件。' })
  expect(discoveryBottomState('请求失败', false, batch, 1)).toEqual({ kind: 'error', message: '请求失败' })
  expect(discoveryBottomState('', true, batch, 1)).toEqual({ kind: 'loading' })
  expect(discoveryBottomState('', false, { ...batch, hasNextBatch: true, nextCursor: 'next' }, 1)).toEqual({ kind: 'more' })
  expect(discoveryBottomState('', false, null, 0)).toEqual({ kind: 'empty' })
})

test('guards duplicate sentinel intersections while a cursor request is in flight', () => {
  const session = createDiscoveryBatchSession()
  session.batch = { batchId: 'batch', items: [entry('a')], hasNextBatch: true, nextCursor: 'next', reason: 'x', sourceStatus: {} }
  expect(shouldRequestDiscoveryNextBatch(true, session)).toBe(true)
  session.loading = true
  expect(shouldRequestDiscoveryNextBatch(true, session)).toBe(false)
  session.loading = false
  session.stopped = true
  expect(shouldRequestDiscoveryNextBatch(true, session)).toBe(false)
})
