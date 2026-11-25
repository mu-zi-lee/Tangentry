import { lazy, Suspense } from 'react'
import { CircleAlert, Info, Sparkles } from 'lucide-react'
import { compactCitationIds } from './workbench'

const MarkdownRenderer = lazy(() => import('../notes/MarkdownRenderer'))

/**
 * RetrievalAnswer shows a model answer grounded in the retrieved passages. It
 * states provenance plainly: the answer is generated from the selection, the
 * locators are positions rather than proof, and OCR-derived text may contain
 * recognition errors. It never renders an empty answer as if it were real.
 */
export function RetrievalAnswer({ question, answer, passageCount, maxContextRunes, ocrDerived, pending, error, onSettings }: {
  question: string
  answer: string | null
  passageCount: number
  maxContextRunes: number
  ocrDerived: boolean
  pending: boolean
  error: string
  onSettings: () => void
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
        <p className="retrieval-answer-hint">The model reads the {passageCount} passages found in this run; this usually takes a few seconds.</p>
      </div>
    )
  }

  if (!answer) return null

  return (
    <div className="retrieval-answer" aria-label="Model answer">
      <header className="retrieval-answer-head">
        <Sparkles size={16} strokeWidth={1.9} aria-hidden="true"/>
        <span>Answer from the sources</span>
        <span className="retrieval-answer-badge">AI</span>
      </header>
      {question && <p className="retrieval-answer-question">Question: {question}</p>}
      <div className="retrieval-answer-body">
        <Suspense fallback={<p className="retrieval-answer-hint">{compactCitationIds(answer)}</p>}>
          <MarkdownRenderer>{compactCitationIds(answer)}</MarkdownRenderer>
        </Suspense>
      </div>
      <p className="retrieval-answer-provenance">
        <Info size={13} strokeWidth={1.8} aria-hidden="true"/>
        Answer generated from {passageCount} passages (up to {maxContextRunes.toLocaleString('en-US')} characters). A locator only marks a position, not correctness; check it against the passages below.
        {ocrDerived && ' Some source text came from OCR and may contain recognition errors.'}
      </p>
    </div>
  )
}