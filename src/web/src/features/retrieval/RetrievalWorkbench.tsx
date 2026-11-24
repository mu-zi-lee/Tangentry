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
    try {
      const raw = await request<unknown>('/ai/retrieval/search', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify(searchBody(contentId, trimmed, effective)),
      })
      const value = normalizeResult(raw)
      if (!value) {
        setError('检索返回了无法识别的结果，请重试。')
        setErrorInfo({ code: 'bad_payload', status: 0 })
        return null
      }
      setResult(value)
      setAsked(trimmed)
      setPrefs(current => ({ ...current, lastContentId: contentId }))
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
      setError(cause instanceof APIError ? cause.message : '检索请求失败，请重试。')
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
        setAnswerError('模型没有返回可用的回答内容。')
        return
      }
      // Report what actually grounded the answer, not what the search displayed.
      setAnswerPassages(Array.isArray(response.retrieval?.passages) ? response.retrieval!.passages!.length : 0)
      setAnswer(text)
    } catch (cause) {
      if (cause instanceof APIError) setAnswerError(cause.message)
      else setAnswerError('生成回答失败，请重试。')
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

  return (
    <section className="retrieval-workbench" aria-label="原文检索">
      <header className="retrieval-header">
        <span className="retrieval-header-icon" aria-hidden="true"><TextSearch size={20} strokeWidth={1.8}/></span>
        <div>
          <h1>原文检索</h1>
          <p>按问题从本机内容中选取相关原文片段，并显示定位、得分与预算用量。检索由服务端完成，此处只展示结果。</p>
        </div>
      </header>

      <RetrievalGuide
        open={prefs.guideOpen}
        onToggle={() => patchPrefs({ guideOpen: !prefs.guideOpen })}
        onOpenSettings={() => patchPrefs({ settingsOpen: true })}
      />

      <form className="retrieval-form" onSubmit={event => { event.preventDefault(); void run() }}>
        <div className="retrieval-form-row">
          <label className="retrieval-field">
            <span>内容</span>
            <Select
              value={contentId}
              onChange={event => setContentId(event.target.value)}
              options={contentOptions}
              placeholder={items.length ? '选择要检索的内容' : '资料库还没有内容'}
              disabled={pending || items.length === 0}
              aria-label="选择要检索的内容"
            />
          </label>

          <label className="retrieval-field retrieval-field-wide">
            <span>问题</span>
            <Input
              value={question}
              onChange={event => setQuestion(event.target.value)}
              placeholder="例如：这份内容中段给出的结论是什么"
              disabled={pending}
              autoFocus
              ref={questionRef}
              aria-label="检索问题"
            />
          </label>

          <Button variant="primary" type="submit" isLoading={pending} disabled={!canSearch(contentId, question, pending)}>
            {pending ? '正在检索' : '开始检索'}
          </Button>
          <Button
            variant="secondary"
            type="button"
            icon={<MessageSquareText size={15} strokeWidth={1.8}/>}
            isLoading={answering}
            disabled={!answerable}
            onClick={() => void answerFromDocument()}
          >
            根据原文回答
          </Button>
        </div>

        <div className="retrieval-quick">
          <div className="retrieval-segmented" role="group" aria-label="检索方式">
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

          <div className="retrieval-presets" role="group" aria-label="上下文预算">
            <span className="retrieval-presets-label">上下文</span>
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
              <span className="retrieval-preset is-active is-custom">自定义 {options.maxChars.toLocaleString('en-US')}</span>
            )}
          </div>
        </div>
      </form>

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

      <section className={`retrieval-settings-panel${prefs.settingsOpen ? ' is-open' : ''}`} aria-label="检索设置">
        <button
          type="button"
          className="retrieval-settings-toggle"
          onClick={() => patchPrefs({ settingsOpen: !prefs.settingsOpen })}
          aria-expanded={prefs.settingsOpen}
          aria-controls="retrieval-settings-body"
        >
          <SlidersHorizontal size={15} strokeWidth={1.8} aria-hidden="true"/>
          <span className="retrieval-settings-title">检索设置</span>
          <span className="retrieval-settings-summary">嵌入服务、重排与权重——留在此页即可配置</span>
          <ChevronDown size={16} strokeWidth={2} className="retrieval-settings-chevron" aria-hidden="true"/>
        </button>
        {prefs.settingsOpen && (
          <div className="retrieval-settings-body" id="retrieval-settings-body">
            <RetrievalSettingsSection active={prefs.settingsOpen}/>
          </div>
        )}
      </section>

      {items.length === 0 && (
        <section className="empty-state">
          <h2>资料库还没有内容</h2>
          <p>检索只在你保存的内容里进行。可以先载入内置示例资料，或去「发现」保存一份。</p>
          {onOpenSamples && (
            <div className="retrieval-noresult-actions">
              <Button variant="primary" type="button" onClick={onOpenSamples}>载入示例资料</Button>
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
            <Button variant="secondary" type="button" disabled={pending} onClick={() => void run()}>重试</Button>
          )}
        </div>
      )}

      {pending && !result && (
        <div className="retrieval-skeleton" role="status" aria-live="polite" aria-label="正在检索">
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
        <RetrievalResultView
          result={result}
          selected={selected}
          onRead={onRead}
          question={asked}
          highlight={prefs.highlight}
          pageSize={prefs.pageSize}
          options={options}
          onNoResultAction={applyNoResultAction}
        />
      )}
    </section>
  )
}