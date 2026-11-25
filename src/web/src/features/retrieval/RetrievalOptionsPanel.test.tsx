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
    expect(html).toContain('Hybrid')
    expect(html).toContain('120,000 chars')
    expect(html).toContain('shared')
    expect(html).not.toContain('id="retrieval-options-body"')
  })

  it('flags a disabled sweep and disabled embedding in the summary', () => {
    const html = render(withOptions({ sweepCandidates: 0, maxEmbeddingRequests: 0 }), false)
    expect(html).toContain('sweep off')
    expect(html).toContain('embedding off')
  })
})

describe('RetrievalOptionsPanel knobs', () => {
  it('exposes every per-run knob the engine honours', () => {
    const html = render(defaultPrefs())
    for (const label of ['Context budget (chars)', 'Batch mode', 'Embedding request limit', 'Embedding character limit', 'Positional sweep candidates']) {
      expect(html).toContain(label)
    }
  })

  it('shows the saved ceilings so tightening is explicit', () => {
    const html = render(defaultPrefs())
    expect(html).toContain('Saved ceiling 24')
    expect(html).toContain('Saved ceiling 100000')
    expect(html).toContain('can only tighten the saved ceiling')
  })

  it('explains that 0 turns a budget off', () => {
    expect(render(defaultPrefs())).toContain('0 turns embedding off')
    expect(render(defaultPrefs())).toContain('0 disables the sweep')
  })

  it('warns that a disabled sweep drops the request budget', () => {
    const html = render(withOptions({ sweepCandidates: 0 }))
    expect(html).toContain('positional sweep is off')
    expect(html).toContain('default 90 candidates')
  })

  it('warns when the embedding budget is 0', () => {
    const html = render(withOptions({ maxEmbeddingRequests: 0 }))
    expect(html).toContain('equivalent to Lexical only')
  })

  it('keeps the warnings away when nothing is disabled', () => {
    const html = render(defaultPrefs())
    expect(html).not.toContain('positional sweep is off')
    expect(html).not.toContain('equivalent to Lexical only')
  })

  it('says weights and topK are settings-owned rather than duplicating them', () => {
    const html = render(defaultPrefs())
    expect(html).toContain('Hybrid weights, topK, batch size, the embedding model and the rerank switch live under Retrieval settings above')
    expect(html).toContain('Open retrieval settings')
    expect(html).not.toContain('Hybrid weights (0–1')
  })
})

describe('RetrievalOptionsPanel display preferences', () => {
  it('offers the highlight toggle and the page size', () => {
    const html = render(defaultPrefs())
    expect(html).toContain('Highlight words that overlap with the question')
    expect(html).toContain('Passages per page')
    expect(html).toContain('nothing is discarded')
  })

  it('reflects the stored highlight choice', () => {
    expect(render({ ...defaultPrefs(), highlight: false })).not.toContain('checked=""')
  })

  it('disables reset when the options are already the defaults', () => {
    expect(render(defaultPrefs())).toContain('disabled=""')
  })

  it('enables reset once an option differs', () => {
    const html = render(withOptions({ maxChars: 8000 }))
    const reset = html.slice(html.lastIndexOf('Reset to defaults') - 400)
    expect(reset).not.toContain('disabled=""')
  })
})
