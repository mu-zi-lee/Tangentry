// Per-paragraph citations for a generated answer.
//
// The model is free to mention a page, and models do hallucinate locators. So the
// citation attached to each paragraph is NOT taken from the model's prose: it is
// computed by comparing the paragraph against the passages retrieval actually
// returned. A paragraph only gets a citation when its wording overlaps a
// passage, and the locator shown is the passage's own, verified locator.

import { queryTerms, type WorkbenchPassage } from './workbench'

/** Splits an answer into paragraph-ish blocks on blank lines. */
export function splitAnswerBlocks(answer: string): string[] {
  return answer
    .split(/\n\s*\n+/)
    .map(block => block.trim())
    .filter(block => block !== '')
}

interface Scored {
  passage: WorkbenchPassage
  score: number
}

/**
 * Scores one paragraph against every passage. An exact mention of the passage
 * ID wins outright; otherwise the score is the share of the passage's distinct
 * terms that also appear in the paragraph, capped so a very long passage cannot
 * dilute the signal.
 */
export function rankPassagesForParagraph(paragraph: string, passages: readonly WorkbenchPassage[]): Scored[] {
  const paragraphTerms = new Set(queryTerms(paragraph))
  const scored: Scored[] = []
  for (const passage of passages) {
    if (paragraph.includes(passage.passageId)) {
      scored.push({ passage, score: 1 })
      continue
    }
    const terms = new Set(queryTerms(passage.text))
    if (terms.size === 0) continue
    let hit = 0
    for (const term of terms) if (paragraphTerms.has(term)) hit += 1
    scored.push({ passage, score: hit / Math.min(terms.size, 60) })
  }
  return scored.sort((a, b) => b.score - a.score || a.passage.startRune - b.passage.startRune)
}

const CITATION_TAG = /\[p:([^\]\s]+)\]/g

/**
 * Pulls the model's own [p:<id>] tags out of a block. The ids are untrusted:
 * the caller keeps only those that exist in the passages it actually sent.
 */
export function parseCitationTags(block: string): { text: string; ids: string[] } {
  const ids: string[] = []
  const text = block
    .replace(CITATION_TAG, (_match, id: string) => { ids.push(id); return '' })
    .replace(/[ \t]+([.,;:!?。，；：！？])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return { text, ids }
}

export interface AnswerBlock {
  text: string
  citations: WorkbenchPassage[]
}

/**
 * Attributes each answer block to at most `max` passages above `threshold`.
 * Blocks with no overlap get no citation rather than a guessed one, so an
 * uncited paragraph is visibly uncited.
 */
export function attributeAnswer(answer: string, passages: readonly WorkbenchPassage[], options: { max?: number; threshold?: number } = {}): AnswerBlock[] {
  const max = options.max ?? 2
  const threshold = options.threshold ?? 0.16
  const byId = new Map(passages.map(passage => [passage.passageId, passage]))

  return splitAnswerBlocks(answer).map(raw => {
    const { text, ids } = parseCitationTags(raw)

    // The model declared its sources: keep only ids that were actually sent, so
    // an invented locator can never reach the UI. A declared [p:none] means the
    // paragraph has no source, and no lexical guess may override that.
    if (ids.length > 0) {
      const picked: WorkbenchPassage[] = []
      const seen = new Set<string>()
      for (const id of ids) {
        const passage = byId.get(id)
        if (!passage || seen.has(passage.passageId)) continue
        seen.add(passage.passageId)
        picked.push(passage)
        if (picked.length === max) break
      }
      return { text, citations: picked }
    }

    // No tags (an older model or a model that ignored the requirement): fall back
    // to the wording overlap, which only ever returns passages that were sent.
    return {
      text,
      citations: rankPassagesForParagraph(text, passages)
        .filter(entry => entry.score >= threshold)
        .slice(0, max)
        .map(entry => entry.passage),
    }
  })
}

/** True when at least one block carries a citation. */
export function hasCitations(blocks: readonly AnswerBlock[]): boolean {
  return blocks.some(block => block.citations.length > 0)
}