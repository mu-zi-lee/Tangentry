import { describe, expect, it } from 'vitest'
import { defaultWorkbenchOptions } from './workbench'
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, defaultPrefs, paginate, parsePrefs, serializePrefs } from './workbenchPrefs'

describe('parsePrefs', () => {
  it('returns the defaults for a missing value', () => {
    expect(parsePrefs(null)).toEqual(defaultPrefs())
  })

  it('opens the guide on first visit and keeps advanced closed', () => {
    expect(defaultPrefs().guideOpen).toBe(true)
    expect(defaultPrefs().advancedOpen).toBe(false)
  })

  it('renders a bounded first page by default', () => {
    expect(defaultPrefs().pageSize).toBe(DEFAULT_PAGE_SIZE)
    expect(DEFAULT_PAGE_SIZE).toBeLessThan(100)
  })

  it('falls back to defaults on corrupt JSON', () => {
    expect(parsePrefs('{not json')).toEqual(defaultPrefs())
    expect(parsePrefs('[]')).toEqual(defaultPrefs())
    expect(parsePrefs('null')).toEqual(defaultPrefs())
    expect(parsePrefs('42')).toEqual(defaultPrefs())
  })

  it('round-trips a stored value', () => {
    const prefs = { ...defaultPrefs(), guideOpen: false, advancedOpen: true, settingsOpen: true, highlight: false, pageSize: 50, recent: [{ contentId: 'a', question: 'q' }], sort: 'source' as const }
    expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs)
  })

  it('normalizes stored options instead of trusting them', () => {
    const raw = JSON.stringify({ options: { maxChars: 0, mode: 'bogus', maxEmbeddingRequests: -3 } })
    const prefs = parsePrefs(raw)
    expect(prefs.options.maxChars).toBe(120000)
    expect(prefs.options.mode).toBe('hybrid')
    expect(prefs.options.maxEmbeddingRequests).toBe(0)
  })

  it('ignores unknown keys', () => {
    expect(parsePrefs(JSON.stringify({ bogus: 1, guideOpen: false })).guideOpen).toBe(false)
  })

  it('falls back for wrongly typed flags', () => {
    const prefs = parsePrefs(JSON.stringify({ guideOpen: 'yes', highlight: 1 }))
    expect(prefs.guideOpen).toBe(true)
    expect(prefs.highlight).toBe(true)
  })

  it('only accepts the offered page sizes', () => {
    for (const size of PAGE_SIZES) expect(parsePrefs(JSON.stringify({ pageSize: size })).pageSize).toBe(size)
    for (const size of [0, -1, 7, 1000, '20', null]) {
      expect(parsePrefs(JSON.stringify({ pageSize: size })).pageSize).toBe(DEFAULT_PAGE_SIZE)
    }
  })

  it('keeps a partial value usable', () => {
    const prefs = parsePrefs(JSON.stringify({ highlight: false }))
    expect(prefs.highlight).toBe(false)
    expect(prefs.options).toEqual(defaultWorkbenchOptions())
  })
})

describe('recent searches and sort preference', () => {
  it('drops malformed recent entries instead of trusting storage', () => {
    const prefs = parsePrefs(JSON.stringify({ recent: [{ contentId: 'a', question: 'ok' }, { contentId: 1 }, null, 'x'] }))
    expect(prefs.recent).toEqual([{ contentId: 'a', question: 'ok' }])
  })

  it('caps the stored list at five', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ contentId: 'a', question: `q${i}` }))
    expect(parsePrefs(JSON.stringify({ recent: many })).recent).toHaveLength(5)
  })

  it('falls back to relevance order for an unknown sort', () => {
    expect(parsePrefs(JSON.stringify({ sort: 'weird' })).sort).toBe('relevance')
    expect(parsePrefs(JSON.stringify({ sort: 'source' })).sort).toBe('source')
  })
})

describe('paginate', () => {
  const passages = Array.from({ length: 100 }, (_, i) => ({ id: i }))

  it('renders only the first page', () => {
    const result = paginate(passages, 10)
    expect(result.visible).toHaveLength(10)
    expect(result.remaining).toBe(90)
  })

  it('reports no remainder when everything fits', () => {
    expect(paginate(passages.slice(0, 5), 10)).toEqual({ visible: passages.slice(0, 5), remaining: 0 })
  })

  it('never discards passages silently', () => {
    for (const size of PAGE_SIZES) {
      const result = paginate(passages, size)
      expect(result.visible.length + result.remaining).toBe(passages.length)
    }
  })

  it('can show everything at once', () => {
    expect(paginate(passages, 100).remaining).toBe(0)
  })

  it('falls back for a bad page size', () => {
    for (const size of [0, -5, Number.NaN]) {
      expect(paginate(passages, size).visible).toHaveLength(DEFAULT_PAGE_SIZE)
    }
  })

  it('handles an empty result', () => {
    expect(paginate([], 10)).toEqual({ visible: [], remaining: 0 })
  })
})
