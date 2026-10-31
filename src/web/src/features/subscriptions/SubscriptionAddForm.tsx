import { Button, Input } from '../../components/ui'
import { AlertCircle, Check, GraduationCap, Link2, LoaderCircle, Plus, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { request } from '../../shared/api/client'

type ResolvedSource = { type: string; query: string; title: string; url: string }
type Kind = 'default' | 'arxiv' | 'huggingface'
const sourceLabels: Record<string, string> = { bilibili: 'B站 UP 主', youtube: 'YouTube 频道', rss: 'RSS / 播客', arxiv: 'arXiv 分类', huggingface: 'HF 每日论文' }
const commonArxivCategories = ['cs.AI', 'cs.CL', 'cs.LG', 'cs.CV']
const kinds: { id: Kind; label: string; hint: string; Icon: typeof Link2 }[] = [
  { id: 'default', label: '链接或 UID', hint: 'B站 · YouTube · RSS / 播客', Icon: Link2 },
  { id: 'arxiv', label: 'arXiv 分类', hint: '按学科分类追踪新论文', Icon: GraduationCap },
  { id: 'huggingface', label: 'HF 每日论文', hint: 'Hugging Face 每日精选', Icon: Sparkles },
]

export function SubscriptionAddForm({ busy, creating, inputRef, onCreate, onCancel, error: actionError = '', layout = 'dialog' }: { busy: boolean; creating: boolean; inputRef: RefObject<HTMLInputElement | null>; onCreate: (query: string, name: string, type: string) => Promise<boolean>; onCancel?: () => void; error?: string; layout?: 'dialog' | 'inline' }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<Kind>('default')
  const [name, setName] = useState('')
  const [resolved, setResolved] = useState<ResolvedSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const editedName = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const generation = useRef(0)
  const submitting = useRef(false)
  function cancel() { window.clearTimeout(timer.current); controller.current?.abort(); controller.current = null; generation.current++; setLoading(false) }
  useEffect(() => () => { window.clearTimeout(timer.current); controller.current?.abort() }, [])
  async function resolve(value: string) {
    const typedValue = kind === 'arxiv' ? `arxiv:${value.trim()}` : kind === 'huggingface' ? `huggingface:${value.trim() || 'today'}` : value.trim()
    cancel(); const token = generation.current; const active = new AbortController(); controller.current = active; setLoading(true); setError('')
    try { const result = await request<ResolvedSource>('/subscriptions/resolve', { method: 'POST', body: JSON.stringify({ query: typedValue }), signal: active.signal }); if (!active.signal.aborted && token === generation.current) { setResolved(result); if (!editedName.current) setName(result.title) }; return result }
    catch (cause) { if (!active.signal.aborted && token === generation.current) setError(cause instanceof Error ? cause.message : '暂时无法识别这个订阅地址。'); return null }
    finally { if (!active.signal.aborted && token === generation.current) { setLoading(false); controller.current = null } }
  }
  function changeQuery(value: string) { cancel(); setQuery(value); setResolved(null); setError(''); if (!editedName.current) setName(''); if (value.trim()) timer.current = window.setTimeout(() => { void resolve(value) }, 650) }
  function changeKind(next: Kind) { if (next === kind) return; cancel(); setKind(next); setQuery(''); setResolved(null); setError(''); if (!editedName.current) setName('') }
  async function submit() { if (busy || loading || submitting.current || kind !== 'huggingface' && !query.trim()) return; submitting.current = true; try { const source = resolved ?? await resolve(query); if (!source) return; if (await onCreate(source.query, editedName.current ? name.trim() || source.title : source.title, source.type)) { cancel(); setQuery(''); setName(''); setResolved(null); setError(''); editedName.current = false; setKind('default') } } finally { submitting.current = false } }
  const placeholder = kind === 'arxiv' ? '例如 cs.AI 或 cs.AI+cs.CL' : kind === 'huggingface' ? '日期 YYYY-MM-DD，留空为今天' : '粘贴订阅链接、频道地址或 UP 主 UID'
  const hint = kind === 'arxiv' ? '多个分类用 + 连接。' : kind === 'huggingface' ? '会按日期获取当天的精选论文。' : '支持 B站 UP 主主页或 UID、YouTube 频道地址、RSS / Atom / 播客订阅地址。'
  const shownError = error || actionError

  return <section className="subscription-add-form" data-layout={layout} aria-label="添加订阅来源">
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <div className="subscription-add-types" role="radiogroup" aria-label="订阅来源类型">
        {kinds.map(({ id, label, hint, Icon }) => <label key={id} data-checked={kind === id}>
          <input type="radio" name={`subscription-kind-${layout}`} value={id} checked={kind === id} disabled={creating} onChange={() => changeKind(id)}/>
          <Icon size={16} aria-hidden="true"/><span><strong>{label}</strong><small>{hint}</small></span>
        </label>)}
      </div>
      {kind === 'arxiv' && <div className="subscription-add-quick" role="group" aria-label="常用 arXiv 分类">{commonArxivCategories.map(value => <Button key={value} variant="quiet" type="button" aria-pressed={query === value} disabled={creating} onClick={() => changeQuery(value)}>{value}</Button>)}</div>}
      <div className="add-input-wrapper"><Link2 size={16} aria-hidden="true"/><Input id="subscription-query" ref={inputRef} aria-label="订阅地址" aria-describedby={`subscription-add-hint-${layout}`} placeholder={placeholder} value={query} maxLength={2048} required={kind !== 'huggingface'} disabled={creating} autoComplete="off" spellCheck={false} onChange={event => changeQuery(event.target.value)}/>{loading && <Button variant="quiet" iconOnly type="button" className="icon-button" aria-label="取消识别订阅" title="取消识别" onClick={cancel}><X size={16} aria-hidden="true"/></Button>}</div>
      <p className="add-hint" id={`subscription-add-hint-${layout}`}>{hint}</p>
      <div className="add-resolution" aria-live="polite">
        {loading && <p className="add-resolving"><LoaderCircle size={14} className="spin" aria-hidden="true"/>正在识别来源…</p>}
        {resolved && !loading && <div className="add-source-confirm" role="status"><Check size={14} aria-hidden="true"/><span>{sourceLabels[resolved.type] ?? resolved.type}</span><strong>{resolved.title}</strong></div>}
      </div>
      {shownError && <p className="add-error" role="alert"><AlertCircle size={14} aria-hidden="true"/>{shownError}</p>}
      {query.trim() && <label className="subscription-field add-name-field"><span>显示名称</span><Input aria-label="订阅来源名称" placeholder="自动读取名称" value={name} maxLength={100} disabled={creating} onChange={event => { editedName.current = true; setName(event.target.value) }}/></label>}
      <div className="subscription-add-actions">
        {onCancel && <Button className="button button-secondary" variant="secondary" type="button" onClick={onCancel}>{query.trim() ? '稍后再说' : '取消'}</Button>}
        <Button className="button button-primary" variant="primary" type="submit" aria-label={loading ? '正在识别订阅' : '保存来源'} disabled={busy || loading || kind !== 'huggingface' && !query.trim()}>{creating || loading ? <LoaderCircle className="spin" size={16} aria-hidden="true"/> : <Plus size={16} aria-hidden="true"/>}<span>{creating ? '添加中' : loading ? '识别中' : '保存来源'}</span></Button>
      </div>
    </form>
  </section>
}
