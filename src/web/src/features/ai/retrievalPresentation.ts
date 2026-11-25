// Explicit retrieval status rendering (B-T25). Each status has distinct copy
// and tone; semantic_sweep_limited is a coverage limitation, never rendered as
// no_match, and never suppresses valid passages. The frontend renders the
// server's status; it never fabricates a passage or locator.

import type { RetrievalPassageRef, RetrievalResponse } from './retrieval'

export type RetrievalTone = 'ok' | 'info' | 'warning' | 'error'

export interface RetrievalStatusView {
  label: string
  tone: RetrievalTone
  // hint offers a next step (e.g. PDF retry) without hiding the status.
  hint?: string
}

// retrievalStatusView maps a machine status to distinct user-facing copy.
export function retrievalStatusView(status: string): RetrievalStatusView {
  switch (status) {
    case 'ok':
      return { label: 'Relevant passages found', tone: 'ok' }
    case 'lexical_only':
      return { label: 'Lexical retrieval only (embedding unavailable or off)', tone: 'info' }
    case 'semantic_sweep_limited':
      return { label: 'Semantic sweep coverage is limited', tone: 'warning', hint: 'The sample did not cover the whole document, so zero-overlap recall is capped by coverage. This is not a “no match”.' }
    case 'degraded_budget':
      return { label: 'Budget degraded (summary/history omitted)', tone: 'warning' }
    case 'no_match':
      return { label: 'No matching passages', tone: 'info' }
    case 'no_verified_passages':
      return { label: 'No passage passed source verification', tone: 'warning' }
    case 'source_unverified':
      return { label: 'Some passages failed source verification', tone: 'warning' }
    case 'stale_source':
      return { label: 'Source updated; citations are stale', tone: 'warning', hint: 'Search again to use the latest text.' }
    case 'invalid_budget':
      return { label: 'Invalid retrieval budget', tone: 'error' }
    case 'context_budget_exceeded':
      return { label: 'Context exceeds the budget', tone: 'error' }
    case 'pdf_extracting':
      return { label: 'Extracting PDF text', tone: 'info', hint: 'Try again shortly.' }
    case 'pdf_no_text':
      return { label: 'PDF has no extractable text', tone: 'warning', hint: 'It may be a scan; configure local OCR and retry.' }
    case 'pdf_ocr_unavailable':
      return { label: 'Local OCR unavailable', tone: 'warning', hint: 'Install and configure local PaddleOCR; nothing is uploaded.' }
    case 'pdf_extract_failed':
      return { label: 'PDF text extraction failed', tone: 'error', hint: 'Retry or check the file.' }
    case 'embedding_unavailable':
      return { label: 'Embedding service unavailable', tone: 'warning' }
    case 'empty':
      return { label: 'Question is empty', tone: 'info' }
    case 'invalid_input':
      return { label: 'Input contains invalid characters', tone: 'error' }
    default:
      return { label: `Status: ${status}`, tone: 'info' }
  }
}

// isCoverageLimited reports whether the status is a semantic-sweep coverage
// limitation (distinct from no_match).
export function isCoverageLimited(status: string): boolean {
  return status === 'semantic_sweep_limited'
}

// passageChipLabel renders a stable, human-readable locator label for a chip.
export function passageChipLabel(passage: RetrievalPassageRef): string {
  switch (passage.source) {
    case 'subtitle':
      return `Subtitle ${passage.locator.replace(/^subtitle:/, '')}`
    case 'pdf': {
      const parts = passage.locator.split(':')
      return `PDF page ${parts[2] ?? '?'}`
    }
    case 'discussion':
      return `Post ${passage.locator.replace(/^discussion:/, '')}`
    default:
      return `Paragraph ${passage.locator.replace(/^article:/, '')}`
  }
}

// hasPassages reports whether the response carries verifiable passages (a
// coverage-limited response still has passages and must not be treated as
// no_match).
export function hasPassages(response?: RetrievalResponse | null): boolean {
  return !!response && Array.isArray(response.passages) && response.passages.length > 0
}