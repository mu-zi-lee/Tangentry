import { describe, expect, it } from 'vitest'
import {
  defaultRetrievalSettings, validateRetrievalSettings, validateWeights,
  maskRetrievalSettings, dimensionChoices, batchingMode, isLoopbackUrl,
} from './retrievalSettings'

describe('defaultRetrievalSettings (B-T37 local-first)', () => {
  it('defaults to local bge-m3/1024 loopback with rerank off', () => {
    const s = defaultRetrievalSettings()
    expect(s.providerKind).toBe('local')
    expect(s.model).toBe('bge-m3')
    expect(s.dimensions).toBe(1024)
    expect(isLoopbackUrl(s.baseUrl)).toBe(true)
    expect(s.rerankProvider).toBe('off')
    expect(validateRetrievalSettings(s).ok).toBe(true)
  })
})

describe('validateRetrievalSettings (B-T31)', () => {
  it('rejects a non-loopback local endpoint', () => {
    const s = defaultRetrievalSettings()
    s.baseUrl = 'https://cloud.example.com/v1'
    const result = validateRetrievalSettings(s)
    expect(result.ok).toBe(false)
  })

  it('enforces per-model Bailian dimension choices and row limits', () => {
    const s = defaultRetrievalSettings()
    s.providerKind = 'bailian'
    s.surface = 'dashscope'
    s.model = 'text-embedding-v4'
    s.dimensions = 1024
    s.batchSize = 10
    expect(validateRetrievalSettings(s).ok).toBe(true)
    expect(dimensionChoices('text-embedding-v4')).toContain(1024)
    // Wrong dimension rejected.
    s.dimensions = 999
    expect(validateRetrievalSettings(s).ok).toBe(false)
    // Batch over the row limit rejected.
    s.dimensions = 1024
    s.batchSize = 11
    expect(validateRetrievalSettings(s).ok).toBe(false)
  })

  it('enforces the fixed v2 dimension (1536)', () => {
    const s = defaultRetrievalSettings()
    s.providerKind = 'bailian'
    s.model = 'text-embedding-v2'
    s.dimensions = 1536
    s.batchSize = 25
    expect(validateRetrievalSettings(s).ok).toBe(true)
    s.dimensions = 1024
    expect(validateRetrievalSettings(s).ok).toBe(false)
  })

  it('rejects out-of-range topK and non-positive dimensions/batch', () => {
    const base = defaultRetrievalSettings()
    for (const mut of [
      (s: typeof base) => { s.topK = 19 },
      (s: typeof base) => { s.topK = 1001 },
      (s: typeof base) => { s.dimensions = 0 },
      (s: typeof base) => { s.batchSize = 0 },
      (s: typeof base) => { s.model = '' },
      (s: typeof base) => { s.baseUrl = '' },
    ]) {
      const s = { ...base }
      mut(s)
      expect(validateRetrievalSettings(s).ok).toBe(false)
    }
  })

  it('requires a positive rerank budget when rerank is enabled (guard)', () => {
    const s = defaultRetrievalSettings()
    s.rerankProvider = 'bailian'
    s.maxRerankRequests = 0
    const result = validateRetrievalSettings(s)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('重排')
    s.maxRerankRequests = 2
    expect(validateRetrievalSettings(s).ok).toBe(true)
  })

  it('rejects negative request budgets', () => {
    const s = defaultRetrievalSettings()
    s.maxEmbeddingRequests = -1
    expect(validateRetrievalSettings(s).ok).toBe(false)
  })
})

describe('validateWeights (B-T32)', () => {
  it('normalizes valid weights to sum 1', () => {
    const result = validateWeights(1, 1, 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.weights.lexical).toBeCloseTo(1 / 3)
      expect(result.weights.lexical + result.weights.embedding + result.weights.rerank).toBeCloseTo(1)
    }
  })

  it('rejects all-zero, negative, NaN, Inf and out-of-range weights', () => {
    expect(validateWeights(0, 0, 0).ok).toBe(false)
    expect(validateWeights(-0.1, 0.5, 0).ok).toBe(false)
    expect(validateWeights(NaN, 0.5, 0).ok).toBe(false)
    expect(validateWeights(Infinity, 0.5, 0).ok).toBe(false)
    expect(validateWeights(1.5, 0, 0).ok).toBe(false)
  })
})

describe('maskRetrievalSettings (B-T35)', () => {
  it('reports hasKey/hasRerankKey and never the key itself', () => {
    const s = defaultRetrievalSettings()
    s.apiKey = 'super-secret-key'
    s.rerankApiKey = 'rerank-secret'
    const masked = maskRetrievalSettings(s)
    expect(masked.hasKey).toBe(true)
    expect(masked.hasRerankKey).toBe(true)
    const raw = JSON.stringify(masked)
    expect(raw).not.toContain('super-secret-key')
    expect(raw).not.toContain('rerank-secret')
    expect('apiKey' in masked).toBe(false)
    expect('rerankApiKey' in masked).toBe(false)
    // Non-secret fields survive a save/reload round-trip.
    expect(masked.model).toBe('bge-m3')
    expect(masked.dimensions).toBe(1024)
    expect(masked.maxEmbeddingRequests).toBe(24)
  })

  it('reports hasKey=false for an empty key', () => {
    expect(maskRetrievalSettings(defaultRetrievalSettings()).hasKey).toBe(false)
  })

  it('derives batching mode from surface/textType', () => {
    const s = defaultRetrievalSettings()
    expect(batchingMode(s)).toBe('shared')
    s.surface = 'dashscope'
    expect(batchingMode(s)).toBe('split')
  })
})