import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RetrievalAnswer } from './RetrievalAnswer'

function render(over: Partial<React.ComponentProps<typeof RetrievalAnswer>> = {}) {
  return renderToStaticMarkup(createElement(RetrievalAnswer, {
    question: '香港居民在法律面前一律平等吗',
    answer: '是的，第二十五条如此规定。',
    passageCount: 12,
    maxContextRunes: 60000,
    ocrDerived: false,
    pending: false,
    error: '',
    onSettings: () => {},
    ...over,
  }))
}

describe('RetrievalAnswer', () => {
  it('renders the answer with its question', () => {
    const html = render()
    expect(html).toContain('Answer from the sources')
    expect(html).toContain('第二十五条如此规定')
    expect(html).toContain('香港居民在法律面前一律平等吗')
  })

  it('states how many passages grounded the answer', () => {
    const html = render()
    expect(html).toContain('from 12 passages')
    expect(html).toContain('60,000 characters')
  })

  it('says a locator is not proof of correctness', () => {
    expect(render()).toContain('A locator only marks a position, not correctness')
  })

  it('warns when the source text came from OCR', () => {
    expect(render({ ocrDerived: true })).toContain('came from OCR')
    expect(render({ ocrDerived: false })).not.toContain('came from OCR')
  })

  it('marks the answer as AI generated', () => {
    expect(render()).toContain('>AI</span>')
  })

  it('shows progress while the answer is being generated', () => {
    const html = render({ answer: null, pending: true })
    expect(html).toContain('Generating an answer from the sources')
    expect(html).toContain('12 passages')
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
    // The component is handed null for an empty model reply; it must stay blank.
    expect(render({ answer: null })).toBe('')
  })
})