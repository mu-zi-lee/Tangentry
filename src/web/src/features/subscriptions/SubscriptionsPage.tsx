import { Button, Dialog } from '../../components/ui'
import { AlertCircle, BookOpen, Check, LoaderCircle, Plus, RefreshCw, Settings2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContentItem, SavedView, SubscriptionSource } from '../../shared/api/types'
import type { useReadState } from '../readstate/useReadState'
import './subscriptions.css'
import { SubscriptionAddForm } from './SubscriptionAddForm'
import { SubscriptionNavigator } from './SubscriptionNavigator'
import { SubscriptionStream, type ReadFilter } from './SubscriptionStream'
import { SubscriptionInbox } from './SubscriptionInbox'
import { SubscriptionManager } from './SubscriptionManager'
import { SubscriptionSourceSheet } from './SubscriptionSourceSheet'
import { useSubscriptionGroups } from './useSubscriptionGroups'
import { emptyFilters, type InboxFilters, type useSubscriptionInbox } from './useSubscriptionInbox'
import type { useSubscriptions } from './useSubscriptions'
import { needsAttention } from './sourceHealth'

export type SubscriptionMode = 'latest' | 'history' | 'manage'
type Subscriptions = ReturnType<typeof useSubscriptions>

/**
 * Subscriptions are two places: reading (a navigator of everything you can
 * read, beside the selected stream) and managing (every source as a list you
 * can group, schedule, repair and remove in bulk). One sheet holds a single
 * source's settings and health, and is reachable from both.
 */
export function SubscriptionsPage({ subscriptions: state, savedIDs, savingUnavailable, savingIDs, onSave, onRead, filter, onFilter, kind, onKind, saveNotice, saveError, readStates, readFilter, onReadFilter, inbox, mode, healthFocus, onMode, views, selectedViewID, onSelectView, onApplyFilters, onSaveView, onUpdateView, onDeleteView }: {
  inbox: ReturnType<typeof useSubscriptionInbox>; mode: SubscriptionMode; healthFocus: boolean; onMode: (mode: SubscriptionMode | 'health') => void
  readStates: ReturnType<typeof useReadState>; readFilter: ReadFilter; onReadFilter: (value: ReadFilter) => void
  subscriptions: Subscriptions; savedIDs: Set<string>; savingUnavailable: boolean; savingIDs: Set<string>
  onSave: (item: ContentItem) => void; onRead: (item: ContentItem) => void
  filter: string; onFilter: (value: string) => void; kind: string; onKind: (value: string) => void
  saveNotice: string; saveError: boolean
  views: SavedView[]; selectedViewID: string; onSelectView: (id: string) => void; onApplyFilters: (filters: InboxFilters) => void; onSaveView: (name: string, filters: InboxFilters) => Promise<void>; onUpdateView: (id: string, edit: Partial<Pick<SavedView, 'name' | 'definition' | 'icon' | 'color' | 'default'>>) => void; onDeleteView: (id: string) => void
}) {
  const groups = useSubscriptionGroups(state.setMembership, state.dissolveGroup)
  const addRequested = new URLSearchParams(location.search).get('add') === 'rss'
  const [addOpen, setAddOpen] = useState(addRequested)
  const [sheetID, setSheetID] = useState('')
  const sourceInput = useRef<HTMLInputElement>(null)
  const busy = Boolean(state.pending) || state.loading || Boolean(state.listError) || Boolean(groups.pending)
  const attention = state.sources.filter(needsAttention).length
  const automatic = state.sources.filter(source => source.refresh.enabled).length
  const sheetSource = state.sources.find(source => source.id === sheetID) ?? null
  // With no sources, the reading stream itself becomes the add form.
  const inlineAdd = mode === 'latest' && !state.loading && !state.listError && state.sources.length === 0
  const overlay = Boolean(sheetSource) || addOpen && !inlineAdd
  useEffect(() => { if (addRequested) setAddOpen(true) }, [addRequested])
  useEffect(() => { if (addRequested && inlineAdd) requestAnimationFrame(() => sourceInput.current?.focus()) }, [addRequested, inlineAdd])
  useEffect(() => { if (sheetID && !state.loading && !sheetSource) setSheetID('') }, [sheetID, sheetSource, state.loading])

  const openAdd = () => {
    if (inlineAdd) { requestAnimationFrame(() => sourceInput.current?.focus()); return }
    setAddOpen(true)
    requestAnimationFrame(() => sourceInput.current?.focus())
  }
  const create = async (query: string, name: string, type: string) => {
    const ok = await state.create(query, name, type)
    if (ok) {
      setAddOpen(false)
      if (mode === 'history') onMode('latest')
    }
    return ok
  }
  const selectSource = (id: string) => { state.select(id); if (mode !== 'latest') onMode('latest') }
  const openSheet = (source: SubscriptionSource) => setSheetID(source.id)
  // The page's controls live in the app top bar beside the 订阅管理 title, so
  // the content starts right under it instead of under a second header.
  const [topbar, setTopbar] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { setTopbar(document.getElementById('subscription-topbar')) }, [])
  const summary = state.loading && !state.sources.length ? '正在读取来源…' : state.sources.length ? `${state.sources.length} 个来源${groups.groups.length ? ` · ${groups.groups.length} 个分组` : ''} · ${automatic} 个自动更新${attention ? ` · ${attention} 个需处理` : ''}` : '尚未添加来源'
  const batch = state.batch

  return <>
    {topbar && createPortal(<div className="subscription-page-header" aria-busy={state.loading} title={typeof summary === 'string' ? summary : undefined}>
      <span className="visually-hidden">{summary}</span>
      <nav className="subscription-spaces" aria-label="订阅空间">
        <Button variant="quiet" aria-current={mode !== 'manage' ? 'page' : undefined} onClick={() => { if (mode === 'manage') onMode('latest') }}><BookOpen size={15} aria-hidden="true"/>阅读</Button>
        <Button variant="quiet" aria-current={mode === 'manage' ? 'page' : undefined} onClick={() => onMode('manage')} title={attention ? `${attention} 个来源需处理` : undefined}><Settings2 size={15} aria-hidden="true"/>管理来源{attention > 0 && <span className="subscription-attention-count"><span className="visually-hidden">，</span>{attention}<span className="visually-hidden"> 个需处理</span></span>}</Button>
      </nav>
      {mode !== 'history' && state.sources.length > 0 && <Button variant="quiet" iconOnly className="icon-button subscription-update-all" aria-label={batch?.running && batch.kind === 'update' ? `更新中 ${batch.completed}/${batch.total}` : '全部更新'} title="更新全部来源" disabled={busy || Boolean(batch?.running)} onClick={() => void state.batchUpdate(state.sources.map(item => item.id))}>{batch?.running && batch.kind === 'update' ? <LoaderCircle className="spin" size={16} aria-hidden="true"/> : <RefreshCw size={16} aria-hidden="true"/>}</Button>}
      <Button variant="quiet" id="subscription-add-toggle" className="experience-add subscription-add-toggle" aria-label="添加订阅" aria-haspopup="dialog" aria-expanded={addOpen && !inlineAdd} aria-controls="subscription-add-dialog" onClick={openAdd}><Plus size={17} aria-hidden="true"/><span>添加订阅</span></Button>
    </div>, topbar)}

    {batch && batch.kind === 'update' && <div className={`subscription-batch-progress ${batch.running ? 'running' : 'complete'}`} role="status">
      <div className="subscription-batch-progress-copy"><strong>{batch.running ? `正在更新来源 ${batch.completed}/${batch.total}` : `已完成 ${batch.total - batch.failed}/${batch.total} 个来源`}</strong>{batch.failed > 0 && <span>{batch.failed} 个来源失败，已保留旧内容。</span>}</div>
      <div className="subscription-batch-progress-track" aria-hidden="true"><span style={{ width: `${batch.total ? Math.round(batch.completed / batch.total * 100) : 0}%` }}/></div>
      {!batch.running && batch.failed > 0 && <Button className="button button-secondary" variant="secondary" onClick={() => void state.retryBatchFailed()}><RefreshCw size={14} aria-hidden="true"/>重试失败项</Button>}
    </div>}

    {!overlay && state.actionError && !inlineAdd && <div className="error-panel" role="alert"><AlertCircle size={18} aria-hidden="true"/><p>{state.actionError}</p></div>}
    {!overlay && (state.notice || groups.notice) && <p className="inline-feedback" role="status"><Check size={17} aria-hidden="true"/>{state.notice || groups.notice}</p>}
    {state.listError && <div className="error-panel" role="alert"><AlertCircle size={18} aria-hidden="true"/><p>{state.listError} 已显示的来源可能不是最新记录。</p><Button className="button button-secondary" variant="secondary" disabled={state.loading} onClick={() => void state.reload()}>重新加载来源</Button></div>}

    {mode === 'manage' ? <SubscriptionManager state={state} groups={groups} focusAttention={healthFocus} onOpenSource={openSheet} onReadSource={selectSource} onAdd={openAdd}/>
      : <div className="subscriptions-workspace">
        <SubscriptionNavigator state={state} groups={groups} place={{ mode, viewID: selectedViewID }} views={views}
          onSelectSource={selectSource} onHistory={() => onMode('history')} onSelectView={onSelectView} onManage={() => onMode('manage')}
          onReload={() => { void state.reload(); void groups.reload() }}/>
        {mode === 'history'
          ? <SubscriptionInbox inbox={inbox} sources={state.sources} groups={groups.groups} readStates={readStates} savedIDs={savedIDs} savingIDs={savingIDs} savingUnavailable={savingUnavailable} onRead={onRead} onSave={onSave} saveNotice={saveNotice} saveError={saveError} views={views} selectedViewID={selectedViewID} onApplyFilters={onApplyFilters} onSaveView={onSaveView} onUpdateView={onUpdateView} onDeleteView={onDeleteView}/>
          : inlineAdd ? <section id="subscription-stream" tabIndex={-1} className="subscription-results subscription-onboarding" aria-label="全部订阅">
            <header className="subscription-stream-header"><div className="subscription-stream-title"><h2>全部订阅</h2><p className="subscription-stream-meta"><span>还没有来源</span></p></div></header>
            <div className="subscription-onboarding-card">
              <h3>先保存一个想持续关注的来源</h3>
              <p>粘贴创作者主页、频道或 RSS 地址，Tangentry 会识别来源并在这里汇总它们的最新内容。也可以在“管理来源”中导入 OPML。</p>
              <SubscriptionAddForm layout="inline" busy={busy} creating={state.pending?.kind === 'create'} inputRef={sourceInput} error={state.actionError} onCreate={create}/>
            </div>
          </section>
          : <SubscriptionStream state={state} readStates={readStates} savedIDs={savedIDs} savingIDs={savingIDs} savingUnavailable={savingUnavailable} onSave={onSave} onRead={onRead}
            filter={filter} onFilter={onFilter} readFilter={readFilter} onReadFilter={onReadFilter} kind={kind} onKind={onKind} saveNotice={saveNotice} saveError={saveError} busy={busy}
            onOpenSettings={openSheet} settingsOpen={Boolean(sheetSource)} onAdd={openAdd}
            onSourceHistory={id => id ? onApplyFilters({ ...emptyFilters, sourceId: id }) : onMode('history')}/>}
      </div>}

    {!inlineAdd && <Dialog open={addOpen} onClose={() => setAddOpen(false)} id="subscription-add-dialog" title="添加订阅" className="subscription-add-dialog">
      <SubscriptionAddForm busy={busy} creating={state.pending?.kind === 'create'} inputRef={sourceInput} error={addOpen ? state.actionError : ''} onCreate={create} onCancel={() => setAddOpen(false)}/>
    </Dialog>}
    <SubscriptionSourceSheet source={sheetSource} onClose={() => setSheetID('')} state={state} groups={groups} busy={busy} context={mode === 'manage' ? 'manage' : 'reading'}
      onOpenInReader={id => { setSheetID(''); selectSource(id) }}/>
  </>
}
