import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ContextBody } from './PassageContext'

const page = (over: Partial<{ text: string; page: number; totalPages: number; extractor: string; extractorVersion: string }> = {}) => ({
  page: 2, text: '甲乙丙丁戊己庚辛壬癸', totalPages: 5, extractor: 'native', extractorVersion: 'v1', ...over,
})

const render = (data: ReturnType<typeof page>, startRune: number, endRune: number) =>
  renderToStaticMarkup(createElement(ContextBody, { data, startRune, endRune }))

describe('ContextBody', () => {
  it('highlights exactly the hit inside its page text', () => {
    const html = render(page(), 3, 5)
    expect(html).toContain('<mark class="retrieval-mark">丁戊</mark>')
  })

  it('keeps the surrounding text so the passage is readable in place', () => {
    const html = render(page(), 3, 5)
    expect(html).toContain('乙丙')
    expect(html).toContain('己庚')
  })

  it('shows which page and how many pages exist', () => {
    expect(render(page(), 3, 5)).toContain('Page 2 of 5')
  })

  it('warns when the page text came from OCR', () => {
    expect(render(page({ extractor: 'local-paddleocr' }), 0, 1)).toContain('OCR')
    expect(render(page(), 0, 1)).not.toContain('OCR')
  })

  it('marks truncation with an ellipsis on a long page', () => {
    const long = '前'.repeat(500) + '命中' + '后'.repeat(500)
    const html = render(page({ text: long }), 500, 502)
    expect(html).toContain('retrieval-context-cut')
    expect(html).toContain('<mark class="retrieval-mark">命中</mark>')
  })

  it('renders safely when the offsets exceed the page text', () => {
    const html = render(page(), 999, 1200)
    expect(html).toContain('Page 2 of 5')
    expect(html).toContain('<mark class="retrieval-mark"></mark>')
  })
})