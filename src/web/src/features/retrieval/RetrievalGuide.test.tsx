import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RetrievalGuide } from './RetrievalGuide'

const render = (open: boolean) => renderToStaticMarkup(
  createElement(RetrievalGuide, { open, onToggle: () => {}, onOpenSettings: () => {} }))

describe('RetrievalGuide', () => {
  it('is collapsed without rendering the steps', () => {
    const html = render(false)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('第一次使用？')
    expect(html).not.toContain('选一份内容')
    expect(html).not.toContain('id="retrieval-guide-body"')
  })

  it('exposes the three steps when expanded', () => {
    const html = render(true)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('选一份内容')
    expect(html).toContain('问一个具体问题')
    expect(html).toContain('核对原文')
  })

  it('points a first-time user at the mode that needs no embedding server', () => {
    const html = render(true)
    expect(html).toContain('没有嵌入服务？')
    expect(html).toContain('仅词汇')
    expect(html).toContain('完全在本机运行')
  })

  it('states that a locator is not proof of correctness', () => {
    expect(render(true)).toContain('定位符不等于正确性')
  })

  it('links the expanded panel to the settings page', () => {
    expect(render(true)).toContain('配置嵌入服务与权重')
  })

  it('associates the toggle with its body for screen readers', () => {
    const html = render(true)
    expect(html).toContain('aria-controls="retrieval-guide-body"')
    expect(html).toContain('id="retrieval-guide-body"')
  })
})
