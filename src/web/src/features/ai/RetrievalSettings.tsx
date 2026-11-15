import { useEffect, useState } from 'react'
import { Button } from '../../components/ui'
import {
  defaultRetrievalSettings, validateRetrievalSettings, dimensionChoices,
  type RetrievalSettings as Settings, type ProviderKind,
} from './retrievalSettings'
import { loadRetrievalSettings, saveRetrievalSettings, settingsFromMasked } from './retrievalSettingsApi'

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
      setSaveError(cause instanceof Error ? cause.message : '检索设置未保存。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ai-retrieval-settings" aria-label="原文检索设置">
      <label>服务类型
        <select value={settings.providerKind} onChange={event => update('providerKind', event.target.value as ProviderKind)}>
          <option value="local">本地（推荐）</option>
          <option value="remote">自定义远程</option>
          <option value="bailian">阿里云百炼</option>
        </select>
      </label>
      <label>接口地址
        <input type="text" value={settings.baseUrl} onChange={event => update('baseUrl', event.target.value)} placeholder="http://127.0.0.1:11434/v1"/>
      </label>
      <label>API 密钥{settings.apiKey || hasKey ? '（已配置）' : '（可选）'}
        <input type="password" value={settings.apiKey} onChange={event => update('apiKey', event.target.value)} autoComplete="off" placeholder={hasKey ? '已保存；留空保留' : '本机服务可留空'}/>
      </label>
      <label>模型
        <input type="text" value={settings.model} onChange={event => update('model', event.target.value)}/>
      </label>
      <label>向量维度
        {choices ? (
          <select value={settings.dimensions} onChange={event => update('dimensions', Number(event.target.value))}>
            {choices.map(dim => <option key={dim} value={dim}>{dim}</option>)}
          </select>
        ) : (
          <input type="number" min={1} value={settings.dimensions} onChange={event => update('dimensions', Number(event.target.value))}/>
        )}
      </label>
      <label>批大小
        <input type="number" min={1} value={settings.batchSize} onChange={event => update('batchSize', Number(event.target.value))}/>
      </label>
      <label>topK（20–1000）
        <input type="number" min={20} max={1000} value={settings.topK} onChange={event => update('topK', Number(event.target.value))}/>
      </label>
      <fieldset>
        <legend>混合权重（0–1，自动归一化）</legend>
        <label>词汇<input type="number" step="0.05" min={0} max={1} value={settings.lexicalWeight} onChange={event => update('lexicalWeight', Number(event.target.value))}/></label>
        <label>嵌入<input type="number" step="0.05" min={0} max={1} value={settings.embeddingWeight} onChange={event => update('embeddingWeight', Number(event.target.value))}/></label>
        <label>重排<input type="number" step="0.05" min={0} max={1} value={settings.rerankWeight} onChange={event => update('rerankWeight', Number(event.target.value))}/></label>
      </fieldset>
      <fieldset>
        <legend>检索预算（B 独立预算）</legend>
        <label>嵌入请求上限<input type="number" min={0} value={settings.maxEmbeddingRequests} onChange={event => update('maxEmbeddingRequests', Number(event.target.value))}/></label>
        <label>嵌入字符上限<input type="number" min={1} value={settings.maxEmbeddingChars} onChange={event => update('maxEmbeddingChars', Number(event.target.value))}/></label>
        <label>重排请求上限<input type="number" min={0} value={settings.maxRerankRequests} onChange={event => update('maxRerankRequests', Number(event.target.value))}/></label>
      </fieldset>
      <label>重排服务
        <select value={settings.rerankProvider} onChange={event => update('rerankProvider', event.target.value as Settings['rerankProvider'])}>
          <option value="off">关闭</option>
          <option value="bailian">百炼</option>
          <option value="custom">自定义</option>
        </select>
      </label>
      {error && <p className="ai-retrieval-settings-error" role="alert">{error}</p>}
      {saveError && <p className="ai-retrieval-settings-error" role="alert">{saveError}</p>}
      <Button type="button" disabled={!validation.ok || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存检索设置'}</Button>
      {saved && !saving && <span role="status">已保存</span>}
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
        if (!cancelled) setError(cause instanceof Error ? cause.message : '检索设置暂不可用。')
      })
    return () => { cancelled = true }
  }, [active])

  if (error && !initial) return <p className="ai-retrieval-settings-error" role="alert">{error}</p>
  if (!initial) return <p className="field-hint" role="status">正在读取检索设置…</p>
  return <RetrievalSettingsPanel
    initial={initial}
    hasKey={hasKey}
    onSave={async settings => {
      const masked = await saveRetrievalSettings(settings)
      setHasKey(masked.hasKey)
    }}
  />
}
