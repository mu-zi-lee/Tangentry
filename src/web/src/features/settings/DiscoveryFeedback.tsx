import { Check, LoaderCircle, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { request } from '../../shared/api/client'
import { listOrEmpty } from '../../shared/api/list'
import type { DiscoveryFeedback } from '../../shared/api/types'
import { SettingsTask } from './ui/SettingsActionPage'
import { SettingsRow } from './ui/SettingsRow'
import { Dialog } from '../../components/ui/dialog/Dialog'

const labels: Record<string, string> = { more: '想多看看', less: '暂时少些（7 天）', hide: '不感兴趣', block_creator: '屏蔽此创作者' }
const targetLabels: Record<string, string> = { item: '这张卡片', source: '同来源', creator: '同创作者', topic: '同主题' }

export function DiscoveryFeedback({ active = true, embedded = false }: { active?: boolean; embedded?: boolean }) {
  const [values, setValues] = useState<DiscoveryFeedback[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const read = useRef<AbortController | null>(null)
  async function reload() {
    read.current?.abort()
    const controller = new AbortController()
    read.current = controller
    setLoading(true)
    setError('')
    try {
      const result = await request<{ feedback: DiscoveryFeedback[] }>('/discovery/feedback', { signal: controller.signal })
      if (!controller.signal.aborted) setValues(listOrEmpty(result.feedback))
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '反馈暂时无法读取，请重试。')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  useEffect(() => {
    if (active) void reload()
    return () => read.current?.abort()
  }, [active])
  async function remove(id: string) {
    setBusy(id)
    try { await request(`/discovery/feedback/${encodeURIComponent(id)}`, { method: 'DELETE' }); setValues(current => current.filter(value => value.id !== id)); setNotice('已撤销这条反馈。') } catch { setNotice('撤销失败，请重试。') } finally { setBusy('') }
  }
  async function clear() {
    setBusy('all')
    try { await request('/discovery/feedback', { method: 'DELETE' }); setValues([]); setNotice('已清除全部发现反馈。'); setConfirmClear(false) } catch { setNotice('清除失败，请重试。') } finally { setBusy('') }
  }
  const content = <>
    {notice && <p className="settings-feedback" role="status"><Check size={15} />{notice}</p>}
    {error && <p className="settings-feedback" role="alert">{error} <button type="button" className="text-button" disabled={loading} onClick={() => void reload()}>重新读取</button></p>}
    <div className="settings-list-card" data-setting="blocked-content">
      {loading ? <p className="settings-empty"><LoaderCircle size={15} className="spin" />正在读取反馈…</p> : !error && values.length === 0 ? <p className="settings-empty">还没有保存的发现反馈。</p> : !error && <div className="settings-token-list">{values.map(value => <span className="settings-token" key={value.id} title={`${labels[value.type] ?? value.type} · ${targetLabels[value.target] ?? value.target}${value.expiresAt ? ' · 7 天内有效' : ''}`}><em>{labels[value.type] ?? value.type}</em>{value.value}<button type="button" aria-label={`撤销${labels[value.type] ?? '反馈'}：${value.value}`} title="撤销反馈" disabled={Boolean(busy)} onClick={() => void remove(value.id)}>{busy === value.id ? <LoaderCircle size={14} className="spin" /> : <X size={14} />}</button></span>)}</div>}
      <SettingsRow title="重置推荐反馈" description="清除已保存的偏好与屏蔽记录，重新开始。"><button type="button" className="button button-secondary" disabled={!values.length || Boolean(busy)} onClick={() => setConfirmClear(true)}><Trash2 size={14}/>清除反馈</button></SettingsRow>
    </div>
    <Dialog open={confirmClear} title="清除全部推荐反馈？" onClose={() => { if (busy !== 'all') setConfirmClear(false) }}><p>已屏蔽的内容和创作者将重新参与推荐。</p><div className="settings-dialog-actions"><button type="button" className="button button-secondary" disabled={busy === 'all'} onClick={() => setConfirmClear(false)}>保留</button><button type="button" className="button button-primary" disabled={busy === 'all'} onClick={() => void clear()}>{busy === 'all' ? '正在清除…' : '确认清除'}</button></div></Dialog>
  </>
  return embedded ? content : <SettingsTask title="发现反馈" description="反馈只影响发现页的近期展示，不会根据观看记录建立长期兴趣画像。" actions={<span className="settings-inline-status">{values.length ? `${values.length} 条` : '暂无记录'}</span>}>{content}</SettingsTask>
}
