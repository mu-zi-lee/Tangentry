import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RetrievalStatus } from './RetrievalStatus'
import type { RetrievalResponse } from './retrieval'

function response(status: string, withPassage = false): RetrievalResponse {
  return {
    schemaVersion: 1, status, mode: 'hybrid',
    passages: withPassage ? [{
      passageId: 'rss:x#article:0:s0:0-5', contentId: 'rss:x', source: 'article',
      locator: 'article:0:s0', sentenceStart: 0, sentenceEnd: 1, startRune: 0, endRune: 5,
      textSha256: 'a'.repeat(64), sourceVersion: 'content-revision:1', cueIds: [],
    }] : [],
    embedding: { model: 'bge-m3', dimensions: 1024, budgetStatus: 'completed', requests: 2 },
    rerank: { enabled: false, model: '', budgetStatus: 'disabled', requests: 0 },
  }
}

describe('RetrievalStatus (B-T25 / B-T05)', () => {
  it('renders nothing without a response', () => {
    expect(renderToStaticMarkup(createElement(RetrievalStatus, { response: null }))).toBe('')
  })

  it('renders an explicit no-match marker with no passage chips (B-T05)', () => {
    const html = renderToStaticMarkup(createElement(RetrievalStatus, { response: response('no_match') }))
    expect(html).toContain('未找到')
    expect(html).toContain('data-status="no_match"')
    expect(html).not.toContain('ai-retrieval-chip')
  })

  it('renders semantic_sweep_limited as a coverage limitation, keeping passages (B-T25)', () => {
    const html = renderToStaticMarkup(createElement(RetrievalStatus, { response: response('semantic_sweep_limited', true) }))
    expect(html).toContain('data-status="semantic_sweep_limited"')
    expect(html).toContain('覆盖')
    expect(html).not.toContain('data-status="no_match"')
    expect(html).toContain('ai-retrieval-chip') // valid passages not suppressed
    expect(html).toContain('rss:x#article:0:s0:0-5')
  })

  it('renders PDF extracting/no-text states with a retry hint', () => {
    const extracting = renderToStaticMarkup(createElement(RetrievalStatus, { response: response('pdf_extracting') }))
    expect(extracting).toContain('提取中')
    expect(extracting).toContain('重试')
    const noText = renderToStaticMarkup(createElement(RetrievalStatus, { response: response('pdf_no_text') }))
    expect(noText).toContain('OCR')
  })

  it('renders distinct error copy for invalid budget', () => {
    const html = renderToStaticMarkup(createElement(RetrievalStatus, { response: response('invalid_budget') }))
    expect(html).toContain('预算无效')
    expect(html).toContain('ai-retrieval-error')
  })
})