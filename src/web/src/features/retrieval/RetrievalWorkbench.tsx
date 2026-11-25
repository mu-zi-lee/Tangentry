import { useEffect, useRef, useState } from 'react'
import { ChevronDown, MessageSquareText, SlidersHorizontal, TextSearch } from 'lucide-react'
import { Button, Input, Select } from '../../components/ui'
import { APIError, request } from '../../shared/api/client'
import type { ContentItem } from '../../shared/api/types'
import { RetrievalSettingsSection } from '../ai/RetrievalSettingsPanel'
import { loadRetrievalSettings } from '../ai/retrievalSettingsApi'
import { RetrievalAnswer } from './RetrievalAnswer'
import { RetrievalGuide } from './RetrievalGuide'
import { RetrievalOptionsPanel } from './RetrievalOptionsPanel'
import { RetrievalResultView } from './RetrievalResultView'
import {
  ANSWER_MAX_CONTEXT_RUNES,
  answerBody,
  answerFromResponse,
  canSearch,
  contextBudgetPresets,
  QUESTION_HINT_FROM,
  QUESTION_MAX_LENGTH,
  addRecentSearch,
  errorGuidance,
  isOCRDerived,
  normalizeOptions,
  normalizeResult,
  pickInitialContent,
  resultFromError,
  routeFromSearch,
  searchBody,
  searchPath,
  workbenchModes,
  type WorkbenchCeilings,
  type NoResultAction,
  type PassageSort,
  type WorkbenchOptions,
  type WorkbenchResult,
} from './workbench'
import { PREFS_KEY, defaultPrefs, parsePrefs, serializePrefs, type WorkbenchPrefs } from './workbenchPrefs'
import './retrieval.css'

function readPrefs(): WorkbenchPrefs {
  try {
    return parsePrefs(window.localStorage.getItem(PREFS_KEY))
  } catch {
    return defaultPrefs()
  }
}

/**
 * RetrievalWorkbench surfaces owner B's question-relevant retrieval (FR-02) as
 * a standalone page: pick a saved content, ask a question, inspect the selected
 * passages, and optionally have the configured chat model answer from them.
 *
 * Retrieval settings (embedding + rerank) live on this page too, so a user never
 * has to leave the workbench to fix a `lexical_only` run. The server owns
 * selection, locators and scoring; this page only sends requests and renders
 * what comes back. A locator is a position, not proof of correctness.
 */
export function RetrievalWorkbench({ items, onRead, onOpenSettings, onOpenSamples, routeSearch = '', onRouteChange }: {
  items: ContentItem[]
  onRead: (item: ContentItem, page?: number) => void
  onOpenSettings?: () => void
  onOpenSamples?: () => void
  /** location.search: restores a shared query (additive contentId / q params). */
  routeSearch?: string
  onRouteChange?: (path: string) => void
}) {
  const initialRoute = routeFromSearch(routeSearch)
  const [contentId, setContentId] = useState(initialRoute.contentId)
  const [question, setQuestion] = useState(initialRoute.question)
  const [prefs, setPrefs] = useState<WorkbenchPrefs>(readPrefs)
  const [ceilings, setCeilings] = useState<WorkbenchCeilings | undefined>()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<WorkbenchResult | null>(null)
  const [error, setError] = useState('')
  const [errorInfo, setErrorInfo] = useState<{ code: string; status: number } | null>(null)
  const [asked, setAsked] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [answerPassages, setAnswerPassages] = useState(0)
  const [answering, setAnswering] = useState(false)
  const [elapsedMs, setElapsedMs] = useState<number | undefined>()
  const [answerError, setAnswerError] = useState('')
  const running = useRef<AbortController | null>(null)
  const questionRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => () => running.current?.abort(), [])

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, serializePrefs(prefs))
    } catch {
      // A full or blocked storage must not break the page.
    }
  }, [prefs])

  useEffect(() => {
    const controller = new AbortController()
    void loadRetrievalSettings()
      .then(settings => {
        if (controller.signal.aborted) return
        const next = { maxEmbeddingRequests: settings.maxEmbeddingRequests, maxEmbeddingChars: settings.maxEmbeddingChars }
        setCeilings(next)
        setPrefs(current => ({ ...current, options: normalizeOptions(current.options, next) }))
      })
      .catch(() => { /* settings unavailable: keep the labelled defaults */ })
    return () => controller.abort()
  }, [])

  // Entry shortcut: pick a content automatically so the core task is one Enter
  // instead of a dropdown round-trip. The last used content wins when present.
  useEffect(() => {
    if (contentId !== '' || items.length === 0) return
    const initial = pickInitialContent(items, prefs.lastContentId)
    if (initial) setContentId(initial)
  }, [items, contentId, prefs.lastContentId])

  // A shared link that carries both content and question shows results at once.
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current) return
    if (!initialRoute.contentId || !initialRoute.question) return
    autoRan.current = true
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const options = prefs.options
  const selected = items.find(item => item.id === contentId)
  const contentOptions = items.map(item => ({ value: item.id, label: item.title || item.id }))

  const patchOptions = (patch: Partial<WorkbenchOptions>) =>
    setPrefs(current => ({ ...current, options: normalizeOptions({ ...current.options, ...patch }, ceilings) }))
  const patchPrefs = (patch: Partial<WorkbenchPrefs>) => setPrefs(current => ({ ...current, ...patch }))
  const resetOptions = () => setPrefs(current => ({ ...current, options: normalizeOptions(undefined, ceilings) }))
  const openSettings = () => onOpenSettings?.()

  async function runWith(override?: WorkbenchOptions): Promise<WorkbenchResult | null> {
    const effective = override ?? options
    if (!canSearch(contentId, question, pending)) return null
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setPending(true)
    setError('')
    setErrorInfo(null)
    setResult(null)
    setAnswer(null)
    setAnswerError('')
    const trimmed = question.trim()
    const started = performance.now()
    try {
      const raw = await request<unknown>('/ai/retrieval/search', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify(searchBody(contentId, trimmed, effective)),
      })
      const value = normalizeResult(raw)
      if (!value) {
        setError('The search returned an unreadable response. Please retry.')
        setErrorInfo({ code: 'bad_payload', status: 0 })
        return null
      }
      setElapsedMs(Math.round(performance.now() - started))
      setResult(value)
      setAsked(trimmed)
      setPrefs(current => ({ ...current, lastContentId: contentId, recent: addRecentSearch(current.recent, { contentId, question: trimmed }) }))
      onRouteChange?.(searchPath(contentId, trimmed))
      return value
    } catch (cause) {
      if (controller.signal.aborted) return null
      // Some retrieval statuses map to 4xx but are still renderable outcomes.
      const recovered = resultFromError(cause)
      if (recovered) {
        setResult(recovered)
        setAsked(trimmed)
        return recovered
      }
      setError(cause instanceof APIError ? cause.message : 'The search request failed. Please retry.')
      setErrorInfo(cause instanceof APIError ? { code: cause.code, status: cause.status } : { code: 'unknown', status: 0 })
      return null
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  async function run(): Promise<WorkbenchResult | null> { return runWith() }

  // answer runs retrieval when it has not run yet, then asks the configured chat
  // model to answer from the same selection. The second retrieval is cheap: the
  // passage vectors come from the local cache.
  async function answerFromDocument() {
    if (!canSearch(contentId, question, pending)) return
    setAnswering(true)
    setAnswerError('')
    setAnswer(null)
    const trimmed = question.trim()
    try {
      const have = result ?? await run()
      if (!have) return
      // The chat endpoint checks the AI configuration revision, so read it
      // immediately before asking (a settings change invalidates older values).
      const ai = await request<{ revision: number }>('/ai/settings')
      const response = await request<{ messages?: unknown; retrieval?: { passages?: unknown[] } }>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify(answerBody(contentId, trimmed, options, ai.revision ?? 0)),
      })
      const text = answerFromResponse(response)
      if (!text) {
        setAnswerError('The model returned no usable answer.')
        return
      }
      // Report what actually grounded the answer, not what the search displayed.
      setAnswerPassages(Array.isArray(response.retrieval?.passages) ? response.retrieval!.passages!.length : 0)
      setAnswer(text)
    } catch (cause) {
      if (cause instanceof APIError) setAnswerError(cause.message)
      else setAnswerError('Could not generate an answer. Please retry.')
    } finally {
      setAnswering(false)
    }
  }

  // Every empty-state action changes a real option and re-runs, so the user is
  // never left guessing what to try next.
  function applyNoResultAction(action: NoResultAction) {
    if (action === 'clear') {
      setQuestion('')
      setResult(null)
      questionRef.current?.focus()
      return
    }
    const patch = action === 'enable-sweep' ? { sweepCandidates: 90 }
      : action === 'widen-budget' ? { maxChars: 120000 }
      : { mode: 'hybrid' as const }
    setPrefs(current => ({ ...current, options: normalizeOptions({ ...current.options, ...patch }, ceilings) }))
    // Re-run with the patched options on the next tick.
    setTimeout(() => { void runWith({ ...options, ...patch }) }, 0)
  }

  const answerable = canSearch(contentId, question, pending) && !answering

  // Esc clears the query and results and returns focus to the input, so a
  // keyboard user can start over without reaching for the mouse.
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return
    if (!question && !result && !answer) return
    event.stopPropagation()
    running.current?.abort()
    setQuestion('')
    setResult(null)
    setAnswer(null)
    setAnswerError('')
    setError('')
    setPending(false)
    questionRef.current?.focus()
  }

  return (
    <section className="retrieval-workbench" aria-label="Retrieval service" onKeyDown={onKeyDown}>
      <header className="retrieval-header">
        <span className="retrieval-header-icon" aria-hidden="true"><TextSearch size={20} strokeWidth={1.8}/></span>
        <div>
          <h1>Retrieval service</h1>
          <p>Picks the passages relevant to your question from local content, with their position, scores and budget usage. Retrieval runs on the server; this page only renders the result.</p>
        </div>
      </header>

      <RetrievalGuide
        open={prefs.guideOpen}
        onToggle={() => patchPrefs({ guideOpen: !prefs.guideOpen })}
        onOpenSettings={() => patchPrefs({ settingsOpen: true })}
      />


      <RetrievalOptionsPanel
        open={prefs.advancedOpen}
        onToggle={() => patchPrefs({ advancedOpen: !prefs.advancedOpen })}
        prefs={prefs}
        ceilings={ceilings}
        pending={pending}
        onOptions={patchOptions}
        onPrefs={patchPrefs}
        onReset={resetOptions}
        onOpenSettings={openSettings}
      />

      <section className={`retrieval-settings-panel${prefs.settingsOpen ? ' is-open' : ''}`} aria-label="Retrieval settings">
        <button
          type="button"
          className="retrieval-settings-toggle"
          onClick={() => patchPrefs({ settingsOpen: !prefs.settingsOpen })}
          aria-expanded={prefs.settingsOpen}
          aria-controls="retrieval-settings-body"
        >
          <SlidersHorizontal size={15} strokeWidth={1.8} aria-hidden="true"/>
          <span className="retrieval-settings-title">Retrieval settings</span>
          <span className="retrieval-settings-summary">Embedding service, rerank and weights — configurable without leaving this page</span>
          <ChevronDown size={16} strokeWidth={2} className="retrieval-settings-chevron" aria-hidden="true"/>
        </button>
        {prefs.settingsOpen && (
          <div className="retrieval-settings-body" id="retrieval-settings-body">
            <RetrievalSettingsSection active={prefs.settingsOpen}/>
          </div>
        )}
      </section>

      <form className="retrieval-form" onSubmit={event => { event.preventDefault(); void run() }}>
        <div className="retrieval-search-head">
          <h2>Search</h2>
          <span className="retrieval-search-scope" title={selected?.title ?? ''}>
            {selected ? selected.title : 'Pick a document above'}
          </span>
        </div>
        <div className="retrieval-form-row">
          <label className="retrieval-field">
            <span>Document</span>
            <Select
              value={contentId}
              onChange={event => setContentId(event.target.value)}
              options={contentOptions}
              placeholder={items.length ? 'Choose a document to search' : 'Your library is empty'}
              disabled={pending || items.length === 0}
              aria-label="Document to search"
            />
          </label>

          <label className="retrieval-field retrieval-field-wide">
            <span>Question</span>
            <span className="field">
              <Input
                value={question}
                onChange={event => setQuestion(event.target.value)}
                placeholder="e.g. What conclusion does the middle of this document reach?"
                disabled={pending}
                autoFocus
                maxLength={QUESTION_MAX_LENGTH}
                ref={questionRef}
                aria-label="Question"
              />
            </span>
          </label>

          <Button variant="primary" type="submit" isLoading={pending} disabled={!canSearch(contentId, question, pending)}>
            {pending ? 'Searching' : 'Search'}
          </Button>
          <Button
            variant="secondary"
            type="button"
            icon={<MessageSquareText size={15} strokeWidth={1.8}/>}
            isLoading={answering}
            disabled={!answerable}
            onClick={() => void answerFromDocument()}
          >
            Answer from sources
          </Button>
        </div>

        {prefs.recent.length > 0 && (
          <div className="retrieval-recent" role="group" aria-label="Recent searches">
            <span className="retrieval-presets-label">Recent</span>
            {prefs.recent.map(entry => (
              <button
                key={`${entry.contentId}:${entry.question}`}
                type="button"
                className="retrieval-preset"
                title={entry.question}
                onClick={() => {
                  setContentId(entry.contentId)
                  setQuestion(entry.question)
                  questionRef.current?.focus()
                }}
              >
                {entry.question.length > 18 ? `${entry.question.slice(0, 18)}…` : entry.question}
              </button>
            ))}
          </div>
        )}

        {question.length >= QUESTION_HINT_FROM && (
          <p className="field-hint" role="status">The question is long ({question.length}/{QUESTION_MAX_LENGTH} characters). Consider shortening it.</p>
        )}

        <div className="retrieval-quick">
          <div className="retrieval-segmented" role="group" aria-label="Retrieval mode">
            {workbenchModes.map(item => (
              <button
                key={item.value}
                type="button"
                className={`retrieval-segment${options.mode === item.value ? ' is-active' : ''}`}
                onClick={() => patchOptions({ mode: item.value })}
                disabled={pending}
                aria-pressed={options.mode === item.value}
                title={item.hint}
              >
                {item.label}
              </button>
            ))}
          </div>

          <span className="retrieval-kbd-hint" aria-hidden="true">Enter to search · Esc to clear</span>

          <div className="retrieval-presets" role="group" aria-label="Context budget">
            <span className="retrieval-presets-label">Context</span>
            {contextBudgetPresets.map(preset => (
              <button
                key={preset.value}
                type="button"
                className={`retrieval-preset${options.maxChars === preset.value ? ' is-active' : ''}`}
                onClick={() => patchOptions({ maxChars: preset.value })}
                disabled={pending}
                aria-pressed={options.maxChars === preset.value}
              >
                {preset.label}
              </button>
            ))}
            {contextBudgetPresets.every(preset => preset.value !== options.maxChars) && (
              <span className="retrieval-preset is-active is-custom">Custom {options.maxChars.toLocaleString('en-US')}</span>
            )}
          </div>
        </div>
      </form>

      {!result && !error && !pending && items.length > 0 && (
        <p className="field-hint retrieval-initial-hint">
          Type a question above and press Enter to search. Open Getting started to learn what the mode and budget mean.
        </p>
      )}


      {items.length === 0 && (
        <section className="empty-state">
          <h2>Your library is empty</h2>
          <p>Retrieval only looks at content you saved. Load the built-in samples, or save something from Discover.</p>
          {onOpenSamples && (
            <div className="retrieval-noresult-actions">
              <Button variant="primary" type="button" onClick={onOpenSamples}>Load sample documents</Button>
            </div>
          )}
        </section>
      )}

      {error && (
        <div className="error-panel" role="alert">
          <div>
            <strong>{errorGuidance(errorInfo?.code ?? 'unknown', errorInfo?.status ?? 0).title}</strong>
            <p>{error}</p>
            <p className="field-hint">{errorGuidance(errorInfo?.code ?? 'unknown', errorInfo?.status ?? 0).hint}</p>
          </div>
          {errorGuidance(errorInfo?.code ?? 'unknown', errorInfo?.status ?? 0).retry && (
            <Button variant="secondary" type="button" disabled={pending} onClick={() => void run()}>Retry</Button>
          )}
        </div>
      )}

      {pending && !result && (
        <div className="retrieval-skeleton" role="status" aria-live="polite" aria-label="Searching">
          <span/><span/><span/>
        </div>
      )}

      {(answering || answer || answerError) && (
        <RetrievalAnswer
          question={asked}
          answer={answer}
          passageCount={answerPassages || (result?.passages.length ?? 0)}
          maxContextRunes={Math.min(options.maxChars, ANSWER_MAX_CONTEXT_RUNES)}
          ocrDerived={result ? isOCRDerived(result.passages) : false}
          pending={answering}
          error={answerError}
          onSettings={openSettings}
        />
      )}

      {result && (
        <a
          className="retrieval-skip"
          href="#retrieval-results"
          onClick={event => {
            // An anchor only scrolls; move focus too so Tab continues in the results.
            event.preventDefault()
            const target = document.getElementById('retrieval-results')
            target?.focus()
            target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
          }}
        >
          Skip to results ({result.passages.length})
        </a>
      )}

      {result && (
        <RetrievalResultView
          result={result}
          selected={selected}
          onRead={onRead}
          question={asked}
          highlight={prefs.highlight}
          pageSize={prefs.pageSize}
          options={options}
          onNoResultAction={applyNoResultAction}
          sort={prefs.sort}
          onSortChange={(sort: PassageSort) => patchPrefs({ sort })}
          elapsedMs={elapsedMs}
        />
      )}
    </section>
  )
}