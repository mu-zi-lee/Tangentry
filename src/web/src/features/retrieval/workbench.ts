// Standalone retrieval workbench logic (owner B's FR-02 as its own page).
//
// The frontend is never the authority for selection, embeddings or locators:
// it sends the request and renders the server's status. Only knobs the engine
// actually honours per run are exposed here — weights, topK, batch size and the
// model live in the saved settings, and request budgets can only TIGHTEN them
// (retrieval.resolveRunBudget).

import { APIError } from '../../shared/api/client'
import {
  RETRIEVAL_SCHEMA_VERSION,
  type BatchingMode,
  type RetrievalMode,
  type RetrievalPassageRef,
  type RetrievalResponse,
} from '../ai/retrieval'

// Mirrors the domain assembly budget range (retrieval.MinAssemblyBudgetRunes /
// MaxAssemblyBudgetRunes) so the UI cannot offer a budget the server rejects.
export const MIN_CONTEXT_RUNES = 1
export const MAX_CONTEXT_RUNES = 1000000
export const DEFAULT_CONTEXT_RUNES = 120000
// Practical UI guard for the sweep quota; the domain accepts any value >= 0.
export const MAX_SWEEP_CANDIDATES = 1000

export interface WorkbenchPassage extends RetrievalPassageRef {
  text: string
  score: number
  lexicalScore: number
  cosineScore: number
}

export interface WorkbenchResult {
  retrieval: RetrievalResponse
  passages: WorkbenchPassage[]
  contextChars: number
}

/** Every per-run knob the engine honours. */
export interface WorkbenchOptions {
  mode: RetrievalMode
  /** Context assembly budget in runes. */
  maxChars: number
  batchingMode: BatchingMode
  /** Embedding request budget; 0 turns embedding off. */
  maxEmbeddingRequests: number
  /** Embedding character budget. */
  maxEmbeddingChars: number
  /** Position-stratified sweep quota; 0 disables the sweep. */
  sweepCandidates: number
}

/** Saved ceilings a run may only tighten, never raise. */
export interface WorkbenchCeilings {
  maxEmbeddingRequests: number
  maxEmbeddingChars: number
}

export interface WorkbenchSearchBody {
  contentId: string
  question: string
  retrieval: {
    schemaVersion: number
    enabled: boolean
    mode: RetrievalMode
    maxChars: number
    embeddingBudget: {
      batchingMode: BatchingMode
      /** null omits the field so the saved ceiling applies (Go *int). */
      maxRequests: number | null
      maxChars: number
      sweepCandidates: number
    }
    rerankBudget: { maxRequests: number }
  }
}

export function defaultWorkbenchOptions(): WorkbenchOptions {
  return {
    mode: 'hybrid',
    maxChars: DEFAULT_CONTEXT_RUNES,
    batchingMode: 'shared',
    maxEmbeddingRequests: 24,
    maxEmbeddingChars: 100000,
    sweepCandidates: 90,
  }
}

export const contextBudgetPresets = [
  { value: 120000, label: '120,000（默认）' },
  { value: 32000, label: '32,000' },
  { value: 8000, label: '8,000（降级压力）' },
] as const

export const workbenchModes = [
  { value: 'hybrid', label: '混合', hint: '词汇 + 语义，需要嵌入服务' },
  { value: 'lexical', label: '仅词汇', hint: '完全本机，无需嵌入服务' },
  { value: 'embedding', label: '仅语义', hint: '只用向量相似度' },
] as const satisfies readonly { value: RetrievalMode; label: string; hint: string }[]

export const batchingModes = [
  { value: 'shared', label: '合并批处理', hint: '问题与文档同批，请求数更少' },
  { value: 'split', label: '分离批处理', hint: '问题单独一批，角色不混用' },
] as const satisfies readonly { value: BatchingMode; label: string; hint: string }[]

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n !== Math.trunc(n)) return fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

/**
 * Normalizes options against the domain ranges and the saved ceilings. Request
 * budgets are capped by the saved values because the engine only tightens; a
 * saved 0 (embedding off) is never re-enabled here.
 */
export function normalizeOptions(raw: Partial<WorkbenchOptions> | null | undefined, ceilings?: WorkbenchCeilings): WorkbenchOptions {
  const base = defaultWorkbenchOptions()
  const input = raw ?? {}
  const requestCeiling = ceilings ? Math.max(0, Math.trunc(ceilings.maxEmbeddingRequests) || 0) : Number.MAX_SAFE_INTEGER
  const charCeiling = ceilings && ceilings.maxEmbeddingChars > 0 ? Math.trunc(ceilings.maxEmbeddingChars) : Number.MAX_SAFE_INTEGER
  const mode = workbenchModes.some(item => item.value === input.mode) ? input.mode! : base.mode
  const batchingMode = batchingModes.some(item => item.value === input.batchingMode) ? input.batchingMode! : base.batchingMode
  // An out-of-range context budget falls back to the labelled default rather
  // than clamping to 1 rune, which would assemble a useless context.
  const rawChars = typeof input.maxChars === 'number' ? input.maxChars : Number(input.maxChars)
  const maxChars = Number.isFinite(rawChars) && rawChars === Math.trunc(rawChars)
    && rawChars >= MIN_CONTEXT_RUNES && rawChars <= MAX_CONTEXT_RUNES
    ? rawChars : base.maxChars
  return {
    mode,
    batchingMode,
    maxChars,
    maxEmbeddingRequests: Math.min(clampInt(input.maxEmbeddingRequests, 0, Number.MAX_SAFE_INTEGER, base.maxEmbeddingRequests), requestCeiling),
    maxEmbeddingChars: Math.min(clampInt(input.maxEmbeddingChars, 0, Number.MAX_SAFE_INTEGER, base.maxEmbeddingChars), charCeiling),
    sweepCandidates: clampInt(input.sweepCandidates, 0, MAX_SWEEP_CANDIDATES, base.sweepCandidates),
  }
}

/**
 * Builds the search body. Retrieval is always enabled here and the schema
 * version is server-owned.
 *
 * Disabling the sweep (sweepCandidates 0) omits maxRequests: the engine restores
 * a 90-candidate sweep whenever an explicit request budget accompanies a zero
 * quota, so sending both would silently re-enable the sweep the user turned off.
 */
export function searchBody(contentId: string, question: string, options: WorkbenchOptions): WorkbenchSearchBody {
  const sweepDisabled = options.sweepCandidates === 0
  return {
    contentId: contentId.trim(),
    question: question.trim(),
    retrieval: {
      schemaVersion: RETRIEVAL_SCHEMA_VERSION,
      enabled: true,
      mode: options.mode,
      maxChars: options.maxChars,
      embeddingBudget: {
        batchingMode: options.batchingMode,
        maxRequests: sweepDisabled ? null : options.maxEmbeddingRequests,
        maxChars: options.maxEmbeddingChars,
        sweepCandidates: options.sweepCandidates,
      },
      // Rerank on/off is owned by the saved settings (surfaced on this page);
      // the request budget is a cap, and 0 means "no override".
      rerankBudget: { maxRequests: 0 },
    },
  }
}

/** A run needs a selected content, a non-blank question and no pending run. */
export function canSearch(contentId: string, question: string, pending: boolean): boolean {
  return !pending && contentId.trim() !== '' && question.trim() !== ''
}

/**
 * Recovers B's status from a rejected request. Some statuses map to 4xx (e.g.
 * stale_source → 409) but are still renderable outcomes, so the workbench shows
 * the distinct status. Passages are never fabricated: a rejection has none.
 */
export function resultFromError(error: unknown): WorkbenchResult | null {
  if (!(error instanceof APIError)) return null
  const prefix = 'retrieval_'
  if (!error.code.startsWith(prefix)) return null
  const status = error.code.slice(prefix.length)
  if (!status) return null
  const payload = error.payload as { retrieval?: RetrievalResponse } | undefined
  const server = payload?.retrieval
  const retrieval: RetrievalResponse = server ?? {
    schemaVersion: RETRIEVAL_SCHEMA_VERSION,
    status,
    mode: '',
    passages: [],
    embedding: { model: '', dimensions: 0, budgetStatus: '', requests: 0 },
    rerank: { enabled: false, model: '', budgetStatus: '', requests: 0 },
  }
  return { retrieval: { ...retrieval, status }, passages: [], contextChars: 0 }
}

/** Renders a score as a stable percentage, clamped to [0, 1]. */
export function workbenchScoreLabel(score: number): string {
  const safe = Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0
  return `${Math.round(safe * 100)}%`
}

/** Width for a score bar, clamped so a bad value cannot overflow the track. */
export function workbenchScoreWidth(score: number): number {
  const safe = Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0
  return Math.round(safe * 100)
}

/**
 * Shortens a locator for display. A PDF locator embeds the full document hash,
 * which is unreadable in a list; the exact value stays available through the
 * title attribute and the copy button, so verification is never lost.
 */
export function compactLocator(locator: string): string {
  const parts = locator.split(':')
  if (parts[0] === 'pdf' && parts.length >= 4) return `${parts[2]}:${parts[3]}`
  return locator
}

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/

/**
 * Mirrors retrieval.QueryTerms: lowercase/whitespace-normalized Latin words plus
 * a 2-gram sliding window over each CJK run (a single CJK char stands alone).
 * Highlighting therefore reflects the real lexical matcher, not a guess.
 */
export function queryTerms(question: string): string[] {
  const normalized = question.toLowerCase().replace(/\s+/g, ' ').trim()
  const terms: string[] = []
  const seen = new Set<string>()
  const add = (term: string) => {
    if (term && !seen.has(term)) { seen.add(term); terms.push(term) }
  }
  let word = ''
  let cjk = ''
  const flushWord = () => { if (word) add(word); word = '' }
  const flushCJK = () => {
    if (cjk.length === 1) add(cjk)
    for (let i = 0; i + 1 < cjk.length; i++) add(cjk.slice(i, i + 2))
    cjk = ''
  }
  for (const char of normalized) {
    if (CJK.test(char)) { flushWord(); cjk += char; continue }
    flushCJK()
    if (/[\p{L}\p{N}]/u.test(char)) { word += char; continue }
    flushWord()
  }
  flushWord()
  flushCJK()
  // QueryTerms sorts its result; keep the same order so the mirror is faithful.
  return terms.sort()
}

export interface HighlightSegment { text: string; match: boolean }

/**
 * Splits text into matched/unmatched segments, preserving the original text
 * byte-for-byte (locators and quotes must stay exact). Matching is
 * case-insensitive; the longest term wins at each position.
 */
export function highlightSegments(text: string, terms: readonly string[]): HighlightSegment[] {
  if (!text) return []
  const usable = terms.filter(term => term.length > 0)
  if (usable.length === 0) return [{ text, match: false }]
  const lowered = text.toLowerCase()
  const flags = new Array<boolean>(text.length).fill(false)
  // Mark every occurrence, including overlapping terms, so adjacent hits merge
  // into one run and no matched span is missed.
  for (const term of usable) {
    let from = lowered.indexOf(term)
    while (from !== -1) {
      for (let j = from; j < from + term.length && j < flags.length; j++) flags[j] = true
      from = lowered.indexOf(term, from + 1)
    }
  }
  const segments: HighlightSegment[] = []
  let start = 0
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || flags[i] !== flags[start]) {
      segments.push({ text: text.slice(start, i), match: flags[start] })
      start = i
    }
  }
  return segments
}

/**
 * Context cap for generated answers. A very large assembled context is rejected
 * by the chat provider (measured: 120k runes failed, 60k succeeded), so the
 * answer uses at most this many runes even when the search budget is larger.
 * The search still uses the user's budget; only the answer is capped.
 */
export const ANSWER_MAX_CONTEXT_RUNES = 60000

/** Chat turn shape accepted by /api/ai/chat. */
export interface AnswerMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AnswerRequest {
  contentId: string
  messages: AnswerMessage[]
  retrieval: WorkbenchSearchBody['retrieval']
  // The chat endpoint rejects a stale revision (optimistic concurrency), so the
  // caller must pass the current AI configuration revision.
  revision: number
}

/**
 * Builds the RAG request. It reuses the exact retrieval fragment of the search
 * so the answer is grounded in the same selection the page displays; the server
 * ignores any client-supplied context when retrieval is enabled.
 */
export function answerBody(contentId: string, question: string, options: WorkbenchOptions, revision: number): AnswerRequest {
  const body = searchBody(contentId, question, options)
  return {
    contentId: body.contentId,
    messages: [{ role: 'user', content: body.question }],
    retrieval: { ...body.retrieval, maxChars: Math.min(body.retrieval.maxChars, ANSWER_MAX_CONTEXT_RUNES) },
    revision,
  }
}

/**
 * Extracts the assistant answer from the chat result. Returns null when the
 * provider produced no assistant turn, so the UI never shows an empty answer as
 * if it were a real one.
 */
export function answerFromResponse(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const messages = (raw as { messages?: unknown }).messages
  if (!Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: unknown; content?: unknown }
    if (message?.role === 'assistant' && typeof message.content === 'string' && message.content.trim() !== '') {
      return message.content
    }
  }
  return null
}

/**
 * Reports whether any displayed passage came from OCR. PDF sources record their
 * extractor in the source version (e.g. "…;extractor=local-paddleocr;version=…"),
 * so the UI can warn that recognised text may contain errors.
 */
export function isOCRDerived(passages: readonly { sourceVersion: string }[]): boolean {
  return passages.some(passage => passage.sourceVersion.includes('extractor=local-paddleocr'))
}

/**
 * Rewrites the long passage locators a model echoes into short, readable
 * references. Display only: the exact locator stays available in the passage
 * list below, so nothing becomes unverifiable.
 *
 * A passage ID has the shape `<contentID>#<locator>:<start>-<end>`, e.g.
 * `pdf:<sha>#pdf:<sha>:61:s0-s3:0-109`, so the composite form is handled before
 * the bare locator form.
 */
export function compactCitationIds(text: string): string {
  return text
    // Composite PDF passage id -> page reference.
    .replace(/pdf:[0-9a-f]{64}#pdf:[0-9a-f]{64}:([0-9]+):[0-9a-zA-Z-]+:\d+-\d+/gi, '原文第$1頁')
    // Any remaining composite id (other sources): a plain label.
    .replace(/(?:pdf|article|discussion|subtitle):[^\s"'#]+#[^\s"']*/gi, '原文片段')
    // Bare PDF locator.
    .replace(/pdf:[0-9a-f]{64}:([0-9]+):[0-9a-zA-Z-]+/g, '第$1頁')
    // Drop the "passage id: " / "passage id=" wrapper the model repeats.
    .replace(/passage\s*id\s*[:=]\s*"?/gi, '')
    // A citation wrapped in quotes leaves the closing quote behind.
    .replace(/(原文第[0-9]+頁|原文片段|字幕片段)"(?=\s|[，。；）)]|$)/g, '$1')
}

/**
 * Picks the content to search on entry so the core task is one Enter, not a
 * dropdown round-trip: the last used content when it is still in the library,
 * otherwise the first item. Returns '' for an empty library.
 */
export function pickInitialContent(items: readonly { id: string }[], lastContentId: string): string {
  if (items.length === 0) return ''
  if (lastContentId && items.some(item => item.id === lastContentId)) return lastContentId
  return items[0].id
}

/** PDF page number carried by a locator, or null for other sources. */
export function passagePage(locator: string): number | null {
  const parts = locator.split(':')
  if (parts[0] !== 'pdf' || parts.length < 4) return null
  const page = Number(parts[2])
  return Number.isInteger(page) && page > 0 ? page : null
}

/**
 * Human-readable position of a passage inside its source, so a reader knows
 * where to look without decoding a locator: "第 61 页 · 句 3–6".
 */
export function passagePosition(passage: { source: string; locator: string; sentenceStart: number; sentenceEnd: number }): string {
  const page = passagePage(passage.locator)
  const sentences = passage.sentenceEnd > passage.sentenceStart
    ? `句 ${passage.sentenceStart + 1}–${passage.sentenceEnd}`
    : ''
  if (page !== null) return sentences ? `第 ${page} 页 · ${sentences}` : `第 ${page} 页`
  if (passage.source === 'subtitle') {
    const cue = passage.locator.replace(/^subtitle:/, '')
    return cue ? `字幕 ${cue}` : '字幕'
  }
  const unit = passage.locator.split(':')[1] ?? ''
  const head = passage.source === 'discussion' ? `讨论 ${unit}` : `段落 ${unit}`
  return sentences ? `${head} · ${sentences}` : head
}

/** Query state carried by the page URL (additive params: contentId, q). */
export interface WorkbenchRoute {
  contentId: string
  question: string
}

/** Reads the shareable query from a location.search string. */
export function routeFromSearch(search: string): WorkbenchRoute {
  const params = new URLSearchParams(search)
  return { contentId: params.get('contentId') ?? '', question: params.get('q') ?? '' }
}

/** Builds the shareable path for a completed search. */
export function searchPath(contentId: string, question: string): string {
  const params = new URLSearchParams()
  if (contentId) params.set('contentId', contentId)
  if (question) params.set('q', question)
  const query = params.toString()
  return query ? `/retrieval?${query}` : '/retrieval'
}

/** Concrete next steps offered when a search returns nothing. */
export type NoResultAction = 'enable-sweep' | 'widen-budget' | 'try-hybrid' | 'clear'

export interface NoResultGuidance {
  title: string
  reason: string
  actions: NoResultAction[]
}

/**
 * Explains why a search produced no passages and what to change. Every action
 * maps to a real option on this page, so the empty state is a way forward rather
 * than a dead end.
 */
export function noResultGuidance(status: string, options: WorkbenchOptions): NoResultGuidance {
  const actions: NoResultAction[] = []
  if (options.sweepCandidates === 0) actions.push('enable-sweep')
  if (options.maxChars < DEFAULT_CONTEXT_RUNES) actions.push('widen-budget')
  if (options.mode === 'lexical') actions.push('try-hybrid')
  actions.push('clear')

  switch (status) {
    case 'no_match':
      return { title: '没有匹配的原文片段', reason: '这份内容里没有与问题重合的表述。换个说法、减少限定词，或改用混合检索试试。', actions }
    case 'no_verified_passages':
      return { title: '候选片段未通过原文校验', reason: '候选片段都没通过原文校验，可能内容刚被更新。重新检索一次即可。', actions }
    case 'stale_source':
      return { title: '原文已更新', reason: '旧引用已失效。重新检索会基于最新原文。', actions }
    case 'pdf_no_text':
      return { title: '这份 PDF 没有可用文本', reason: '可能是扫描件。需要本机 OCR 才能检索，或换一份带文本层的内容。', actions }
    case 'pdf_ocr_unavailable':
      return { title: '本机 OCR 不可用', reason: '扫描件需要 OCR。安装并配置本机 PaddleOCR 后重试，不会上传云端。', actions }
    case 'empty':
      return { title: '问题为空', reason: '输入要查的内容后再检索。', actions: ['clear'] }
    default:
      return { title: '本次没有可引用的片段', reason: '调整下面的检索条件后重试。定位符只表示位置，不代表结论正确。', actions }
  }
}

/** Actionable copy for a failed request, with a retry when it can help. */
export function errorGuidance(code: string, status: number): { title: string; hint: string; retry: boolean } {
  if (code === 'network_error' || status === 0) {
    return { title: '连不上本机服务', hint: '确认 Tangentry 仍在运行，然后重试。', retry: true }
  }
  if (status === 504 || code === 'ai_timeout') {
    return { title: '检索超时', hint: '内容较长时可能超时。可缩小上下文预算后重试。', retry: true }
  }
  if (status === 401 || code === 'unauthorized') {
    return { title: '登录已失效', hint: '请重新登录后再检索。', retry: false }
  }
  if (status === 503) {
    return { title: '检索服务暂不可用', hint: '检查「检索设置」里的服务与密钥，然后重试。', retry: true }
  }
  return { title: '检索失败', hint: '可以直接重试；若持续失败，检查检索设置。', retry: true }
}

/**
 * Normalizes a search response. A renderable outcome such as no_match is sent
 * with HTTP 200 but carries only the status envelope (no passages/contextChars),
 * so the UI must not assume the success shape.
 */
export function normalizeResult(raw: unknown): WorkbenchResult | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as { retrieval?: RetrievalResponse; passages?: unknown; contextChars?: unknown }
  if (!value.retrieval || typeof value.retrieval.status !== 'string') return null
  return {
    retrieval: { ...value.retrieval, passages: Array.isArray(value.retrieval.passages) ? value.retrieval.passages : [] },
    passages: Array.isArray(value.passages) ? value.passages as WorkbenchPassage[] : [],
    contextChars: typeof value.contextChars === 'number' ? value.contextChars : 0,
  }
}

/** One remembered query, scoped to the content it was asked against. */
export interface RecentSearch {
  contentId: string
  question: string
}

/**
 * Adds a query to the recent list: newest first, no duplicate of the same
 * content+question, capped. Returns a new array so callers can persist it.
 */
export function addRecentSearch(list: readonly RecentSearch[], entry: RecentSearch, max = 5): RecentSearch[] {
  const question = entry.question.trim()
  if (!entry.contentId || !question) return [...list]
  const rest = list.filter(item => !(item.contentId === entry.contentId && item.question === question))
  return [{ contentId: entry.contentId, question }, ...rest].slice(0, Math.max(1, max))
}

/** Display order for the result list. The server order is the relevance order. */
export type PassageSort = 'relevance' | 'source'

/**
 * Sorts passages for display. 'relevance' keeps the server's ranking untouched;
 * 'source' follows the document so a reader can walk the text in order. This is
 * a view choice only: it never changes which passages were selected.
 */
export function sortPassages<T extends { locator: string; startRune: number; sentenceStart: number }>(list: readonly T[], mode: PassageSort): T[] {
  if (mode === 'relevance') return [...list]
  return [...list].sort((a, b) => {
    const [ua, ub] = [passageUnit(a.locator), passageUnit(b.locator)]
    return ua - ub || a.sentenceStart - b.sentenceStart || a.startRune - b.startRune
  })
}

/**
 * The document unit a locator points at: the PDF page, the article block, or the
 * subtitle cue index. startRune is an offset *within* that unit, so ordering
 * must use the unit first — a page-44 hit precedes a page-1 hit only if 44 < 1.
 */
export function passageUnit(locator: string): number {
  const parts = locator.split(':')
  switch (parts[0]) {
    case 'pdf':
      return Number(parts[2]) || 0
    case 'article':
      return Number(parts[1]) || 0
    case 'discussion':
      return Number(parts[2]) || 0
    case 'subtitle': {
      const cue = (parts[2] ?? '').split('-')[0]
      return Number(cue) || 0
    }
    default:
      return 0
  }
}

/** Question length limit and the point where the counter appears. */
export const QUESTION_MAX_LENGTH = 2000
export const QUESTION_HINT_FROM = 1800
