import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RetrievalOptionsPanel } from './RetrievalOptionsPanel'
import { defaultWorkbenchOptions } from './workbench'
import { defaultPrefs, type WorkbenchPrefs } from './workbenchPrefs'

const ceilings = { maxEmbeddingRequests: 24, maxEmbeddingChars: 100000 }

function render(prefs: WorkbenchPrefs, open = true) {
  return renderToStaticMarkup(createElement(RetrievalOptionsPanel, {
    open, prefs, ceilings, pending: false, onToggle: () => {},
    onOptions: () => {}, onPrefs: () => {}, onReset: () => {}, onOpenSettings: () => {},
  }))
}

const withOptions = (over: Record<string, unknown>) =>
  ({ ...defaultPrefs(), options: { ...defaultWorkbenchOptions(), ...over } }) as WorkbenchPrefs

describe('RetrievalOptionsPanel collapsed', () => {
  it('summarizes the active configuration', () => {
    const html = render(defaultPrefs(), false)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('混合')
    expect(html).toContain('120,000 字符')
    expect(html).toContain('合并批')
    expect(html).not.toContain('id="retrieval-options-body"')
  })

  it('flags a disabled sweep and disabled embedding in the summary', () => {
    const html = render(withOptions({ sweepCandidates: 0, maxEmbeddingRequests: 0 }), false)
    expect(html).toContain('扫描关闭')
    expect(html).toContain('嵌入关闭')
  })
})

describe('RetrievalOptionsPanel knobs', () => {
  it('exposes every per-run knob the engine honours', () => {
    const html = render(defaultPrefs())
    for (const label of ['上下文预算（字符）', '批处理模式', '嵌入请求上限', '嵌入字符上限', '位置分层扫描候选数']) {
      expect(html).toContain(label)
    }
  })

  it('shows the saved ceilings so tightening is explicit', () => {
    const html = render(defaultPrefs())
    expect(html).toContain('已保存上限 24')
    expect(html).toContain('已保存上限 100000')
    expect(html).toContain('只能比已保存上限更紧')
  })

  it('explains that 0 turns a budget off', () => {
    expect(render(defaultPrefs())).toContain('0 表示关闭嵌入')
    expect(render(defaultPrefs())).toContain('0 表示关闭扫描')
  })

  it('warns that a disabled sweep drops the request budget', () => {
    const html = render(withOptions({ sweepCandidates: 0 }))
    expect(html).toContain('已关闭位置分层扫描')
    expect(html).toContain('恢复为默认 90 个候选')
  })

  it('warns when the embedding budget is 0', () => {
    const html = render(withOptions({ maxEmbeddingRequests: 0 }))
    expect(html).toContain('等价于仅词汇检索')
  })

  it('keeps the warnings away when nothing is disabled', () => {
    const html = render(defaultPrefs())
    expect(html).not.toContain('已关闭位置分层扫描')
    expect(html).not.toContain('等价于仅词汇检索')
  })

  it('says weights and topK are settings-owned rather than duplicating them', () => {
    const html = render(defaultPrefs())
    expect(html).toContain('混合权重、topK、批大小、嵌入模型与重排开关由上方的「检索设置」统一管理')
    expect(html).toContain('打开检索设置')
    expect(html).not.toContain('混合权重（0–1')
  })
})

describe('RetrievalOptionsPanel display preferences', () => {
  it('offers the highlight toggle and the page size', () => {
    const html = render(defaultPrefs())
    expect(html).toContain('高亮片段中与问题重合的词')
    expect(html).toContain('每页显示片段')
    expect(html).toContain('不会丢弃任何结果')
  })

  it('reflects the stored highlight choice', () => {
    expect(render({ ...defaultPrefs(), highlight: false })).not.toContain('checked=""')
  })

  it('disables reset when the options are already the defaults', () => {
    expect(render(defaultPrefs())).toContain('disabled=""')
  })

  it('enables reset once an option differs', () => {
    const html = render(withOptions({ maxChars: 8000 }))
    const reset = html.slice(html.lastIndexOf('恢复默认') - 400)
    expect(reset).not.toContain('disabled=""')
  })
})
