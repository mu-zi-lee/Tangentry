import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RetrievalAnswer } from './RetrievalAnswer'
import type { WorkbenchPassage } from './workbench'

function passage(over: Partial<WorkbenchPassage> = {}): WorkbenchPassage {
  return {
    passageId: 'pdf:abc#pdf:abc:61:s0-s3:0-109',
    contentId: 'pdf:abc', source: 'pdf', locator: 'pdf:abc:61:s0-s3',
    sentenceStart: 0, sentenceEnd: 2, startRune: 0, endRune: 60,
    textSha256: 'h', sourceVersion: 'v', cueIds: [],
    text: '第二十五條香港居民在法律面前一律平等。',
    score: 0.9, lexicalScore: 0.8, cosineScore: 0.85,
    ...over,
  }
}

const render = (over: Partial<React.ComponentProps<typeof RetrievalAnswer>> = {}) =>
  renderToStaticMarkup(createElement(RetrievalAnswer, {
    question: '香港居民在法律面前一律平等吗',
    answer: '第二十五條規定居民在法律面前一律平等。',
    passages: [passage()],
    maxContextRunes: 60000,
    pending: false,
    error: '',
    onSettings: () => {},
    onJump: () => {},
    ...over,
  }))

describe('RetrievalAnswer', () => {
  it('renders the answer with its question', () => {
    const html = render()
    expect(html).toContain('Answer from the sources')
    expect(html).toContain('法律面前一律平等')
    expect(html).toContain('香港居民在法律面前一律平等吗')
  })

  it('attaches the exact position to the paragraph it came from', () => {
    const html = render()
    expect(html).toContain('retrieval-answer-citation')
    expect(html).toContain('Page 61 · sentences 1–2')
  })

  it('gives each paragraph its own citation', () => {
    const second = passage({
      passageId: 'pdf:abc#pdf:abc:62:s0-s1:70-120',
      locator: 'pdf:abc:62:s0-s1',
      text: '永久性居民依法享有選舉權和被選舉權。',
      sentenceStart: 0, sentenceEnd: 1, startRune: 70, endRune: 120,
    })
    const html = render({
      answer: '第二十五條規定居民在法律面前一律平等。\n\n永久性居民依法享有選舉權。',
      passages: [passage(), second],
    })
    expect(html).toContain('Page 61 · sentences 1–2')
    expect(html).toContain('Page 62 · sentences 1–1')
    expect((html.match(/retrieval-answer-citation-chip/g) ?? []).length).toBe(2)
  })

  it('keeps citations clickable so the reader can jump to the passage', () => {
    expect(render()).toContain('title="pdf:abc:61:s0-s3 — jump to this passage"')
  })

  it('leaves an unrelated paragraph uncited and says so', () => {
    const html = render({ answer: '完全無關的內容。' })
    expect(html).not.toContain('retrieval-answer-citation-chip')
    expect(html).toContain('No paragraph could be matched')
  })

  it('states that a citation is a position, not proof', () => {
    expect(render()).toContain('a locator only marks a position')
  })

  it('warns when the source text came from OCR', () => {
    expect(render({ passages: [passage({ sourceVersion: 'pdf-sha256:x;extractor=local-paddleocr;version=v' })] })).toContain('came from OCR')
    expect(render()).not.toContain('came from OCR')
  })

  it('shows progress while the answer is being generated', () => {
    const html = render({ answer: null, pending: true })
    expect(html).toContain('Generating an answer from the sources')
    expect(html).toContain('1 passages')
    expect(html).not.toContain('Answer from the sources')
  })

  it('renders nothing once a pending answer is cleared', () => {
    expect(render({ answer: null, pending: false })).toBe('')
  })

  it('surfaces a failure with a route to the chat model settings', () => {
    const html = render({ answer: null, error: '尚未配置对话模型。' })
    expect(html).toContain('Could not generate an answer')
    expect(html).toContain('尚未配置对话模型。')
    expect(html).toContain('Check the chat model settings')
    expect(html).toContain('role="alert"')
  })

  it('never presents an empty answer as a real one', () => {
    expect(render({ answer: null })).toBe('')
  })
})
