import { describe, expect, test } from 'vitest'
import { detectSource } from './SourceComposer'

describe('detectSource', () => {
  test('recognizes supported pasted links and identifiers', () => {
    expect(detectSource('https://www.youtube.com/watch?v=abc')).toBe('youtube')
    expect(detectSource('BV1xx411c7mD')).toBe('bilibili')
    expect(detectSource('https://example.com/feed.xml')).toBe('rss')
    expect(detectSource('https://arxiv.org/abs/2401.12345')).toBe('paper')
    expect(detectSource('https://example.com/report.pdf')).toBe('pdf')
  })

  test('returns null for unsupported or empty input', () => {
    expect(detectSource('')).toBeNull()
    expect(detectSource('just some words')).toBeNull()
  })
})
