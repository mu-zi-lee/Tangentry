import { expect, test } from 'vitest'
import type { ContentItem } from '../shared/api/types'
import { creatorReturnFromPath, navigateBack, readerPath, readerPathForItem, resolveViewportTarget, routeKey, type ViewportSnapshot } from './navigation'

const item = (overrides: Partial<ContentItem>): ContentItem => ({
  id: 'bilibili:dynamic:123', platform: 'bilibili', platformId: 'dynamic:123', kind: 'article',
  title: '动态', author: 'UP主', authorId: '1', url: 'https://www.bilibili.com/opus/123', thumbnailUrl: '', description: '', durationSeconds: 0, publishedAt: 0,
  ...overrides,
})

test('B站视频使用 video 查询参数，其他动态使用 contentId', () => {
  expect(readerPathForItem(item({ id: 'bilibili:BV1abCDefgH1', platformId: 'BV1abCDefgH1', kind: 'video' }))).toBe('/reader?video=BV1abCDefgH1')
  expect(readerPathForItem(item({ id: 'bilibili:dynamic:video-like', platformId: 'dynamic:video-like', kind: 'video' }))).toBe('/reader?contentId=bilibili%3Adynamic%3Avideo-like')
  expect(readerPathForItem(item({}))).toBe('/reader?contentId=bilibili%3Adynamic%3A123')
})

test('动态内容的笔记链接不会被误判为视频', () => {
  expect(readerPath('bilibili:dynamic:123', '0123456789abcdef0123456789abcdef')).toBe('/reader?contentId=bilibili%3Adynamic%3A123&note=0123456789abcdef0123456789abcdef')
  expect(readerPath('bilibili:BV1abCDefgH1')).toBe('/reader?video=BV1abCDefgH1')
})

test('有匹配的应用内来源时返回完整路径并 pop', () => {
  expect(navigateBack({
    currentPath: '/reader?video=BV1source',
    source: { path: '/search?q=设计#results', view: 'search', top: 482, sourceID: 'bilibili:BV1source' },
    hasMatchingHistoryEntry: true,
    fallback: { path: '/', view: 'discovery' },
  })).toEqual({
    action: 'pop',
    path: '/search?q=%E8%AE%BE%E8%AE%A1#results',
    restore: { top: 482, sourceID: 'bilibili:BV1source', focusID: '' },
  })
})

test('来源存在但历史前项不匹配时 replace 来源，不新增重复历史', () => {
  expect(navigateBack({
    currentPath: '/reader?contentId=article:1',
    source: { path: '/subscriptions?view=weekly&mode=history#health', view: 'subscriptions', top: 96, sourceID: 'article:1' },
    hasMatchingHistoryEntry: false,
    fallback: { path: '/', view: 'discovery', top: 12 },
  })).toMatchObject({
    action: 'replace',
    path: '/subscriptions?view=weekly&mode=history#health',
    restore: { top: 96, sourceID: 'article:1', focusID: '' },
  })
})

test('没有来源时回到应用内 fallback，并保留 fallback 恢复目标', () => {
  expect(navigateBack({
    currentPath: '/reader?video=direct',
    source: null,
    hasMatchingHistoryEntry: true,
    fallback: { path: '/', view: 'discovery', top: 731, sourceID: 'card:direct' },
  })).toEqual({
    action: 'replace',
    path: '/',
    restore: { top: 731, sourceID: 'card:direct', focusID: '' },
  })
})

test('非法或外部来源不会把返回带出应用', () => {
  expect(navigateBack({
    currentPath: '/reader?contentId=direct',
    source: { path: 'https://example.invalid/leave-app', top: 30, sourceID: 'external' },
    hasMatchingHistoryEntry: true,
    fallback: { path: '/search?q=安全', view: 'search', top: 14, sourceID: 'search-card' },
  })).toEqual({
    action: 'replace',
    path: '/search?q=%E5%AE%89%E5%85%A8',
    restore: { top: 14, sourceID: 'search-card', focusID: '' },
  })
})

test('显式 push fallback 时输出 push，默认恢复目标规范化', () => {
  expect(navigateBack({
    currentPath: '/creator',
    source: null,
    hasMatchingHistoryEntry: false,
    fallback: { path: '/library', view: 'library', top: -20, sourceID: '' },
    fallbackAction: 'push',
  })).toEqual({
    action: 'push',
    path: '/library',
    restore: { top: 0, sourceID: '', focusID: '' },
  })
})

test('来源与当前路径相同时不 pop 当前历史项', () => {
  expect(navigateBack({
    currentPath: '/search?q=同一页',
    source: { path: '/search?q=同一页', view: 'search', top: 20, sourceID: 'same' },
    hasMatchingHistoryEntry: true,
    fallback: { path: '/', view: 'discovery', top: 4 },
  })).toEqual({
    action: 'replace',
    path: '/',
    restore: { top: 4, sourceID: '', focusID: '' },
  })
})

test('路由快照键保留 query 与 hash，同视图切换不会碰撞', () => {
  expect(routeKey('/search?q=设计#results')).toBe('/search?q=%E8%AE%BE%E8%AE%A1#results')
  expect(routeKey('/search?q=设计#filters')).not.toBe(routeKey('/search?q=设计#results'))
})

test('按完整路由读取滚动与焦点快照，缺失时使用 fallback', () => {
  const snapshots = new Map<string, ViewportSnapshot>([['/search?q=设计#results', {
    view: 'search', routeKey: '/search?q=设计#results', top: 288, sourceID: 'card:1', focusID: 'card-open-1',
  }]])
  const fallback = { top: 0, sourceID: '', focusID: '', routeKey: '/search' }
  expect(resolveViewportTarget('/search?q=设计#results', snapshots, fallback)).toEqual({ top: 288, sourceID: 'card:1', focusID: 'card-open-1', routeKey: '/search?q=%E8%AE%BE%E8%AE%A1#results' })
  expect(resolveViewportTarget('/search?q=其他', snapshots, fallback)).toEqual({ ...fallback, routeKey: '/search?q=%E5%85%B6%E4%BB%96' })
})

test('返回保留来源焦点，并按规范化路由判断当前页是否相同', () => {
  expect(navigateBack({
    currentPath: '/search?q=%E8%AE%BE%E8%AE%A1#results',
    source: { path: '/search?q=设计#results', top: 8, sourceID: 'card:1', focusID: 'open-card-1' },
    hasMatchingHistoryEntry: true,
    fallback: { path: '/', top: 0 },
  })).toMatchObject({ action: 'replace', path: '/', restore: { top: 0, sourceID: '', focusID: '' } })

  expect(navigateBack({
    currentPath: '/reader?contentId=article%3A1',
    source: { path: '/search?q=设计#results', top: 8, sourceID: 'card:1', focusID: 'open-card-1' },
    hasMatchingHistoryEntry: true,
    fallback: { path: '/', top: 0 },
  })).toMatchObject({ action: 'pop', path: '/search?q=%E8%AE%BE%E8%AE%A1#results', restore: { top: 8, sourceID: 'card:1', focusID: 'open-card-1' } })
})

test('恢复目标清理负数、无穷值和非字符串焦点', () => {
  const fallback = { top: Number.POSITIVE_INFINITY, sourceID: 12 as unknown as string, focusID: 99 as unknown as string, routeKey: '/search' }
  expect(resolveViewportTarget('/search', new Map(), fallback)).toEqual({ top: 0, sourceID: '', focusID: '', routeKey: '/search' })
  expect(navigateBack({
    currentPath: '/reader',
    source: { path: '/search?q=x', top: -10, sourceID: 'card:x', focusID: 'focus-x' },
    hasMatchingHistoryEntry: false,
    fallback: { path: '/' },
  })).toMatchObject({ restore: { top: 0, sourceID: 'card:x', focusID: 'focus-x' } })
})

test('非法 fallback 降级到发现页时不携带外部恢复目标', () => {
  expect(navigateBack({
    currentPath: '/reader',
    source: null,
    hasMatchingHistoryEntry: false,
    fallback: { path: 'https://example.invalid/outside', top: 900, sourceID: 'external-card', focusID: 'external-focus' },
  })).toEqual({ action: 'replace', path: '/', restore: { top: 0, sourceID: '', focusID: '' } })
})

test('创作者返回目标按来源页面生成路径、视图和中文按钮文案', () => {
  expect(creatorReturnFromPath('/reader?contentId=article%3A1#notes')).toEqual({ path: '/reader?contentId=article%3A1#notes', view: 'reader', label: '返回阅读' })
  expect(creatorReturnFromPath('/?topic=技术&platform=bilibili&q=AI')).toEqual({ path: '/?topic=%E6%8A%80%E6%9C%AF&platform=bilibili&q=AI', view: 'discovery', label: '返回发现' })
  expect(creatorReturnFromPath('/search?q=AI&mode=mixed')).toEqual({ path: '/search?q=AI&mode=mixed', view: 'search', label: '返回搜索' })
  expect(creatorReturnFromPath('/subscriptions?mode=history')).toEqual({ path: '/subscriptions?mode=history', view: 'subscriptions', label: '返回' })
  expect(creatorReturnFromPath('https://example.invalid/outside')).toEqual({ path: '/search', view: 'search', label: '返回搜索' })
})
