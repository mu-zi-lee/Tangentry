import { Button, Dialog, Input } from '../../components/ui'
import { AlertCircle, BookOpenText, Check, ExternalLink, KeyRound, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SubscriptionSource } from '../../shared/api/types'
import type { useSubscriptions } from './useSubscriptions'
import type { useSubscriptionGroups } from './useSubscriptionGroups'
import { SubscriptionSourceIcon } from './SubscriptionSourceIcon'
import { SubscriptionGroupAssignment } from './SubscriptionGroupAssignment'
import { SubscriptionRefreshSettings } from './SubscriptionRefreshSettings'
import { SubscriptionAddressSettings } from './SubscriptionAddressSettings'
import { sourceLinkLabel, supportsRefresh } from './sourcePresentation'
import { formatTime, healthLabels, healthTone, shortTime } from './sourceHealth'

/**
 * Everything about one source in one place: its sync health, name, group,
 * refresh policy, feed address and removal. Opened from the reading stream
 * and from the manager, so both lead to the same controls.
 */
export function SubscriptionSourceSheet({ source, onClose, state, groups, busy, context, onOpenInReader }: {
  source: SubscriptionSource | null
  onClose: () => void
  state: ReturnType<typeof useSubscriptions>
  groups: ReturnType<typeof useSubscriptionGroups>
  busy: boolean
  context: 'reading' | 'manage'
  onOpenInReader: (id: string) => void
}) {
  const [draftName, setDraftName] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const removeTrigger = useRef<HTMLButtonElement>(null)
  const keepButton = useRef<HTMLButtonElement>(null)
  const id = source?.id ?? ''
  useEffect(() => { setDraftName(source?.name ?? ''); setConfirmRemove(false) }, [id])
  useEffect(() => { if (confirmRemove) keepButton.current?.focus() }, [confirmRemove])
  const open = Boolean(source)
  const refresh = source?.refresh
  const tone = refresh ? healthTone(refresh.status) : 'neutral'
  const updating = Boolean(source && (state.pending?.kind === 'update' && state.pending.id === source.id || source.active))
  const updateError = source ? state.updateErrors[source.id] ?? '' : ''
  const renaming = state.pending?.kind === 'rename' && state.pending.id === id
  const nameChanged = Boolean(source && draftName.trim() && draftName.trim() !== source.name)

  return <Dialog open={open} onClose={onClose} id="subscription-source-sheet" className="subscription-sheet" aria-labelledby="subscription-sheet-title">
    {source && refresh && <div className="subscription-sheet-body">
      <header className="subscription-sheet-header">
        <SubscriptionSourceIcon source={source} size={20}/>
        <div className="subscription-sheet-title">
          <h2 id="subscription-sheet-title">{source.name}</h2>
          <p><a href={source.url} target="_blank" rel="noreferrer">{sourceLinkLabel(source)}<ExternalLink size={11} aria-hidden="true"/></a></p>
        </div>
        <Button variant="quiet" iconOnly className="icon-button" aria-label="关闭来源设置" title="关闭（Esc）" onClick={onClose}><X size={17} aria-hidden="true"/></Button>
      </header>

      {state.actionError && <div className="error-panel" role="alert"><AlertCircle size={17} aria-hidden="true"/><p>{state.actionError}</p></div>}
      {(state.notice || groups.notice) && <p className="inline-feedback" role="status"><Check size={16} aria-hidden="true"/>{state.notice || groups.notice}</p>}

      <section className="subscription-sheet-section" aria-labelledby="subscription-sheet-health">
        <div className="subscription-sheet-section-heading">
          <h3 id="subscription-sheet-health">同步状态</h3>
          <span className="subscription-health-badge" data-tone={tone}>{healthLabels[refresh.status]}</span>
        </div>
        {updateError && <p className="subscription-sheet-alert" role="alert"><AlertCircle size={14} aria-hidden="true"/>{updateError}</p>}
        {refresh.message && <p className="subscription-sheet-message">{refresh.message}</p>}
        {tone !== 'healthy' && refresh.suggestedAction && <p className="subscription-sheet-suggestion">建议：{refresh.suggestedAction}</p>}
        <dl className="subscription-health-metrics">
          <div><dt>最近成功</dt><dd title={formatTime(refresh.lastCheckedAt, '尚未成功')}>{shortTime(refresh.lastCheckedAt, '尚未成功')}</dd></div>
          <div><dt>最近失败</dt><dd title={refresh.lastFailureAt ? formatTime(refresh.lastFailureAt) : undefined}>{refresh.lastFailureAt ? shortTime(refresh.lastFailureAt) : '无'}</dd></div>
          <div><dt>连续失败</dt><dd>{refresh.failures}</dd></div>
          <div><dt>下次检查</dt><dd title={refresh.nextCheckAt ? formatTime(refresh.nextCheckAt) : undefined}>{refresh.nextCheckAt ? shortTime(refresh.nextCheckAt) : refresh.enabled ? '等待安排' : '手动更新'}</dd></div>
          <div><dt>已获取</dt><dd>{source.lastUpdatedAt ? `${source.itemCount} 条` : '尚未获取'}</dd></div>
          <div><dt>内容版本</dt><dd>revision {refresh.contentRevision}</dd></div>
        </dl>
        <div className="subscription-sheet-actions">
          <Button className="button button-secondary" variant="secondary" disabled={busy || source.active} onClick={() => void state.update(source.id)}>{updating ? <LoaderCircle size={14} className="spin" aria-hidden="true"/> : <RefreshCw size={14} aria-hidden="true"/>}{updating ? '正在检查' : '立即检查'}</Button>
          {(refresh.status === 'auth_required' || refresh.status === 'rate_limited') && <a className="text-button" href="/tools#accounts"><KeyRound size={14} aria-hidden="true"/>检查平台登录</a>}
          {context === 'manage' && <Button variant="quiet" className="text-button" onClick={() => onOpenInReader(source.id)}><BookOpenText size={14} aria-hidden="true"/>阅读这个来源</Button>}
        </div>
      </section>

      <section className="subscription-sheet-section" aria-labelledby="subscription-sheet-settings">
        <h3 id="subscription-sheet-settings">来源设置</h3>
        <form className="subscription-setting-row" onSubmit={event => { event.preventDefault(); if (nameChanged) void state.rename(source.id, draftName) }}>
          <label className="subscription-field"><span>名称</span><Input aria-label="来源新名称" value={draftName} maxLength={100} required disabled={busy} onChange={event => setDraftName(event.target.value)}/></label>
          <Button className="button button-secondary" variant="secondary" disabled={busy || !nameChanged}>{renaming ? <LoaderCircle size={14} className="spin" aria-hidden="true"/> : null}保存名称</Button>
        </form>
        <SubscriptionGroupAssignment key={`group:${source.id}`} source={source} groups={groups} busy={busy || state.reading}/>
        {supportsRefresh(source) && <SubscriptionRefreshSettings key={`refresh:${source.id}`} source={source} busy={busy || source.active} onSave={(enabled, interval) => state.configureRefresh(source.id, enabled, interval)}/>}
        {source.id.startsWith('rss:feed:') && <SubscriptionAddressSettings key={`address:${source.id}`} source={source} busy={busy || state.reading || source.active} onSave={(url, expected) => state.editAddress(source.id, url, expected)}/>}
      </section>

      <section className="subscription-sheet-section subscription-sheet-danger" aria-labelledby="subscription-sheet-remove">
        <h3 id="subscription-sheet-remove">移除来源</h3>
        {!confirmRemove ? <div className="subscription-setting-row">
          <p>停止跟踪这个来源并清除它的最新内容缓存。历史收件箱、收藏、下载和笔记都会保留。</p>
          <Button ref={removeTrigger} variant="secondary" className="button button-secondary subscription-danger-button" disabled={busy} onClick={() => setConfirmRemove(true)}><Trash2 size={14} aria-hidden="true"/>移除来源</Button>
        </div> : <div className="subscription-remove" role="group" aria-label="确认移除来源">
          <p>确定移除「{source.name}」？此操作不会删除历史、收藏、下载或笔记。</p>
          <div className="subscription-remove-actions">
            <Button className="button button-secondary" ref={keepButton} variant="secondary" disabled={busy} onClick={() => { setConfirmRemove(false); requestAnimationFrame(() => removeTrigger.current?.focus()) }}>保留来源</Button>
            <Button className="button button-danger" variant="danger" disabled={busy} onClick={() => void state.remove(source.id).then(ok => { if (ok) onClose() })}>{state.pending?.kind === 'delete' ? <LoaderCircle size={14} className="spin" aria-hidden="true"/> : <Trash2 size={14} aria-hidden="true"/>}确认移除</Button>
          </div>
        </div>}
      </section>
    </div>}
  </Dialog>
}
