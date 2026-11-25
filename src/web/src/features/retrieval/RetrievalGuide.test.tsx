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
    expect(html).toContain('First time here?')
    expect(html).not.toContain('Pick a document')
    expect(html).not.toContain('id="retrieval-guide-body"')
  })

  it('exposes the three steps when expanded', () => {
    const html = render(true)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Pick a document')
    expect(html).toContain('Ask a specific question')
    expect(html).toContain('Check the source')
  })

  it('points a first-time user at the mode that needs no embedding server', () => {
    const html = render(true)
    expect(html).toContain('No embedding service?')
    expect(html).toContain('Lexical only')
    expect(html).toContain('runs entirely on this machine')
  })

  it('states that a locator is not proof of correctness', () => {
    expect(render(true)).toContain('A locator is not proof')
  })

  it('links the expanded panel to the settings page', () => {
    expect(render(true)).toContain('Configure embedding and weights')
  })

  it('associates the toggle with its body for screen readers', () => {
    const html = render(true)
    expect(html).toContain('aria-controls="retrieval-guide-body"')
    expect(html).toContain('id="retrieval-guide-body"')
  })
})
