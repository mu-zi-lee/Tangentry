// B's namespaced retrieval wire object (schemaVersion 1). When retrieval is
// off the request fragment is empty so the chat body stays byte-compatible
// with the legacy contract (B-T01). The frontend is never the authority for
// retrieval, embeddings or locators — it only sends the request and renders
// the server's response.

export const RETRIEVAL_SCHEMA_VERSION = 1

export type RetrievalMode = 'hybrid' | 'embedding' | 'lexical'
export type BatchingMode = 'shared' | 'split'

export interface RetrievalEmbeddingBudget {
  batchingMode: BatchingMode
  maxRequests: number
  maxChars: number
  sweepCandidates: number
}

export interface RetrievalRerankBudget {
  maxRequests: number
}

export interface RetrievalRequest {
  schemaVersion: number
  enabled: boolean
  mode: RetrievalMode
  maxChars: number
  embeddingBudget: RetrievalEmbeddingBudget
  rerankBudget: RetrievalRerankBudget
}

export interface RetrievalPassageRef {
  passageId: string
  contentId: string
  source: string
  locator: string
  sentenceStart: number
  sentenceEnd: number
  startRune: number
  endRune: number
  textSha256: string
  sourceVersion: string
  cueIds: string[]
}

export interface RetrievalEmbeddingSummary {
  model: string
  dimensions: number
  budgetStatus: string
  requests: number
}

export interface RetrievalRerankSummary {
  enabled: boolean
  model: string
  budgetStatus: string
  requests: number
}

export interface RetrievalResponse {
  schemaVersion: number
  status: string
  mode: string
  passages: RetrievalPassageRef[]
  embedding: RetrievalEmbeddingSummary
  rerank: RetrievalRerankSummary
}

// defaultRetrievalRequest is the local-first default request: hybrid, 120,000
// runes, shared batch (24 requests / 100,000 chars / sweep 90), rerank off.
export function defaultRetrievalRequest(): RetrievalRequest {
  return {
    schemaVersion: RETRIEVAL_SCHEMA_VERSION,
    enabled: true,
    mode: 'hybrid',
    maxChars: 120000,
    embeddingBudget: { batchingMode: 'shared', maxRequests: 24, maxChars: 100000, sweepCandidates: 90 },
    rerankBudget: { maxRequests: 0 },
  }
}

// retrievalRequestFragment returns the request body fragment. When disabled
// it returns an empty object so the JSON body is byte-compatible with the
// legacy unbudgeted contract (the legacy buildChatContext path is untouched).
export function retrievalRequestFragment(enabled: boolean, request?: RetrievalRequest): { retrieval?: RetrievalRequest } {
  if (!enabled) return {}
  const base = request ?? defaultRetrievalRequest()
  return { retrieval: { ...base, schemaVersion: RETRIEVAL_SCHEMA_VERSION, enabled: true } }
}