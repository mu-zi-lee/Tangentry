import { describe, expect, it } from 'vitest'
import {
  canLoadSamples,
  canRemoveSamples,
  samplesCounts,
  samplesSummary,
  type SamplesStatus,
} from './samplesApi'

function status(present: boolean[], enabled = true): SamplesStatus {
  return {
    enabled,
    seeded: present.every(Boolean),
    items: present.map((exists, index) => ({
      id: `pdf:${index}`, title: `示例 ${index}`, source: '发布机构', note: '', present: exists,
    })),
  }
}

describe('samplesCounts', () => {
  it('is zero for a missing status', () => {
    expect(samplesCounts(null)).toEqual({ present: 0, total: 0 })
  })

  it('counts present items only', () => {
    expect(samplesCounts(status([true, false, true]))).toEqual({ present: 2, total: 3 })
  })
})

describe('samplesSummary', () => {
  it('reports an unknown state before loading', () => {
    expect(samplesSummary(null)).toBe('状态未知')
  })

  it('reports a fully loaded set', () => {
    expect(samplesSummary(status([true, true]))).toBe('已载入 2 份')
  })

  it('reports a partial set', () => {
    expect(samplesSummary(status([true, false, false]))).toBe('已载入 1 / 3 份')
  })

  it('explains that automatic loading will happen when enabled', () => {
    expect(samplesSummary(status([false, false], true))).toBe('尚未载入，将在资料库为空时自动载入')
  })

  it('does not promise automatic loading when disabled', () => {
    expect(samplesSummary(status([false, false], false))).toBe('尚未载入')
  })

  it('handles an empty catalog', () => {
    expect(samplesSummary(status([]))).toBe('没有可用的示例资料')
  })
})

describe('actions', () => {
  it('offers loading only while something is missing', () => {
    expect(canLoadSamples(status([false, true]))).toBe(true)
    expect(canLoadSamples(status([true, true]))).toBe(false)
    expect(canLoadSamples(null)).toBe(false)
  })

  it('offers removal only when something is present', () => {
    expect(canRemoveSamples(status([true, false]))).toBe(true)
    expect(canRemoveSamples(status([false, false]))).toBe(false)
    expect(canRemoveSamples(null)).toBe(false)
  })
})