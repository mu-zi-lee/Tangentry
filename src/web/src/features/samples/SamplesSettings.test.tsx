import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SamplesPanel } from './SamplesSettings'
import type { SamplesStatus } from './samplesApi'

function status(present: boolean[], enabled = true): SamplesStatus {
  return {
    enabled,
    seeded: present.every(Boolean),
    items: present.map((exists, index) => ({
      id: `pdf:${index}`,
      title: `示例文件 ${index}`,
      source: '香港特別行政區政府',
      note: index === 1 ? '文本由本機 PaddleOCR 識別；請以原文為準。' : '文本來自 PDF 原生文本層。',
      present: exists,
    })),
  }
}

function render(over: Partial<React.ComponentProps<typeof SamplesPanel>> = {}) {
  return renderToStaticMarkup(createElement(SamplesPanel, {
    status: status([true, false, false]),
    pending: '',
    error: '',
    notice: '',
    confirmRemove: false,
    onToggle: () => {},
    onLoad: () => {},
    onRemove: () => {},
    onAskRemove: () => {},
    onCancelRemove: () => {},
    ...over,
  }))
}

describe('SamplesPanel', () => {
  it('shows the summary and every catalog entry', () => {
    const html = render()
    expect(html).toContain('示例资料')
    expect(html).toContain('已载入 1 / 3 份')
    expect(html).toContain('示例文件 0')
    expect(html).toContain('示例文件 2')
  })

  it('marks present and absent entries differently', () => {
    const html = render()
    expect(html).toContain('已在资料库')
    expect(html).toContain('未载入')
    expect((html.match(/is-present/g) ?? []).length).toBe(1)
  })

  it('records OCR provenance so the reader knows the text is recognised', () => {
    expect(render()).toContain('PaddleOCR')
    expect(render()).toContain('請以原文為準')
  })

  it('states that disabling the offer does not delete anything', () => {
    expect(render()).toContain('不会删除已经载入的资料')
  })

  it('offers loading while something is missing', () => {
    const html = render()
    expect(html).toContain('立即载入')
    expect(html).toContain('移除示例资料')
  })

  it('disables loading when everything is present', () => {
    const html = render({ status: status([true, true, true]) })
    const load = html.slice(html.indexOf('立即载入') - 220, html.indexOf('立即载入'))
    expect(load).toContain('disabled')
    expect(html).toContain('已载入 3 份')
  })

  it('disables removal when nothing is present', () => {
    const html = render({ status: status([false, false, false]) })
    const remove = html.slice(html.indexOf('移除示例资料') - 220, html.indexOf('移除示例资料'))
    expect(remove).toContain('disabled')
  })

  it('asks for confirmation before deleting library items', () => {
    const html = render({ confirmRemove: true })
    expect(html).toContain('确认移除')
    expect(html).toContain('取消')
    expect(html).not.toContain('移除示例资料')
  })

  it('surfaces errors and notices', () => {
    expect(render({ error: '操作失败，请重试。' })).toContain('role="alert"')
    expect(render({ notice: '示例资料已从资料库移除。' })).toContain('role="status"')
  })

  it('attributes copyright to the publisher, not the project', () => {
    expect(render()).toContain('版权归原发布机构')
  })

  it('renders nothing about items before the status loads', () => {
    const html = render({ status: null, pending: 'load' })
    expect(html).not.toContain('示例资料清单')
    expect(html).toContain('示例资料')
  })
})