// B's embedding/rerank settings: local-first defaults, per-model dimension
// choices, weight/budget validation and secret masking. The API key is never
// returned by the settings API (only hasKey); the UI mirrors that contract.

import type { BatchingMode } from './retrieval'

export type ProviderKind = 'local' | 'remote' | 'bailian'
export type EmbeddingSurface = 'openai' | 'dashscope'
export type EncodingFormat = 'float' | 'base64'
export type RerankProvider = 'off' | 'bailian' | 'custom'

export interface RetrievalSettings {
  providerKind: ProviderKind
  surface: EmbeddingSurface
  baseUrl: string
  apiKey: string
  model: string
  dimensions: number
  batchSize: number
  textType: string
  instruct: string
  encodingFormat: EncodingFormat
  timeoutMs: number
  topK: number
  lexicalWeight: number
  embeddingWeight: number
  rerankWeight: number
  maxEmbeddingRequests: number
  maxEmbeddingChars: number
  maxRerankRequests: number
  rerankProvider: RerankProvider
  rerankModel: string
  rerankBaseUrl: string
  rerankApiKey: string
  rerankTopN: number
  rerankInstruct: string
}

// defaultRetrievalSettings is the local-first default (recommended bge-m3 at
// 1024 dimensions over an Ollama-style loopback server; rerank off).
export function defaultRetrievalSettings(): RetrievalSettings {
  return {
    providerKind: 'local',
    surface: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: '',
    model: 'bge-m3',
    dimensions: 1024,
    batchSize: 8,
    textType: '',
    instruct: '',
    encodingFormat: 'float',
    timeoutMs: 30000,
    topK: 100,
    lexicalWeight: 0.35,
    embeddingWeight: 0.65,
    rerankWeight: 0,
    maxEmbeddingRequests: 24,
    maxEmbeddingChars: 100000,
    maxRerankRequests: 0,
    rerankProvider: 'off',
    rerankModel: '',
    rerankBaseUrl: '',
    rerankApiKey: '',
    rerankTopN: 0,
    rerankInstruct: '',
  }
}

// BAILIAN_MODEL_DIMENSIONS records the documented per-model dimension choices
// (dimensions are a per-model choice, never a global constant). maxRows is the
// documented batch/row limit.
export const BAILIAN_MODEL_DIMENSIONS: Record<string, { dimensions: number[]; maxRows: number; fixed?: number }> = {
  'text-embedding-v4': { dimensions: [2048, 1536, 1024, 768, 512, 256, 128, 64], maxRows: 10 },
  'text-embedding-v3': { dimensions: [1024, 768, 512, 256, 128, 64], maxRows: 10 },
  'text-embedding-v2': { dimensions: [1536], maxRows: 25, fixed: 1536 },
  'qwen3.7-text-embedding': { dimensions: [2560, 2048, 1536, 1024, 768, 512, 256], maxRows: 20 },
  'qwen3.7-text-embedding-flash': { dimensions: [1024, 768, 512, 256], maxRows: 20 },
}

export function dimensionChoices(model: string): number[] | null {
  return BAILIAN_MODEL_DIMENSIONS[model]?.dimensions ?? null
}

// isLoopbackUrl mirrors the backend local-provider requirement.
export function isLoopbackUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    const host = url.hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

// validateWeights checks each weight is finite and in [0,1] with at least one
// positive, and returns the normalized weights (B-T32).
export function validateWeights(lexical: number, embedding: number, rerank: number): { ok: true; weights: { lexical: number; embedding: number; rerank: number } } | { ok: false; message: string } {
  for (const value of [lexical, embedding, rerank]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      return { ok: false, message: '权重必须是 0–1 之间的有限数值。' }
    }
  }
  const sum = lexical + embedding + rerank
  if (sum <= 0) return { ok: false, message: '至少一个权重必须为正。' }
  return { ok: true, weights: { lexical: lexical / sum, embedding: embedding / sum, rerank: rerank / sum } }
}

// validateRetrievalSettings validates the full settings, returning the first
// actionable error (B-T31). A wrong dimension/model is rejected, not silently
// accepted; rerank enabled with a zero budget is rejected (the UI must require
// a positive budget or keep rerank off).
export function validateRetrievalSettings(s: RetrievalSettings): { ok: true } | { ok: false; message: string } {
  if (!['local', 'remote', 'bailian'].includes(s.providerKind)) return { ok: false, message: '请选择有效的服务类型。' }
  if (!s.baseUrl.trim()) return { ok: false, message: '请填写接口地址。' }
  if (s.providerKind === 'local' && !isLoopbackUrl(s.baseUrl)) return { ok: false, message: '本地服务必须使用回环地址（如 http://127.0.0.1:11434/v1）。' }
  if (!s.model.trim()) return { ok: false, message: '请填写模型名称。' }
  if (!Number.isInteger(s.dimensions) || s.dimensions <= 0) return { ok: false, message: '向量维度必须是正整数。' }
  if (!Number.isInteger(s.batchSize) || s.batchSize <= 0) return { ok: false, message: '批大小必须是正整数。' }
  if (s.providerKind === 'bailian') {
    const limit = BAILIAN_MODEL_DIMENSIONS[s.model]
    if (limit) {
      if (limit.fixed && s.dimensions !== limit.fixed) return { ok: false, message: `模型 ${s.model} 仅支持维度 ${limit.fixed}。` }
      if (!limit.dimensions.includes(s.dimensions)) return { ok: false, message: `模型 ${s.model} 不支持维度 ${s.dimensions}。` }
      if (s.batchSize > limit.maxRows) return { ok: false, message: `模型 ${s.model} 的批大小不能超过 ${limit.maxRows}。` }
    }
  }
  if (!Number.isInteger(s.topK) || s.topK < 20 || s.topK > 1000) return { ok: false, message: 'topK 必须在 20–1000 之间。' }
  const weights = validateWeights(s.lexicalWeight, s.embeddingWeight, s.rerankWeight)
  if (!weights.ok) return weights
  if (!Number.isInteger(s.maxEmbeddingRequests) || s.maxEmbeddingRequests < 0) return { ok: false, message: '嵌入请求预算必须是非负整数（0 表示关闭）。' }
  if (!Number.isInteger(s.maxRerankRequests) || s.maxRerankRequests < 0) return { ok: false, message: '重排请求预算必须是非负整数。' }
  if (!Number.isInteger(s.maxEmbeddingChars) || s.maxEmbeddingChars <= 0) return { ok: false, message: '嵌入字符预算必须是正整数。' }
  if (s.rerankProvider !== 'off' && s.maxRerankRequests <= 0) return { ok: false, message: '启用重排需要正的重排请求预算（建议 2），或保持重排关闭。' }
  return { ok: true }
}

// MaskedRetrievalSettings is the settings API response shape: secrets replaced
// by hasKey/hasRerankKey booleans (B-T35). The key never appears.
export interface MaskedRetrievalSettings extends Omit<RetrievalSettings, 'apiKey' | 'rerankApiKey'> {
  hasKey: boolean
  hasRerankKey: boolean
  batchingMode: BatchingMode
}

export function batchingMode(s: RetrievalSettings): BatchingMode {
  return s.surface === 'dashscope' || s.textType !== '' ? 'split' : 'shared'
}

// maskRetrievalSettings strips secrets and reports hasKey/hasRerankKey only.
export function maskRetrievalSettings(s: RetrievalSettings): MaskedRetrievalSettings {
  const { apiKey, rerankApiKey, ...rest } = s
  return { ...rest, hasKey: apiKey.trim() !== '', hasRerankKey: rerankApiKey.trim() !== '', batchingMode: batchingMode(s) }
}