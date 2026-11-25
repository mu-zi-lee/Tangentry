import { lazy, Suspense } from 'react'
import { CircleAlert, CornerDownRight, Info, Sparkles } from 'lucide-react'
import { attributeAnswer, hasCitations } from './answerCitations'
import { compactCitationIds, passagePosition, stripModelCitations, type WorkbenchPassage } from './workbench'

const MarkdownRenderer = lazy(() => import('../notes/MarkdownRenderer'))

/**
 * RetrievalAnswer shows a model answer grounded in the retrieved passages. Each
 * paragraph carries its own citations: positions are computed from the passages
 * retrieval returned, never read out of the model's prose, so a wrong page
 * cannot be shown. Also states that a locator marks a position, not correctness,
 * and that OCR-derived text may contain recognition errors.
 */
export function RetrievalAnswer({ question, answer, passages, maxContextRunes, pending, error, onSettings, onJump }: {
  question: string
  answer: string | null
  passages: readonly WorkbenchPassage[]
  maxContextRunes: number
  pending: boolean
  error: string
  onSettings: () => void
  onJump: (passageId: string) => void
}) {
  if (error) {
    return (
      <div className="retrieval-answer is-error" role="alert">
        <span className="retrieval-answer-head"><CircleAlert size={16} strokeWidth={1.9} aria-hidden="true"/>Could not generate an answer</span>
        <p className="retrieval-answer-error">{error}</p>
        <button type="button" className="retrieval-answer-link" onClick={onSettings}>Check the chat model settings</button>
      </div>
    )
  }

  if (pending && !answer) {
    return (
      <div className="retrieval-answer" role="status" aria-live="polite">
        <span className="retrieval-answer-head"><Sparkles size={16} strokeWidth={1.9} aria-hidden="true"/>Generating an answer from the sources…</span>
        <p className="retrieval-answer-hint">The model reads the {passages.length} passages found in this run; this usually takes a few seconds.</p>
      </div>
    )
  }

  if (!answer) return null

  const blocks = attributeAnswer(answer, passages)
  const ocrDerived = passages.some(passage => passage.sourceVersion.includes('extractor=local-paddleocr'))

  return (
    <div className="retrieval-answer" aria-label="Model answer">
      <header className="retrieval-answer-head">
        <Sparkles size={16} strokeWidth={1.9} aria-hidden="true"/>
        <span>Answer from the sources</span>
        <span className="retrieval-answer-badge">AI</span>
      </header>
      {question && <p className="retrieval-answer-question">Question: {question}</p>}

      <div className="retrieval-answer-body">
        {blocks.map((block, index) => (
          <div className="retrieval-answer-block" key={index}>
            <Suspense fallback={<p className="retrieval-answer-hint">{compactCitationIds(stripModelCitations(block.text))}</p>}>
              <MarkdownRenderer>{compactCitationIds(stripModelCitations(block.text))}</MarkdownRenderer>
            </Suspense>
            {block.citations.length > 0 && (
              <p className="retrieval-answer-citation">
                <CornerDownRight size={12} strokeWidth={2} aria-hidden="true"/>
                <span className="retrieval-answer-citation-label">Source</span>
                {block.citations.map(passage => (
                  <button
                    key={passage.passageId}
                    type="button"
                    className="retrieval-answer-citation-chip"
                    title={`${passage.locator} — jump to this passage`}
                    onClick={() => onJump(passage.passageId)}
                  >
                    {passagePosition(passage)}
                  </button>
                ))}
              </p>
            )}
          </div>
        ))}
      </div>

      {!hasCitations(blocks) && (
        <p className="retrieval-answer-hint">
          No paragraph could be matched to a retrieved passage, so no source is attached. Check the passages below yourself.
        </p>
      )}

      <p className="retrieval-answer-provenance">
        <Info size={13} strokeWidth={1.8} aria-hidden="true"/>
        Answer generated from {passages.length} passages (up to {maxContextRunes.toLocaleString('en-US')} characters). Citations are the positions of the
        passages this run retrieved, not a claim that the answer is correct; a locator only marks a position.
        {ocrDerived && ' Some source text came from OCR and may contain recognition errors.'}
      </p>
    </div>
  )
}