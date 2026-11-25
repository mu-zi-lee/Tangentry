import { BookOpen, ChevronDown, Lightbulb } from 'lucide-react'
import { Button } from '../../components/ui'

/**
 * RetrievalGuide is the collapsible onboarding card. It explains what the page
 * does and the two things a first-time user gets wrong: which mode works without
 * an embedding server, and that a locator is a position rather than proof.
 */
export function RetrievalGuide({ open, onToggle, onOpenSettings }: {
  open: boolean
  onToggle: () => void
  onOpenSettings: () => void
}) {
  return (
    <section className={`retrieval-guide${open ? ' is-open' : ''}`} aria-label="Getting started">
      <button type="button" className="retrieval-guide-toggle" onClick={onToggle} aria-expanded={open} aria-controls="retrieval-guide-body">
        <span className="retrieval-guide-icon" aria-hidden="true"><BookOpen size={16} strokeWidth={1.8}/></span>
        <span className="retrieval-guide-title">Getting started</span>
        <span className="retrieval-guide-teaser">{open ? 'Three steps, collapse anytime' : 'First time here? See how it works'}</span>
        <ChevronDown size={16} strokeWidth={2} className="retrieval-guide-chevron" aria-hidden="true"/>
      </button>

      {open && (
        <div className="retrieval-guide-body" id="retrieval-guide-body">
          <ol className="retrieval-steps">
            <li>
              <span className="retrieval-step-num" aria-hidden="true">1</span>
              <div>
                <strong>Pick a document</strong>
                <p>Pick a saved article, subtitle track or PDF. Retrieval only looks at content stored on this machine.</p>
              </div>
            </li>
            <li>
              <span className="retrieval-step-num" aria-hidden="true">2</span>
              <div>
                <strong>Ask a specific question</strong>
                <p>The more specific the question, the better the match. Answers in the middle of a long document are found too, instead of being lost to head/tail truncation.</p>
              </div>
            </li>
            <li>
              <span className="retrieval-step-num" aria-hidden="true">3</span>
              <div>
                <strong>Check the source</strong>
                <p>Every result carries a locator, the exact text and scores. Highlighted words overlap with your question, so you can see why it matched.</p>
              </div>
            </li>
          </ol>

          <div className="retrieval-guide-notes">
            <p className="retrieval-guide-note">
              <Lightbulb size={14} strokeWidth={1.8} aria-hidden="true"/>
              <span><strong>No embedding service?</strong> Switch <strong>Retrieval mode</strong> to <strong>Lexical only</strong>: it runs entirely on this machine and needs no model service. Hybrid and Semantic only require one under <strong>Retrieval settings</strong>.</span>
            </p>
            <p className="retrieval-guide-note">
              <Lightbulb size={14} strokeWidth={1.8} aria-hidden="true"/>
              <span><strong>A locator is not proof.</strong> It only states where the passage sits in the source; whether a claim holds still needs your own check.</span>
            </p>
          </div>

          <div className="retrieval-guide-actions">
            <Button variant="quiet" type="button" onClick={onOpenSettings}>Configure embedding and weights</Button>
            <Button variant="quiet" type="button" onClick={onToggle}>Collapse guide</Button>
          </div>
        </div>
      )}
    </section>
  )
}
