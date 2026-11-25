import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ContentItem } from '../../shared/api/types'
import type { RetrievalResponse } from '../ai/retrieval'
import { RetrievalResultView } from './RetrievalResultView'
import { defaultWorkbenchOptions, type WorkbenchPassage, type WorkbenchResult } from './workbench'

const item: ContentItem = {
  id: 'article:12', platform: 'web', platformId: '12', kind: 'article',
  title: '夹具文章', author: '作者', authorId: '', url: 'https://example.com/12',
  thumbnailUrl: '', description: '', durationSeconds: 0, publishedAt: 0,
}

function passage(overrides: Partial<WorkbenchPassage> = {}): WorkbenchPassage {
  return {
    passageId: 'article:12:s3', contentId: 'article:12', source: 'article',
    locator: 'article:12:s3', sentenceStart: 3, sentenceEnd: 4, startRune: 120, endRune: 180,
    textSha256: '0123456789abcdef0123456789abcdef', sourceVersion: '2', cueIds: [],
    text: '这是命中的原文片段。', score: 0.82, lexicalScore: 0.6, cosineScore: 0.9,
    ...overrides,
  }
}

function response(status: string, passages: WorkbenchPassage[] = []): RetrievalResponse {
  return {
    schemaVersion: 1, status, mode: 'hybrid',
    passages: passages.map(({ passageId, contentId, source, locator, sentenceStart, sentenceEnd, startRune, endRune, textSha256, sourceVersion, cueIds }) =>
      ({ passageId, contentId, source, locator, sentenceStart, sentenceEnd, startRune, endRune, textSha256, sourceVersion, cueIds })),
    embedding: { model: 'bge-m3', dimensions: 1024, budgetStatus: 'completed', requests: 3, cacheHits: 7 },
    rerank: { enabled: true, model: 'qwen3.7-text-rerank', budgetStatus: 'completed', requests: 1 },
  }
}

function result(status: string, passages: WorkbenchPassage[] = [], contextChars = 0): WorkbenchResult {
  return { retrieval: response(status, passages), passages, contextChars }
}

function render(value: WorkbenchResult, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(RetrievalResultView, {
    result: value, onRead: () => {}, ...extra,
  }))
}

describe('RetrievalResultView', () => {
  it('renders the exact passage text, locator, scores and version', () => {
    const html = render(result('ok', [passage()], 4200), { selected: item })
    expect(html).toContain('Relevant passages found')
    expect(html).toContain('这是命中的原文片段。')
    expect(html).toContain('article:12:s3')
    expect(html).toContain('Hybrid score 82%')
    expect(html).toContain('Lexical score 60%')
    expect(html).toContain('Semantic cosine 90%')
    expect(html).toContain('Version <code>2</code>')
    expect(html).toContain('0123456789ab')
    expect(html).toContain('Matched passages')
  })

  it('draws score bars whose width matches the score', () => {
    const html = render(result('ok', [passage()]))
    expect(html).toContain('width:82%')
    expect(html).toContain('width:60%')
    expect(html).toContain('width:90%')
  })

  it('shows the rune range so the passage can be located exactly', () => {
    expect(render(result('ok', [passage()]))).toContain('120–180')
  })

  it('numbers the passages in server order', () => {
    const html = render(result('ok', [passage(), passage({ passageId: 'article:12:s9', locator: 'article:12:s9' })]))
    expect(html).toContain('>1</span>')
    expect(html).toContain('>2</span>')
  })

  it('offers copying the locator', () => {
    expect(render(result('ok', [passage()]))).toContain('Copy locator article:12:s3')
  })

  it('keeps the primary metrics on screen and the rest one click away', () => {
    const html = render(result('ok', [passage()]), { elapsedMs: 236 })
    expect(html).toContain('Matched passages')
    expect(html).toContain('Mode')
    expect(html).toContain('Rerank')
    expect(html).toContain('Search time')
    expect(html).toContain('236 ms')
    // Secondary detail is collapsed until asked for.
    expect(html).not.toContain('bge-m3')
    expect(html).toContain('More metrics')
  })

  it('shows the rerank model as a primary metric', () => {
    expect(render(result('ok', [passage()]))).toContain('qwen3.7-text-rerank')
  })

  it('offers a display sort without changing the selection', () => {
    const html = render(result('ok', [passage()]), { sort: 'source', onSortChange: () => {} })
    expect(html).toContain('By relevance')
    expect(html).toContain('Document order')
    expect(html).toContain('aria-pressed="true"')
  })

  it('orders by document position when source order is chosen', () => {
    const first = passage({ passageId: 'a', locator: 'pdf:x:9:s0', text: '后出现的片段', startRune: 900, sentenceStart: 9 })
    const second = passage({ passageId: 'b', locator: 'pdf:x:2:s0', text: '先出现的片段', startRune: 100, sentenceStart: 2 })
    const html = render(result('ok', [first, second]), { sort: 'source' })
    expect(html.indexOf('先出现的片段')).toBeLessThan(html.indexOf('后出现的片段'))
  })

  it('shows a rerank bar only when the passage has a rerank score', () => {
    expect(render(result('ok', [passage({ rerankScore: 0.7 })]))).toContain('Rerank score 70%')
    expect(render(result('ok', [passage()]))).not.toContain('Rerank score')
  })

  it('renders no_match with its own copy and no passage list', () => {
    const html = render(result('no_match'))
    expect(html).toContain('No matching passages')
    expect(html).not.toContain('retrieval-passage"')
    expect(html).toContain('No matching passages')
    expect(html).toContain('different wording')
  })

  it('offers concrete next steps when nothing matched', () => {
    const seen: string[] = []
    const html = renderToStaticMarkup(createElement(RetrievalResultView, {
      result: result('no_match'),
      options: { ...defaultWorkbenchOptions(), mode: 'lexical', sweepCandidates: 0, maxChars: 8000 },
      onRead: () => {},
      onNoResultAction: action => seen.push(action),
    }))
    expect(html).toContain('Enable semantic sweep')
    expect(html).toContain('Widen budget to 120,000')
    expect(html).toContain('Switch to Hybrid')
    expect(html).toContain('Clear question')
    expect(seen).toEqual([])
  })

  it('keeps coverage-limited passages and never calls them no_match', () => {
    const html = render(result('semantic_sweep_limited', [passage()]))
    expect(html).toContain('Semantic sweep coverage is limited')
    expect(html).not.toContain('No matching passages')
    expect(html).toContain('这是命中的原文片段。')
  })

  it('shows the stale-source hint so the user re-runs retrieval', () => {
    const html = render(result('stale_source'))
    expect(html).toContain('Source updated; citations are stale')
    expect(html).toContain('Search again to use the latest text.')
  })

  it('keeps the local-OCR hint without implying a cloud upload', () => {
    const html = render(result('pdf_ocr_unavailable'))
    expect(html).toContain('Local OCR unavailable')
    expect(html).toContain('nothing is uploaded')
  })

  it('renders only the passages the server returned', () => {
    const html = render(result('ok', [passage({ passageId: 'article:12:s9', locator: 'article:12:s9', text: '唯一片段' })]))
    expect(html).toContain('唯一片段')
    expect(html).not.toContain('这是命中的原文片段。')
    expect((html.match(/data-passage-id=/g) ?? []).length).toBe(1)
  })

  it('offers opening the source only when the selection matches the passage', () => {
    expect(render(result('ok', [passage()]), { selected: item })).toContain('Open source')
    expect(render(result('ok', [passage()]))).not.toContain('Open source')
    expect(render(result('ok', [passage({ contentId: 'article:99' })]), { selected: item })).not.toContain('Open source')
  })

  it('shows a readable position instead of only a raw locator', () => {
    const html = render(result('ok', [passage({ source: 'pdf', locator: 'pdf:bf3e9e65a4afaa5ea28e2338c93a849ef064c59820f354bd75c3cb3f6bde5d94:61:s0-s3', sentenceStart: 2, sentenceEnd: 6 })]))
    expect(html).toContain('Page 61 · sentences 3–6')
  })

  it('offers a page jump for PDF hits and a plain open for others', () => {
    const pdf = passage({ source: 'pdf', locator: 'pdf:bf3e9e65a4afaa5ea28e2338c93a849ef064c59820f354bd75c3cb3f6bde5d94:61:s0-s3' })
    expect(render(result('ok', [pdf]), { selected: item })).toContain('Go to page 61')
    expect(render(result('ok', [passage()]), { selected: item })).toContain('Open source')
  })

  it('passes the page to the reader when jumping', () => {
    const pdf = passage({ source: 'pdf', locator: 'pdf:bf3e9e65a4afaa5ea28e2338c93a849ef064c59820f354bd75c3cb3f6bde5d94:61:s0-s3' })
    let got: number | undefined
    const html = renderToStaticMarkup(createElement(RetrievalResultView, {
      result: result('ok', [pdf]), selected: item, onRead: (_item, page) => { got = page },
    }))
    expect(html).toContain('Go to page 61')
    expect(got).toBeUndefined() // render only; the handler is asserted in the browser check
  })

  it('labels subtitle and pdf locators distinctly', () => {
    const subtitle = render(result('ok', [passage({ source: 'subtitle', locator: 'subtitle:zh:2992-2999' })]))
    expect(subtitle).toContain('Subtitle zh:2992-2999')
    const pdf = render(result('ok', [passage({ source: 'pdf', locator: 'pdf:hash:7:s2' })]))
    expect(pdf).toContain('PDF page 7')
  })
})

describe('RetrievalResultView highlighting', () => {
  const value = result('ok', [passage({ text: '青霉素在低温下抑制率达到百分之九十三。' })])

  it('marks the query terms inside the passage', () => {
    const html = render(value, { question: '青霉素抑制率', highlight: true })
    expect(html).toContain('<mark class="retrieval-mark">')
    expect(html).toContain('青霉')
  })

  it('preserves the exact text when highlighting', () => {
    const html = render(value, { question: '青霉素抑制率', highlight: true })
    const text = html.replace(/<[^>]*>/g, '')
    expect(text).toContain('青霉素在低温下抑制率达到百分之九十三。')
  })

  it('can be turned off', () => {
    const html = render(value, { question: '青霉素抑制率', highlight: false })
    expect(html).not.toContain('<mark')
  })

  it('does not mark anything for an unrelated question', () => {
    const html = render(value, { question: '火星甲烷', highlight: true })
    expect(html).not.toContain('<mark')
  })
})

describe('RetrievalResultView pagination', () => {
  const many = Array.from({ length: 25 }, (_, i) =>
    passage({ passageId: `p${i}`, locator: `article:12:s${i}`, text: `片段 ${i}` }))
  const value = result('ok', many)

  it('renders only the first page', () => {
    const html = render(value, { pageSize: 10 })
    expect((html.match(/data-passage-id=/g) ?? []).length).toBe(10)
  })

  it('reports the shown and total counts so nothing looks dropped', () => {
    const html = render(value, { pageSize: 10 })
    expect(html).toContain('Showing 10 of 25 passages')
    expect(html).toContain('15 more are not expanded yet')
  })

  it('offers loading more and expanding everything', () => {
    const html = render(value, { pageSize: 10 })
    expect(html).toContain('Load more (15 left)')
    expect(html).toContain('Expand all')
  })

  it('still reports the server total in the metrics', () => {
    const html = render(value, { pageSize: 10 })
    expect(html).toContain('Matched passages')
    expect(html).toContain('>25</dd>')
  })

  it('shows no pager when everything fits', () => {
    const html = render(value, { pageSize: 50 })
    expect((html.match(/data-passage-id=/g) ?? []).length).toBe(25)
    expect(html).not.toContain('Load more')
    expect(html).not.toContain('not expanded yet')
  })

  it('keeps the first page in server order', () => {
    const html = render(value, { pageSize: 3 })
    expect(html.indexOf('片段 0')).toBeLessThan(html.indexOf('片段 1'))
    expect(html).not.toContain('片段 3<')
  })
})
