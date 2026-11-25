import { useEffect, useState } from 'react'
import { Check, ChevronDown, CircleCheck, Copy, Info, TriangleAlert } from 'lucide-react'
import { Button } from '../../components/ui'
import type { ContentItem } from '../../shared/api/types'
import { passageChipLabel, retrievalStatusView, type RetrievalTone } from '../ai/retrievalPresentation'
import {
  compactLocator,
  defaultWorkbenchOptions,
  highlightSegments,
  passagePage,
  noResultGuidance,
  sortPassages,
  type PassageSort,
  passagePosition,
  type NoResultAction,
  type WorkbenchOptions,
  queryTerms,
  workbenchScoreLabel,
  workbenchScoreWidth,
  type WorkbenchPassage,
  type WorkbenchResult,
} from './workbench'
import { PassageContext } from './PassageContext'
import { paginate } from './workbenchPrefs'

const toneIcon: Record<RetrievalTone, typeof Info> = {
  ok: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: TriangleAlert,
}

function ScoreBar({ label, value, kind, title }: { label: string; value: number; kind: string; title?: string }) {
  return (
    <span className={`retrieval-score retrieval-score-${kind}`} title={title ?? `${label} score ${workbenchScoreLabel(value)}`}>
      <span className="retrieval-score-label">{label}</span>
      <span className="retrieval-score-track" aria-hidden="true">
        <span className="retrieval-score-fill" style={{ width: `${workbenchScoreWidth(value)}%` }}/>
      </span>
      <span className="retrieval-score-value">{workbenchScoreLabel(value)}</span>
    </span>
  )
}

function PassageText({ text, terms, highlight }: { text: string; terms: readonly string[]; highlight: boolean }) {
  if (!highlight) return <p className="retrieval-text">{text}</p>
  const segments = highlightSegments(text, terms)
  return (
    <p className="retrieval-text">
      {segments.map((segment, index) => segment.match
        ? <mark key={index} className="retrieval-mark">{segment.text}</mark>
        : <span key={index}>{segment.text}</span>)}
    </p>
  )
}

/**
 * RetrievalResultView renders the server's retrieval outcome: the distinct
 * status, budget metrics and the selected passages with their exact text,
 * locators and scores. It never fabricates a passage, and a coverage-limited
 * status keeps its passages visible (B-T25). Long result lists are paginated for
 * readability, and the remaining count is always shown so a short list is never
 * mistaken for the whole result.
 */
const noResultLabels: Record<NoResultAction, string> = {
  'enable-sweep': 'Enable semantic sweep',
  'widen-budget': 'Widen budget to 120,000',
  'try-hybrid': 'Switch to Hybrid',
  clear: 'Clear question',
}

export function RetrievalResultView({ result, selected, onRead, question = '', highlight = true, pageSize = 10, options, onNoResultAction, sort = 'relevance', onSortChange, elapsedMs, focusPassage }: {
  result: WorkbenchResult
  selected?: ContentItem
  onRead: (item: ContentItem, page?: number) => void
  question?: string
  highlight?: boolean
  pageSize?: number
  options?: WorkbenchOptions
  onNoResultAction?: (action: NoResultAction) => void
  sort?: PassageSort
  onSortChange?: (sort: PassageSort) => void
  elapsedMs?: number
  /** A passage to reveal: expands the list to it, scrolls and flashes it. */
  focusPassage?: { id: string; token: number } | null
}) {
  const [copied, setCopied] = useState('')
  const [moreMetrics, setMoreMetrics] = useState(false)
  const [contextFor, setContextFor] = useState('')
  const [shown, setShown] = useState(pageSize)
  // A new search or a changed page size restarts from the first page.
  useEffect(() => { setShown(pageSize) }, [result, pageSize])
  const view = retrievalStatusView(result.retrieval.status)
  const ToneIcon = toneIcon[view.tone]
  const terms = highlight ? queryTerms(question) : []
  const ordered = sortPassages(result.passages, sort)
  const { visible, remaining } = paginate(ordered, shown)

  // Reveal a passage cited by the answer: expand until it is rendered, then
  // scroll to it and flash it so the reader lands on the exact card.
  useEffect(() => {
    if (!focusPassage) return
    const index = ordered.findIndex(passage => passage.passageId === focusPassage.id)
    if (index === -1) return
    setShown(current => (index + 1 > current ? index + 1 : current))
  }, [focusPassage, ordered])

  useEffect(() => {
    if (!focusPassage) return
    const frame = requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(`[data-passage-id="${CSS.escape(focusPassage.id)}"]`)
      if (!node) return
      node.scrollIntoView({ block: 'center', behavior: 'smooth' })
      node.classList.add('is-focused')
      window.setTimeout(() => node.classList.remove('is-focused'), 1800)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusPassage, shown])

  const copy = async (locator: string) => {
    try {
      await navigator.clipboard.writeText(locator)
      setCopied(locator)
    } catch {
      // Clipboard access can be refused; the locator stays visible on screen.
    }
  }

  return (
    <div className="retrieval-result" id="retrieval-results" tabIndex={-1} aria-label="Search results">
      <div className={`retrieval-status retrieval-status-${view.tone}`} role="status" aria-label="Retrieval status" data-status={result.retrieval.status}>
        <span className="retrieval-status-icon" aria-hidden="true"><ToneIcon size={16} strokeWidth={1.9}/></span>
        <span className="retrieval-status-body">
          <span className="retrieval-status-label">{view.label}</span>
          {view.hint && <span className="retrieval-status-hint">{view.hint}</span>}
        </span>
      </div>

      <dl className="retrieval-metrics">
        <div><dt>Matched passages</dt><dd>{result.passages.length}</dd></div>
        <div><dt>Mode</dt><dd>{result.retrieval.mode || '—'}</dd></div>
        <div><dt>Rerank</dt><dd>{result.retrieval.rerank.enabled ? (result.retrieval.rerank.model || 'Enabled') : 'Off'}</dd></div>
        {(typeof result.elapsedMs === 'number' || typeof elapsedMs === 'number') && (
          <div>
            <dt>Search time</dt>
            <dd title={typeof result.elapsedMs === 'number' ? 'Server-side selection time' : 'Client timing (the server did not report a duration)'}>
              {typeof result.elapsedMs === 'number' ? result.elapsedMs : elapsedMs} ms
            </dd>
          </div>
        )}
        {moreMetrics && (
          <>
            <div><dt>Context chars</dt><dd>{result.contextChars.toLocaleString('en-US')}</dd></div>
            <div><dt>Embedding model</dt><dd>{result.retrieval.embedding.model || 'Off'}</dd></div>
            <div><dt>Embedding requests</dt><dd>{result.retrieval.embedding.requests}</dd></div>
            <div><dt>Cache hits</dt><dd>{result.retrieval.embedding.cacheHits ?? 0}</dd></div>
            <div><dt>Budget status</dt><dd>{result.retrieval.embedding.budgetStatus || '—'}</dd></div>
          </>
        )}
      </dl>
      <div className="retrieval-result-bar">
        {onSortChange && (
          <div className="retrieval-segmented retrieval-sort" role="group" aria-label="Result order">
            <button type="button" className={`retrieval-segment${sort !== 'source' ? ' is-active' : ''}`} aria-pressed={sort !== 'source'} onClick={() => onSortChange('relevance')}>By relevance</button>
            <button type="button" className={`retrieval-segment${sort === 'source' ? ' is-active' : ''}`} aria-pressed={sort === 'source'} onClick={() => onSortChange('source')}>Document order</button>
          </div>
        )}
        <button type="button" className="retrieval-more-metrics" aria-expanded={moreMetrics} onClick={() => setMoreMetrics(value => !value)}>
          {moreMetrics ? 'Fewer metrics' : 'More metrics'}
        </button>
      </div>

      {result.passages.length > visible.length && (
        <p className="retrieval-hidden" role="note">
          Showing {visible.length} of {result.passages.length} passages; {remaining} more are not expanded yet — they were selected by the server too.
        </p>
      )}

      {visible.length > 0 ? (
        <ol className="retrieval-passages" aria-label="Matched source passages">
          {visible.map((passage: WorkbenchPassage, index) => (
            <li key={passage.passageId} className="retrieval-passage" data-passage-id={passage.passageId}>
              <div className="retrieval-passage-head">
                <span className="retrieval-rank" aria-hidden="true">{index + 1}</span>
                <span className="retrieval-chip">{passageChipLabel(passage)}</span>
                <span className="retrieval-position" title={passage.locator}>{passagePosition(passage)}</span>
                <code className="retrieval-locator" title={passage.locator}>{compactLocator(passage.locator)}</code>
                <button
                  type="button"
                  className="retrieval-copy"
                  onClick={() => void copy(passage.locator)}
                  title="Copy locator"
                  aria-label={`Copy locator ${passage.locator}`}
                >
                  {copied === passage.locator ? <Check size={13} strokeWidth={2}/> : <Copy size={13} strokeWidth={1.8}/>}
                </button>
              </div>

              <div className="retrieval-scores">
                <ScoreBar label="Hybrid" value={passage.score} kind="hybrid" title={`Hybrid score ${workbenchScoreLabel(passage.score)} (normalised to the best passage of this run)`}/>
                <ScoreBar label="Lexical" value={passage.lexicalScore} kind="lexical" title={`Lexical score ${workbenchScoreLabel(passage.lexicalScore)} (absolute)`}/>
                <ScoreBar label="Semantic" value={passage.cosineScore} kind="semantic" title={`Semantic cosine ${workbenchScoreLabel(passage.cosineScore)}`}/>
                {(passage.rerankScore ?? 0) > 0 && (
                  <ScoreBar label="Rerank" value={passage.rerankScore ?? 0} kind="rerank" title={`Rerank score ${workbenchScoreLabel(passage.rerankScore ?? 0)} (relative to this request)`}/>
                )}
              </div>

              <PassageText text={passage.text} terms={terms} highlight={highlight}/>

              {contextFor === passage.passageId && passage.source === 'pdf' && passagePage(passage.locator) !== null && (
                <PassageContext
                  contentId={passage.contentId}
                  page={passagePage(passage.locator)!}
                  startRune={passage.startRune}
                  endRune={passage.endRune}
                />
              )}

              <div className="retrieval-passage-foot">
                <span title="Source version">Version <code>{passage.sourceVersion || '—'}</code></span>
                <span title="Source text SHA-256">Checksum <code>{passage.textSha256 ? `${passage.textSha256.slice(0, 12)}…` : '—'}</code></span>
                <span title="Source rune range">Range <code>{passage.startRune}–{passage.endRune}</code></span>
                {passage.source === 'pdf' && passagePage(passage.locator) !== null && (
                  <button
                    type="button"
                    className="retrieval-context-toggle"
                    aria-expanded={contextFor === passage.passageId}
                    onClick={() => setContextFor(current => current === passage.passageId ? '' : passage.passageId)}
                  >
                    <ChevronDown size={12} strokeWidth={2} aria-hidden="true" className={contextFor === passage.passageId ? 'is-open' : undefined}/>
                    {contextFor === passage.passageId ? 'Hide context' : 'Show context'}
                  </button>
                )}
                {selected && selected.id === passage.contentId && (
                  <Button
                    variant="quiet"
                    type="button"
                    onClick={() => onRead(selected, passagePage(passage.locator) ?? undefined)}
                  >
                    {passagePage(passage.locator) !== null ? `Go to page ${passagePage(passage.locator)}` : 'Open source'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <section className="empty-state retrieval-noresult">
          <h2>{noResultGuidance(result.retrieval.status, options ?? defaultWorkbenchOptions()).title}</h2>
          <p>{noResultGuidance(result.retrieval.status, options ?? defaultWorkbenchOptions()).reason}</p>
          {onNoResultAction && (
            <div className="retrieval-noresult-actions">
              {noResultGuidance(result.retrieval.status, options ?? defaultWorkbenchOptions()).actions.map(action => (
                <Button key={action} variant="secondary" type="button" onClick={() => onNoResultAction(action)}>
                  {noResultLabels[action]}
                </Button>
              ))}
            </div>
          )}
        </section>
      )}

      {remaining > 0 && (
        <div className="retrieval-more">
          <Button variant="secondary" type="button" onClick={() => setShown(current => current + pageSize)}>
            Load more ({remaining} left)
          </Button>
          <Button variant="quiet" type="button" onClick={() => setShown(result.passages.length)}>
            Expand all
          </Button>
        </div>
      )}
    </div>
  )
}
