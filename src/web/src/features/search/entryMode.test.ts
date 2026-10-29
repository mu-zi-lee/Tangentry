import { describe, expect, test } from 'vitest'
import { searchEntryMode } from './entryMode'

describe('searchEntryMode', () => {
  test('keeps a bare search route focused on adding content', () => {
    expect(searchEntryMode('')).toBe('add')
    expect(searchEntryMode('?mode=add')).toBe('add')
  })

  test('opens unified search for query routes and explicit search mode', () => {
    expect(searchEntryMode('?q=rust')).toBe('search')
    expect(searchEntryMode('?creator=123&creatorPlatform=bilibili')).toBe('search')
    expect(searchEntryMode('?mode=search')).toBe('search')
  })
})
