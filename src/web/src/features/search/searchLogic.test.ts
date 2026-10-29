import { describe, expect, test } from 'vitest'
import { appendSearchItems, buildSearchParams, creatorPlatformSupport, groupSearchResults, mergeSearchItems } from './searchLogic'

describe('unified search grouping', () => {
  test('groups sources and removes duplicate cards for mixed mode', () => {
    const result = { query: '测试', local: { items: [{ id: 'a', publishedAt: 1 } as any], total: 1, counts: {} }, sources: { bilibili: { page: { platform: 'bilibili', items: [{ id: 'a', publishedAt: 1 } as any, { id: 'b', publishedAt: 3 } as any], hasMore: false } } } }
    const groups = groupSearchResults(result, { bilibili: 'B站' })
    expect(groups.map(group => group.title)).toEqual(['本机资料库与订阅', 'B站'])
    expect(mergeSearchItems(groups).map(item => item.id)).toEqual(['b', 'a'])
  })

  test('appends only unseen cards', () => {
    expect(appendSearchItems([{ id: 'a' } as any], [{ id: 'a' } as any, { id: 'b' } as any, { id: 'b' } as any]).map(item => item.id)).toEqual(['a', 'b'])
  })

  test('keeps a failed platform group visible without cards', () => {
    const result = { query: '测试', local: { items: [], total: 0, counts: {} }, sources: { youtube: { page: { platform: 'youtube', items: [], hasMore: false }, error: 'YouTube 暂时不可用' } } }
    expect(groupSearchResults(result, { youtube: 'YouTube' })).toEqual([{ key: 'youtube', title: 'YouTube', items: [], error: 'YouTube 暂时不可用' }])
  })

  test('builds stable filter parameters and omits empty filters', () => {
    expect(buildSearchParams(' 编译器 ', { platform: 'youtube', kind: 'video', from: 100, to: 200, cursor: 'next page' }).toString()).toBe('q=+%E7%BC%96%E8%AF%91%E5%99%A8+&platform=youtube&kind=video&from=100&to=200&cursor=next+page')
    expect(buildSearchParams('测试').toString()).toBe('q=%E6%B5%8B%E8%AF%95')
  })

  test('exposes creator view and subscription support by platform', () => {
    expect(creatorPlatformSupport('bilibili')).toEqual({ view: true, subscribe: true })
    expect(creatorPlatformSupport('youtube')).toEqual({ view: true, subscribe: true })
    expect(creatorPlatformSupport('linuxdo')).toEqual({ view: true, subscribe: false })
    expect(creatorPlatformSupport('xiaoyuzhou')).toEqual({ view: true, subscribe: false })
    expect(creatorPlatformSupport('douyin')).toEqual({ view: false, subscribe: false })
  })
})
