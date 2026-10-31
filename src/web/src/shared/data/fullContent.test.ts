import { afterEach, expect, test, vi } from 'vitest'
import type { ContentItem } from '../api/types'
import { readFullContent } from './fullContent'

const item: ContentItem = { id: 'bilibili:dynamic:123', platform: 'bilibili', platformId: 'dynamic:123', kind: 'article', title: '完整内容', author: '作者', authorId: '', url: 'https://example.com/123', thumbnailUrl: '', description: '摘要', durationSeconds: 0, publishedAt: 0, partial: true }
const full = { ...item, partial: undefined, description: '完整正文', articleBlocks: [{ kind: 'paragraph', text: '完整正文' }] }
afterEach(() => vi.unstubAllGlobals())

test('projected recommendation reads full local data without fetching the platform', async () => {
  const fetch = vi.fn((url: string) => Promise.resolve(url.includes('/library/') ? new Response('{}', { status: 404 }) : Response.json(full)))
  vi.stubGlobal('fetch', fetch)
  expect(await readFullContent(item)).toEqual(full)
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/library/bilibili%3Adynamic%3A123', '/api/recommendations/bilibili/items/bilibili%3Adynamic%3A123'])
})

test('subscribed platform cards fall back to their full inbox copy', async () => {
  const fetch = vi.fn((url: string) => Promise.resolve(url.includes('/subscription-inbox/') ? Response.json(full) : new Response('{}', { status: 404 })))
  vi.stubGlobal('fetch', fetch)
  expect(await readFullContent(item)).toEqual(full)
  expect(fetch.mock.calls).toHaveLength(3)
})

test('full items require no additional reads and incomplete copies cannot be saved', async () => {
  const fetch = vi.fn(() => Promise.resolve(Response.json(item)))
  vi.stubGlobal('fetch', fetch)
  const complete = { ...item, partial: false }
  expect(await readFullContent(complete)).toBe(complete)
  expect(fetch).not.toHaveBeenCalled()
  await expect(readFullContent(item)).rejects.toThrow('本机完整内容暂不可用')
})

test('local read failures are not hidden by another fetch', async () => {
  const fetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 503 })))
  vi.stubGlobal('fetch', fetch)
  await expect(readFullContent(item)).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(1)
})

test.each(['library', 'recommendations', 'subscription-inbox'])('rejects another item returned by %s', async source => {
  const fetch = vi.fn((url: string) => Promise.resolve(url.includes(`/api/${source}/`)
    ? Response.json({ ...full, id: 'bilibili:dynamic:456' })
    : new Response('{}', { status: 404 })))
  vi.stubGlobal('fetch', fetch)
  await expect(readFullContent(item)).rejects.toThrow('本机完整内容暂不可用')
  expect(fetch).toHaveBeenCalledTimes(['library', 'recommendations', 'subscription-inbox'].indexOf(source) + 1)
})

test('returns a complete saved copy without reading recommendations', async () => {
  const fetch = vi.fn(() => Promise.resolve(Response.json(full)))
  vi.stubGlobal('fetch', fetch)
  expect(await readFullContent(item)).toEqual(full)
  expect(fetch).toHaveBeenCalledTimes(1)
})
