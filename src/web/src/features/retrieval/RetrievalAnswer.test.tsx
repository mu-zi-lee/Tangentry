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
    expect(html).toContain('根据原文生成的回答')
    expect(html).toContain('第二十五条如此规定')
    expect(html).toContain('香港居民在法律面前一律平等吗')
  })

  it('states how many passages grounded the answer', () => {
    const html = render()
    expect(html).toContain('回答基于 12 条原文生成')
    expect(html).toContain('60,000 字符')
  })

  it('says a locator is not proof of correctness', () => {
    expect(render()).toContain('定位符只表示位置，不代表结论正确')
  })

  it('warns when the source text came from OCR', () => {
    expect(render({ ocrDerived: true })).toContain('OCR 识别文本')
    expect(render({ ocrDerived: false })).not.toContain('OCR 识别文本')
  })

  it('marks the answer as AI generated', () => {
    expect(render()).toContain('>AI</span>')
  })

  it('shows progress while the answer is being generated', () => {
    const html = render({ answer: null, pending: true })
    expect(html).toContain('正在根据原文生成回答')
    expect(html).toContain('12 条原文')
    expect(html).not.toContain('根据原文生成的回答')
  })

  it('renders nothing once a pending answer is cleared', () => {
    expect(render({ answer: null, pending: false })).toBe('')
  })

  it('surfaces a failure with a route to the chat model settings', () => {
    const html = render({ answer: null, error: '尚未配置对话模型。' })
    expect(html).toContain('未能生成回答')
    expect(html).toContain('尚未配置对话模型。')
    expect(html).toContain('检查对话模型设置')
    expect(html).toContain('role="alert"')
  })

  it('never presents an empty answer as a real one', () => {
    // The component is handed null for an empty model reply; it must stay blank.
    expect(render({ answer: null })).toBe('')
  })
})