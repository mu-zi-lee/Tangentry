import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RetrievalSettingsPanel } from './RetrievalSettings'
import { defaultRetrievalSettings } from './retrievalSettings'

describe('RetrievalSettingsPanel', () => {
  it('renders the local-first defaults with a save action', () => {
    const html = renderToStaticMarkup(createElement(RetrievalSettingsPanel, {}))
    expect(html).toContain('原文检索设置')
    expect(html).toContain('保存检索设置')
    expect(html).toContain('bge-m3')
    expect(html).toContain('本地（推荐）')
    expect(html).toContain('阿里云百炼')
    expect(html).toContain('API 密钥（可选）')
  })

  it('shows the stored-key indicator without ever rendering a key', () => {
    const html = renderToStaticMarkup(createElement(RetrievalSettingsPanel, { hasKey: true }))
    expect(html).toContain('API 密钥（已配置）')
    expect(html).toContain('已保存；留空保留')
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
    expect(html).toContain('向量维度必须是正整数')
    expect(html).toContain('disabled')
  })

  it('guards rerank enabled with a zero budget', () => {
    const settings = defaultRetrievalSettings()
    settings.rerankProvider = 'bailian'
    settings.maxRerankRequests = 0
    const html = renderToStaticMarkup(createElement(RetrievalSettingsPanel, { initial: settings }))
    expect(html).toContain('启用重排需要正的重排请求预算')
  })
})
