import { describe, expect, it } from 'vitest'
import { APIError } from '../../shared/api/client'
import { RETRIEVAL_SCHEMA_VERSION } from '../ai/retrieval'
import {
  MAX_CONTEXT_RUNES,
  MAX_SWEEP_CANDIDATES,
  canSearch,
  contextBudgetPresets,
  defaultWorkbenchOptions,
  highlightSegments,
  isOCRDerived,
  normalizeOptions,
  passagePage,
  passagePosition,
  pickInitialContent,
  ANSWER_MAX_CONTEXT_RUNES,
  answerBody,
  answerFromResponse,
  compactCitationIds,
  compactLocator,
  queryTerms,
  resultFromError,
  searchBody,
  workbenchScoreLabel,
  workbenchScoreWidth,
} from './workbench'

const opts = (over = {}) => ({ ...defaultWorkbenchOptions(), ...over })

describe('searchBody', () => {
  it('always enables retrieval and pins the wire schema version', () => {
    const body = searchBody('article:12', '中段的答案是什么', opts())
    expect(body.contentId).toBe('article:12')
    expect(body.question).toBe('中段的答案是什么')
    expect(body.retrieval.enabled).toBe(true)
    expect(body.retrieval.schemaVersion).toBe(RETRIEVAL_SCHEMA_VERSION)
  })

  it('trims the question and content id', () => {
    const body = searchBody('  article:12  ', '  问题  ', opts())
    expect(body.contentId).toBe('article:12')
    expect(body.question).toBe('问题')
  })

  it('forwards every per-run knob the engine honours', () => {
    const body = searchBody('a', 'q', opts({
      mode: 'lexical', maxChars: 8000, batchingMode: 'split',
      maxEmbeddingRequests: 5, maxEmbeddingChars: 20000, sweepCandidates: 30,
    }))
    expect(body.retrieval.mode).toBe('lexical')
    expect(body.retrieval.maxChars).toBe(8000)
    expect(body.retrieval.embeddingBudget).toEqual({
      batchingMode: 'split', maxRequests: 5, maxChars: 20000, sweepCandidates: 30,
    })
    // Rerank on/off is settings-owned; the request carries no override.
    expect(body.retrieval.rerankBudget.maxRequests).toBe(0)
  })

  it('sends an explicit 0 request budget as 0 (off), never as omitted', () => {
    const body = searchBody('a', 'q', opts({ maxEmbeddingRequests: 0 }))
    expect(body.retrieval.embeddingBudget.maxRequests).toBe(0)
  })

  it('omits maxRequests when the sweep is disabled so the engine keeps it off', () => {
    // The engine restores a 90-candidate sweep if a zero quota arrives with an
    // explicit request budget; omitting the budget preserves the user's choice.
    const body = searchBody('a', 'q', opts({ sweepCandidates: 0, maxEmbeddingRequests: 12 }))
    expect(body.retrieval.embeddingBudget.sweepCandidates).toBe(0)
    expect(body.retrieval.embeddingBudget.maxRequests).toBeNull()
  })
})

describe('normalizeOptions', () => {
  it('returns the labelled defaults for empty input', () => {
    expect(normalizeOptions(undefined)).toEqual(defaultWorkbenchOptions())
    expect(normalizeOptions(null)).toEqual(defaultWorkbenchOptions())
  })

  it('falls back to the default context budget when out of range', () => {
    for (const value of [0, -1, MAX_CONTEXT_RUNES + 1, Number.NaN]) {
      expect(normalizeOptions({ maxChars: value }).maxChars).toBe(120000)
    }
  })

  it('accepts the full domain context range', () => {
    expect(normalizeOptions({ maxChars: 1 }).maxChars).toBe(1)
    expect(normalizeOptions({ maxChars: MAX_CONTEXT_RUNES }).maxChars).toBe(MAX_CONTEXT_RUNES)
  })

  it('clamps negative budgets to 0 rather than inventing a default', () => {
    const value = normalizeOptions({ maxEmbeddingRequests: -5, maxEmbeddingChars: -1, sweepCandidates: -3 })
    expect(value.maxEmbeddingRequests).toBe(0)
    expect(value.maxEmbeddingChars).toBe(0)
    expect(value.sweepCandidates).toBe(0)
  })

  it('caps the sweep quota at the UI guard', () => {
    expect(normalizeOptions({ sweepCandidates: 999999 }).sweepCandidates).toBe(MAX_SWEEP_CANDIDATES)
  })

  it('only tightens request budgets against the saved ceilings', () => {
    const ceilings = { maxEmbeddingRequests: 10, maxEmbeddingChars: 50000 }
    const value = normalizeOptions({ maxEmbeddingRequests: 99, maxEmbeddingChars: 900000 }, ceilings)
    expect(value.maxEmbeddingRequests).toBe(10)
    expect(value.maxEmbeddingChars).toBe(50000)
  })

  it('keeps a tighter request budget untouched', () => {
    const ceilings = { maxEmbeddingRequests: 24, maxEmbeddingChars: 100000 }
    const value = normalizeOptions({ maxEmbeddingRequests: 3, maxEmbeddingChars: 8000 }, ceilings)
    expect(value.maxEmbeddingRequests).toBe(3)
    expect(value.maxEmbeddingChars).toBe(8000)
  })

  it('never re-enables embedding when the saved ceiling is 0', () => {
    const value = normalizeOptions({ maxEmbeddingRequests: 24 }, { maxEmbeddingRequests: 0, maxEmbeddingChars: 100000 })
    expect(value.maxEmbeddingRequests).toBe(0)
  })

  it('rejects unknown modes and batching modes', () => {
    const value = normalizeOptions({ mode: 'bogus' as never, batchingMode: 'bogus' as never })
    expect(value.mode).toBe('hybrid')
    expect(value.batchingMode).toBe('shared')
  })
})

describe('canSearch', () => {
  it('requires a content selection and a non-blank question', () => {
    expect(canSearch('article:12', '问题', false)).toBe(true)
    expect(canSearch('', '问题', false)).toBe(false)
    expect(canSearch('article:12', '   ', false)).toBe(false)
    expect(canSearch('article:12', '', false)).toBe(false)
  })

  it('blocks a second run while one is pending', () => {
    expect(canSearch('article:12', '问题', true)).toBe(false)
  })
})

describe('resultFromError', () => {
  it('recovers B\'s distinct status from a rejected request', () => {
    const error = new APIError('原文已更新，旧的引用已失效，请重新检索。', 'retrieval_stale_source', 409)
    expect(resultFromError(error)?.retrieval.status).toBe('stale_source')
  })

  it('keeps the server retrieval object when the body carries one', () => {
    const payload = {
      code: 'retrieval_no_match',
      retrieval: { schemaVersion: 1, status: 'no_match', mode: 'hybrid', passages: [], embedding: { model: 'bge-m3', dimensions: 1024, budgetStatus: 'completed', requests: 3 }, rerank: { enabled: false, model: '', budgetStatus: 'disabled', requests: 0 } },
    }
    const result = resultFromError(new APIError('未找到', 'retrieval_no_match', 200, [], payload))
    expect(result?.retrieval.embedding.requests).toBe(3)
    expect(result?.retrieval.mode).toBe('hybrid')
  })

  it('never fabricates passages for a rejection', () => {
    const result = resultFromError(new APIError('预算无效', 'retrieval_invalid_budget', 400))
    expect(result?.passages).toEqual([])
    expect(result?.retrieval.passages).toEqual([])
    expect(result?.contextChars).toBe(0)
  })

  it('returns null for unrelated failures so the UI shows the real error', () => {
    expect(resultFromError(new APIError('无法连接', 'network_error', 0))).toBeNull()
    expect(resultFromError(new APIError('未授权', 'unauthorized', 401))).toBeNull()
    expect(resultFromError(new Error('boom'))).toBeNull()
    expect(resultFromError(null)).toBeNull()
  })
})

describe('queryTerms (mirrors retrieval.QueryTerms)', () => {
  it('produces a 2-gram window over a CJK run, sorted like QueryTerms', () => {
    expect(queryTerms('抑制率')).toEqual(['制率', '抑制'])
  })

  it('keeps a single CJK character as its own term', () => {
    expect(queryTerms('酶')).toEqual(['酶'])
  })

  it('keeps Latin words whole and lowercases them', () => {
    expect(queryTerms('Penicillin DNA')).toEqual(['dna', 'penicillin'])
  })

  it('splits mixed scripts without mixing them into one term', () => {
    expect(queryTerms('青霉素 ABC')).toEqual(['abc', '霉素', '青霉'])
  })

  it('deduplicates repeated terms and ignores punctuation', () => {
    expect(queryTerms('抑制，抑制！')).toEqual(['抑制'])
    expect(queryTerms('   ')).toEqual([])
  })
})

describe('highlightSegments', () => {
  it('preserves the original text exactly', () => {
    const text = '本研究的最终结论是：青霉素在低温环境下抑制率达到百分之九十三。'
    const segments = highlightSegments(text, queryTerms('青霉素抑制率'))
    expect(segments.map(s => s.text).join('')).toBe(text)
  })

  it('marks the matched runs', () => {
    const segments = highlightSegments('青霉素抑制率', ['青霉', '霉素', '抑制', '制率'])
    expect(segments).toEqual([{ text: '青霉素抑制率', match: true }])
  })

  it('leaves unmatched text unmarked', () => {
    const segments = highlightSegments('完全无关的内容', ['青霉'])
    expect(segments).toEqual([{ text: '完全无关的内容', match: false }])
  })

  it('matches case-insensitively but keeps the original casing', () => {
    const segments = highlightSegments('Penicillin works', ['penicillin'])
    expect(segments[0]).toEqual({ text: 'Penicillin', match: true })
  })

  it('returns a single unmarked segment when there are no terms', () => {
    expect(highlightSegments('文本', [])).toEqual([{ text: '文本', match: false }])
  })

  it('handles empty text', () => {
    expect(highlightSegments('', ['x'])).toEqual([])
  })

  it('merges overlapping terms into one run', () => {
    const segments = highlightSegments('abcdef', ['abc', 'bcd', 'cde'])
    expect(segments).toEqual([{ text: 'abcde', match: true }, { text: 'f', match: false }])
  })
})

describe('answerBody', () => {
  it('reuses the search retrieval fragment so the answer is grounded in it', () => {
    const body = answerBody('article:12', '中段的答案是什么', opts(), 7)
    const search = searchBody('article:12', '中段的答案是什么', opts())
    // Same selection knobs; only the context budget may be capped for the answer.
    const { maxChars: answerChars, ...answerRest } = body.retrieval
    const { maxChars: searchChars, ...searchRest } = search.retrieval
    expect(answerRest).toEqual(searchRest)
    expect(answerChars).toBeLessThanOrEqual(searchChars)
    expect(body.contentId).toBe('article:12')
  })

  it('sends exactly one user turn with the trimmed question', () => {
    const body = answerBody('a', '  问题  ', opts(), 3)
    expect(body.messages).toEqual([{ role: 'user', content: '问题' }])
  })

  it('carries the AI configuration revision the chat endpoint requires', () => {
    expect(answerBody('a', 'q', opts(), 5).revision).toBe(5)
  })

  it('caps the answer context at the provider-safe limit', () => {
    expect(answerBody('a', 'q', opts({ maxChars: 120000 }), 1).retrieval.maxChars).toBe(ANSWER_MAX_CONTEXT_RUNES)
  })

  it('keeps a smaller search budget untouched for the answer', () => {
    expect(answerBody('a', 'q', opts({ maxChars: 8000 }), 1).retrieval.maxChars).toBe(8000)
  })
})

describe('answerFromResponse', () => {
  it('returns the last assistant message', () => {
    const raw = { messages: [
      { role: 'user', content: '问' },
      { role: 'assistant', content: '第一次回答' },
      { role: 'user', content: '再问' },
      { role: 'assistant', content: '最终回答' },
    ] }
    expect(answerFromResponse(raw)).toBe('最终回答')
  })

  it('returns null when there is no assistant turn', () => {
    expect(answerFromResponse({ messages: [{ role: 'user', content: '问' }] })).toBeNull()
  })

  it('treats a blank answer as absent rather than showing an empty reply', () => {
    expect(answerFromResponse({ messages: [{ role: 'assistant', content: '   ' }] })).toBeNull()
  })

  it('survives a malformed payload', () => {
    expect(answerFromResponse(null)).toBeNull()
    expect(answerFromResponse({})).toBeNull()
    expect(answerFromResponse({ messages: 'nope' })).toBeNull()
    expect(answerFromResponse({ messages: [null] })).toBeNull()
  })
})

describe('isOCRDerived', () => {
  it('detects an OCR-derived PDF source version', () => {
    expect(isOCRDerived([{ sourceVersion: 'pdf-sha256:abc;extractor=local-paddleocr;version=paddleocr-3.7.0' }])).toBe(true)
  })

  it('does not flag native text layers or articles', () => {
    expect(isOCRDerived([{ sourceVersion: 'pdf-sha256:abc;extractor=native;version=ledongthuc' }])).toBe(false)
    expect(isOCRDerived([{ sourceVersion: 'content-revision:1' }])).toBe(false)
    expect(isOCRDerived([])).toBe(false)
  })

  it('flags a mixed selection when any passage was recognised', () => {
    expect(isOCRDerived([
      { sourceVersion: 'content-revision:1' },
      { sourceVersion: 'pdf-sha256:x;extractor=local-paddleocr;version=v' },
    ])).toBe(true)
  })
})

describe('compactCitationIds', () => {
  const hash = 'bf3e9e65a4afaa5ea28e2338c93a849ef064c59820f354bd75c3cb3f6bde5d94'
  const id = `pdf:${hash}#pdf:${hash}:61:s0-s3:0-109`

  it('turns a composite PDF passage id into a page reference', () => {
    expect(compactCitationIds(`（見 passage id="${id}"）`)).toBe('（見 原文第61頁）')
  })

  it('handles the colon form the model also uses', () => {
    expect(compactCitationIds(`見 passage id: "${id}"`)).toBe('見 原文第61頁')
  })

  it('labels non-PDF composite ids generically', () => {
    expect(compactCitationIds(`見 passage id="article:12abc#article:12:s3-s4:10-40"`)).toContain('原文片段')
    expect(compactCitationIds(`見 passage id="subtitle:zh#subtitle:zh:1-2:0-20"`)).toContain('原文片段')
  })

  it('shortens a bare pdf locator', () => {
    expect(compactCitationIds(`來源 pdf:${hash}:7:s2。`)).toBe('來源 第7頁。')
  })

  it('leaves ordinary text untouched', () => {
    const text = '第二十五條規定居民在法律面前一律平等。'
    expect(compactCitationIds(text)).toBe(text)
  })

  it('never leaves a raw 64-character hash in the answer', () => {
    const sample = `見 passage id="${id}"，另見 pdf:${hash}:7:s2`
    expect(/[0-9a-f]{64}/.test(compactCitationIds(sample))).toBe(false)
  })
})

describe('pickInitialContent', () => {
  const items = [{ id: 'a' }, { id: 'b' }]

  it('returns empty for an empty library', () => {
    expect(pickInitialContent([], 'a')).toBe('')
  })

  it('restores the last used content when it is still present', () => {
    expect(pickInitialContent(items, 'b')).toBe('b')
  })

  it('falls back to the first item when the last one is gone', () => {
    expect(pickInitialContent(items, 'removed')).toBe('a')
  })

  it('falls back to the first item on a first visit', () => {
    expect(pickInitialContent(items, '')).toBe('a')
  })
})

describe('passage position', () => {
  const hash = 'bf3e9e65a4afaa5ea28e2338c93a849ef064c59820f354bd75c3cb3f6bde5d94'

  it('reads the PDF page from a locator', () => {
    expect(passagePage(`pdf:${hash}:61:s0-s3`)).toBe(61)
    expect(passagePage('article:12:s3')).toBeNull()
    expect(passagePage(`pdf:${hash}:0:s1`)).toBeNull()
  })

  it('labels a PDF hit with page and sentence range', () => {
    expect(passagePosition({ source: 'pdf', locator: `pdf:${hash}:61:s0-s3`, sentenceStart: 2, sentenceEnd: 6 }))
      .toBe('第 61 页 · 句 3–6')
  })

  it('labels an article hit with block and sentence range', () => {
    expect(passagePosition({ source: 'article', locator: 'article:12:s3', sentenceStart: 0, sentenceEnd: 1 }))
      .toBe('段落 12 · 句 1–1')
  })

  it('labels a subtitle hit with its cue range', () => {
    expect(passagePosition({ source: 'subtitle', locator: 'subtitle:zh:2992-2999', sentenceStart: 0, sentenceEnd: 0 }))
      .toBe('字幕 zh:2992-2999')
  })

  it('never invents a range when the server sent none', () => {
    expect(passagePosition({ source: 'pdf', locator: `pdf:${hash}:7:s2`, sentenceStart: 0, sentenceEnd: 0 }))
      .toBe('第 7 页')
  })
})

describe('presentation helpers', () => {
  it('offers the labelled default and the 8k stress budget', () => {
    const values = contextBudgetPresets.map(preset => preset.value)
    expect(values).toContain(120000)
    expect(values).toContain(8000)
    for (const preset of contextBudgetPresets) expect(preset.label).not.toBe('')
  })

  it('renders scores as stable percentages', () => {
    expect(workbenchScoreLabel(0.8234)).toBe('82%')
    expect(workbenchScoreLabel(0)).toBe('0%')
    expect(workbenchScoreLabel(1)).toBe('100%')
  })

  it('clamps out-of-range scores instead of showing nonsense', () => {
    expect(workbenchScoreLabel(-0.5)).toBe('0%')
    expect(workbenchScoreLabel(1.7)).toBe('100%')
    expect(workbenchScoreLabel(Number.NaN)).toBe('0%')
  })

  it('shortens a PDF locator without losing the page and segment', () => {
    expect(compactLocator('pdf:bf3e9e65a4afaa5ea28e2338c93a849e:60:s9-s11')).toBe('60:s9-s11')
  })

  it('leaves short locators untouched', () => {
    expect(compactLocator('article:12:s3')).toBe('article:12:s3')
    expect(compactLocator('subtitle:zh:2992-2999')).toBe('subtitle:zh:2992-2999')
    expect(compactLocator('pdf:only:two')).toBe('pdf:only:two')
  })

  it('keeps score bar widths inside the track', () => {
    expect(workbenchScoreWidth(0.5)).toBe(50)
    expect(workbenchScoreWidth(-1)).toBe(0)
    expect(workbenchScoreWidth(9)).toBe(100)
    expect(workbenchScoreWidth(Number.NaN)).toBe(0)
  })
})
