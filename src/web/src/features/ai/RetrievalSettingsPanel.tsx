import { useEffect, useState } from 'react'
import { Button } from '../../components/ui'
import {
  defaultRetrievalSettings, validateRetrievalSettings, dimensionChoices,
  type RetrievalSettings as Settings, type ProviderKind,
} from './retrievalSettings'
import { loadRetrievalSettings, saveRetrievalSettings, settingsFromMasked } from './retrievalSettingsApi'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { NumberStepper, stepChoice } from '../retrieval/NumberStepper'

// RetrievalSettingsPanel is the embedding/rerank settings form. It is local-first
// by default, treats dimensions as a per-model choice, masks the API key
// (hasKey only), and guards rerank-with-zero-budget. Keys are write-only: an
// empty key field keeps the stored one, and the server masks every response.
export function RetrievalSettingsPanel({ initial, hasKey = false, onSave }: { initial?: Settings; hasKey?: boolean; onSave?: (settings: Settings) => void | Promise<void> }) {
  const [settings, setSettings] = useState<Settings>(initial ?? defaultRetrievalSettings())
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const validation = validateRetrievalSettings(settings)
  const error = validation.ok ? '' : validation.message
  const choices = dimensionChoices(settings.model)

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(current => ({ ...current, [key]: value }))
    setSaved(false)
    setSaveError('')
  }

  const save = async () => {
    if (!validation.ok || saving) return
    setSaving(true)
    setSaveError('')
    try {
      await onSave?.(settings)
      setSaved(true)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Retrieval settings were not saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ai-retrieval-settings" aria-label="Retrieval service settings">
      <label>Service type
        <select value={settings.providerKind} onChange={event => update('providerKind', event.target.value as ProviderKind)}>
          <option value="local">Local (recommended)</option>
          <option value="remote">Custom remote</option>
          <option value="bailian">Alibaba Cloud Bailian</option>
        </select>
      </label>
      <label>Endpoint
        <input type="text" value={settings.baseUrl} onChange={event => update('baseUrl', event.target.value)} placeholder="http://127.0.0.1:11434/v1"/>
      </label>
      <label>API key{settings.apiKey || hasKey ? ' (configured)' : ' (optional)'}
        <input type="password" value={settings.apiKey} onChange={event => update('apiKey', event.target.value)} autoComplete="off" placeholder={hasKey ? 'Saved; leave blank to keep' : 'Optional for a local service'}/>
      </label>
      <label>Model
        <input type="text" value={settings.model} onChange={event => update('model', event.target.value)}/>
      </label>
      <label>Dimensions
        {choices ? (
          <span className="number-stepper number-stepper-select">
            <span className="number-stepper-box">
              <select value={settings.dimensions} onChange={event => update('dimensions', Number(event.target.value))} aria-label="Dimensions">
                {choices.map(dim => <option key={dim} value={dim}>{dim}</option>)}
              </select>
              <span className="number-stepper-buttons">
                <button type="button" className="number-stepper-button" tabIndex={-1}
                  aria-label="Increase dimensions" title="Increase dimensions"
                  disabled={settings.dimensions >= Math.max(...choices)}
                  onClick={() => update('dimensions', stepChoice(choices, settings.dimensions, 1))}>
                  <ChevronUp size={12} strokeWidth={2.4} aria-hidden="true"/>
                </button>
                <button type="button" className="number-stepper-button" tabIndex={-1}
                  aria-label="Decrease dimensions" title="Decrease dimensions"
                  disabled={settings.dimensions <= Math.min(...choices)}
                  onClick={() => update('dimensions', stepChoice(choices, settings.dimensions, -1))}>
                  <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true"/>
                </button>
              </span>
            </span>
          </span>
        ) : (
          <NumberStepper min={1} max={8192} value={settings.dimensions} label="Dimensions" onChange={value => update('dimensions', value)}/>
        )}
      </label>
      <label>Batch size
        <NumberStepper min={1} max={256} value={settings.batchSize} label="Batch size" onChange={value => update('batchSize', value)}/>
      </label>
      <label>topK（20–1000）
        <NumberStepper min={20} max={1000} value={settings.topK} label="topK" onChange={value => update('topK', value)}/>
      </label>
      <fieldset>
        <legend>Hybrid weights (0–1, normalised automatically)</legend>
        <label>Lexical<NumberStepper min={0} max={1} step={0.05} value={settings.lexicalWeight} label="Lexical weight" onChange={value => update('lexicalWeight', value)}/></label>
        <label>Embedding<NumberStepper min={0} max={1} step={0.05} value={settings.embeddingWeight} label="Embedding weight" onChange={value => update('embeddingWeight', value)}/></label>
        <label>Rerank<NumberStepper min={0} max={1} step={0.05} value={settings.rerankWeight} label="Rerank weight" onChange={value => update('rerankWeight', value)}/></label>
      </fieldset>
      <fieldset>
        <legend>Retrieval budget (independent of the chat budget)</legend>
        <label>Embedding request limit<NumberStepper min={0} max={100000} value={settings.maxEmbeddingRequests} label="Embedding request limit" onChange={value => update('maxEmbeddingRequests', value)}/></label>
        <label>Embedding character limit<NumberStepper min={1} max={100000000} value={settings.maxEmbeddingChars} label="Embedding character limit" onChange={value => update('maxEmbeddingChars', value)}/></label>
        <label>Rerank request limit<NumberStepper min={0} max={100000} value={settings.maxRerankRequests} label="Rerank request limit" onChange={value => update('maxRerankRequests', value)}/></label>
      </fieldset>
      <label>Rerank service
        <select value={settings.rerankProvider} onChange={event => update('rerankProvider', event.target.value as Settings['rerankProvider'])}>
          <option value="off">Off</option>
          <option value="bailian">Bailian</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {error && <p className="ai-retrieval-settings-error" role="alert">{error}</p>}
      {saveError && <p className="ai-retrieval-settings-error" role="alert">{saveError}</p>}
      <Button type="button" disabled={!validation.ok || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save retrieval settings'}</Button>
      {saved && !saving && <span role="status">Saved</span>}
    </div>
  )
}

// RetrievalSettingsSection loads the persisted settings, renders the panel,
// and saves through the API. The server response is masked; a successful
// save refreshes the stored-key indicator without ever echoing the key.
export function RetrievalSettingsSection({ active = true }: { active?: boolean }) {
  const [initial, setInitial] = useState<Settings | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!active) return
    let cancelled = false
    loadRetrievalSettings()
      .then(masked => {
        if (cancelled) return
        setInitial(settingsFromMasked(masked))
        setHasKey(masked.hasKey)
        setError('')
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Retrieval settings are unavailable.')
      })
    return () => { cancelled = true }
  }, [active])

  if (error && !initial) return <p className="ai-retrieval-settings-error" role="alert">{error}</p>
  if (!initial) return <p className="field-hint" role="status">Loading retrieval settings…</p>
  return <RetrievalSettingsPanel
    initial={initial}
    hasKey={hasKey}
    onSave={async settings => {
      const masked = await saveRetrievalSettings(settings)
      setHasKey(masked.hasKey)
    }}
  />
}
