import { describe, expect, it } from 'vitest'
import { retrievalStatusView, isCoverageLimited, passageChipLabel, hasPassages } from './retrievalPresentation'
import type { RetrievalPassageRef, RetrievalResponse } from './retrieval'

function passage(overrides: Partial<RetrievalPassageRef> = {}): RetrievalPassageRef {
  return {
    passageId: 'rss:x#article:0:s0:0-5', contentId: 'rss:x', source: 'article',
    locator: 'article:0:s0', sentenceStart: 0, sentenceEnd: 1, startRune: 0, endRune: 5,
    textSha256: 'a'.repeat(64), sourceVersion: 'content-revision:1', cueIds: [],
    ...overrides,
  }
}

function response(status: string, passages: RetrievalPassageRef[] = []): RetrievalResponse {
  return {
    schemaVersion: 1, status, mode: 'hybrid', passages,
    embedding: { model: 'bge-m3', dimensions: 1024, budgetStatus: 'completed', requests: 1 },
    rerank: { enabled: false, model: '', budgetStatus: 'disabled', requests: 0 },
  }
}

describe('retrievalStatusView (B-T25)', () => {
  it('gives each status distinct copy and tone', () => {
    const statuses = ['ok', 'lexical_only', 'semantic_sweep_limited', 'no_match', 'no_verified_passages', 'stale_source', 'invalid_budget', 'context_budget_exceeded', 'pdf_extracting', 'pdf_no_text', 'pdf_ocr_unavailable', 'pdf_extract_failed']
    const labels = new Set(statuses.map(s => retrievalStatusView(s).label))
    expect(labels.size).toBe(statuses.length) // all distinct
    expect(retrievalStatusView('invalid_budget').tone).toBe('error')
    expect(retrievalStatusView('no_match').tone).toBe('info')
  })

  it('renders semantic_sweep_limited as a coverage limitation, never no_match (B-T25)', () => {
    const view = retrievalStatusView('semantic_sweep_limited')
    expect(view.label).not.toBe(retrievalStatusView('no_match').label)
    expect(view.label).toContain('覆盖')
    expect(isCoverageLimited('semantic_sweep_limited')).toBe(true)
    expect(isCoverageLimited('no_match')).toBe(false)
    expect(view.tone).toBe('warning')
  })

  it('offers a retry/setup hint for PDF states', () => {
    expect(retrievalStatusView('pdf_extracting').hint).toContain('重试')
    expect(retrievalStatusView('pdf_no_text').hint).toContain('OCR')
    expect(retrievalStatusView('pdf_ocr_unavailable').hint).toContain('云端')
  })
})

describe('no_match rendering (B-T05)', () => {
  it('shows an explicit no-match marker with zero passages', () => {
    const r = response('no_match', [])
    expect(retrievalStatusView(r.status).label).toContain('未找到')
    expect(hasPassages(r)).toBe(false)
  })
})

describe('passage chips', () => {
  it('renders stable locator labels per source kind', () => {
    expect(passageChipLabel(passage())).toContain('段落')
    expect(passageChipLabel(passage({ source: 'subtitle', locator: 'subtitle:zh:2992-2999' }))).toContain('2992-2999')
    expect(passageChipLabel(passage({ source: 'pdf', locator: 'pdf:' + 'a'.repeat(64) + ':50:s0' }))).toContain('50')
    expect(passageChipLabel(passage({ source: 'discussion', locator: 'discussion:1:0:s0' }))).toContain('讨论')
  })

  it('keeps passages for a coverage-limited response (not suppressed)', () => {
    const r = response('semantic_sweep_limited', [passage()])
    expect(hasPassages(r)).toBe(true)
    expect(isCoverageLimited(r.status)).toBe(true)
    expect(r.status).not.toBe('no_match')
  })
})