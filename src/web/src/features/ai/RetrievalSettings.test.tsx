import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RetrievalSettingsPanel } from './RetrievalSettingsPanel'
import { defaultRetrievalSettings } from './retrievalSettings'

describe('RetrievalSettingsPanel', () => {
  it('renders the local-first defaults with a save action', () => {
    const html = renderToStaticMarkup(createElement(RetrievalSettingsPanel, {}))
    expect(html).toContain('Retrieval service settings')
    expect(html).toContain('Save retrieval settings')
    expect(html).toContain('bge-m3')
    expect(html).toContain('Local (recommended)')
    expect(html).toContain('Alibaba Cloud Bailian')
    expect(html).toContain('API key (optional)')
  })

  it('shows the stored-key indicator without ever rendering a key', () => {
    const html = renderToStaticMarkup(createElement(RetrievalSettingsPanel, { hasKey: true }))
    expect(html).toContain('API key (configured)')
    expect(html).toContain('Saved; leave blank to keep')
  })

  it('renders the Bailian per-model dimension choices', () => {
    const settings = defaultRetrievalSettings()
    settings.providerKind = 'bailian'
    settings.model = 'text-embedding-v4'
    settings.dimensions = 1024
    const html = renderToStaticMarkup(createElement(RetrievalSettingsPanel, { initial: settings }))
    expect(html).toContain('<option value="2048"')
    expect(html).toContain('<option value="64"')
  })

  it('blocks saving invalid settings with an actionable error', () => {
    const settings = defaultRetrievalSettings()
    settings.dimensions = 0
    const html = renderToStaticMarkup(createElement(RetrievalSettingsPanel, { initial: settings }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('Dimensions must be a positive integer')
    expect(html).toContain('disabled')
  })

  it('guards rerank enabled with a zero budget', () => {
    const settings = defaultRetrievalSettings()
    settings.rerankProvider = 'bailian'
    settings.maxRerankRequests = 0
    const html = renderToStaticMarkup(createElement(RetrievalSettingsPanel, { initial: settings }))
    expect(html).toContain('Rerank requires a positive rerank request budget')
  })
})
