import { Button, Input } from '../../components/ui'
import { AlertCircle, Check, CheckCheck, Circle, LoaderCircle, Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ContentItem } from '../../shared/api/types'
import { ContentCard } from '../../shared/ui/ContentCard'
import { MediaFilters } from '../../shared/ui/MediaFilters'
import { CardCollection } from '../../shared/ui/CardCollection'
import type { useReadState } from '../readstate/useReadState'
import type { useSubscriptions } from './useSubscriptions'
import './subscriptions.css'
import { SubscriptionRefreshSettings } from './SubscriptionRefreshSettings'
import { SubscriptionAddForm } from './SubscriptionAddForm'
import { isYouTubeSource, supportsRefresh, sourceLinkLabel } from './sourcePresentation'
import { SubscriptionSources } from './SubscriptionSources'
import { SubscriptionGroupAssignment } from './SubscriptionGroupAssignment'
import { useSubscriptionGroups } from './useSubscriptionGroups'
import { SubscriptionInbox } from './SubscriptionInbox'
import type { useSubscriptionInbox } from './useSubscriptionInbox'
import { SubscriptionPortability } from './SubscriptionPortability'
import { SubscriptionAddressSettings } from './SubscriptionAddressSettings'
import { SubscriptionSourceIcon } from './SubscriptionSourceIcon'
import { PageHeader } from '../../shared/ui/PageHeader'
import { SubscriptionHealthCenter } from './SubscriptionHealthCenter'
import type { SavedView } from '../../shared/api/types'
import type { InboxFilters } from './useSubscriptionInbox'
import { PaperCard } from '../documents/PaperCard'
import { allSubscriptionsID } from './useSubscriptions'

type Subscriptions = ReturnType<typeof useSubscriptions>
const updated = (seconds: number) => seconds ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(seconds * 1000)) : '尚未更新'

export function SubscriptionsPage({ subscriptions: state, savedIDs, savingUnavailable, savingIDs, onSave, onRead, filter, onFilter, saveNotice, saveError, readStates, readFilter, onReadFilter, inbox, mode, onMode, views,selectedViewID,onSelectView,onApplyFilters,onSaveView,onUpdateView,onDeleteView }: {
  inbox: ReturnType<typeof useSubscriptionInbox>; mode: 'latest' | 'history' | 'health'; onMode: (mode: 'latest' | 'history' | 'health') => void
  readStates: ReturnType<typeof useReadState>; readFilter: 'all' | 'unread' | 'read'; onReadFilter: (value: 'all' | 'unread' | 'read') => void
  subscriptions: Subscriptions; savedIDs: Set<string>; savingUnavailable: boolean; savingIDs: Set<string>
  onSave: (item: ContentItem) => void; onRead: (item: ContentItem) => void
  filter: string; onFilter: (value: string) => void; saveNotice: string; saveError: boolean
  views: SavedView[];selectedViewID:string;onSelectView:(id:string)=>void;onApplyFilters:(filters:InboxFilters)=>void;onSaveView:(name:string,filters:InboxFilters)=>Promise<void>;onUpdateView:(id:string,edit:Partial<Pick<SavedView,'name'|'definition'|'icon'|'color'|'default'>>)=>void;onDeleteView:(id:string)=>void
}) {
  const [editing, setEditing] = useState(false)
  const [kind, setKind] = useState('all')
  const groups = useSubscriptionGroups(state.setMembership, state.dissolveGroup)
  const [draftName, setDraftName] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [adding, setAdding] = useState(() => new URLSearchParams(location.search).get('add') === 'rss')
  const addRSSRequested = new URLSearchParams(location.search).get('add') === 'rss'
  const [settingsOpen, setSettingsOpen] = useState(() => {
    try { return sessionStorage.getItem('tangentry-subscription-settings-open') !== 'false' } catch { return true }
  })
  const sourceInput = useRef<HTMLInputElement>(null)
  const editInput = useRef<HTMLInputElement>(null)
  const busy = Boolean(state.pending) || state.loading || Boolean(state.listError) || Boolean(groups.pending)
  const source = state.sources.find(item => item.id === state.selectedId)
  const showingAll = state.selectedId === allSubscriptionsID
  const streamItems = showingAll ? state.allItems : state.detail?.items ?? []
  const matchingItems = useMemo(() => {
    const keyword = filter.trim().toLocaleLowerCase()
    return streamItems.filter(item => (kind === 'all' || item.kind === kind) && (!keyword || `${item.title} ${item.author}`.toLocaleLowerCase().includes(keyword)))
  }, [streamItems, filter, kind])
  const effectiveReadFilter = readStates.available ? readFilter : 'all'
  const items = matchingItems.filter(item => effectiveReadFilter === 'all' || readStates.get(item.id)?.read === (effectiveReadFilter === 'read'))
  const unreadCount = readStates.available ? streamItems.filter(item => !readStates.get(item.id)?.read).length : null
  const readBusy = !readStates.ready || Boolean(readStates.pending.size) || state.reading || Boolean(state.pending) || state.allLoading || (!showingAll && state.detail?.source.id !== state.selectedId)
  useEffect(() => { setEditing(false); setConfirmRemove(false) }, [state.selectedId])
  useEffect(() => { if (editing) editInput.current?.focus() }, [editing])
  useLayoutEffect(() => { if (!state.loading && !state.sources.length && !state.listError) setAdding(true) }, [state.loading, state.sources.length, state.listError])
  useEffect(() => { if (addRSSRequested) setAdding(true) }, [addRSSRequested])
  useEffect(() => {
    try { sessionStorage.setItem('tangentry-subscription-settings-open', String(settingsOpen)) } catch { /* Settings remain usable without storage. */ }
  }, [settingsOpen])
  const openAdd = () => {
    setAdding(true)
    requestAnimationFrame(() => sourceInput.current?.focus())
  }
  const renderItems = (ariaLabel: string) => items.length > 0 ? <CardCollection className="content-collection subscription-gallery" aria-label={ariaLabel} data-media={items.every(item => item.kind === 'article') ? 'article' : kind} masonry={false}>{items.map(item => { const read = readStates.get(item.id)?.read; const status = <span className="subscription-read-status" data-read={read ?? 'unknown'}>{readStates.available ? read ? <><Check size={12} aria-hidden="true"/>已读</> : <><span className="unread-dot" aria-hidden="true"/>未读</> : '状态待读取'}</span>; const actions = <Button variant="quiet" disabled={readBusy} aria-label={`${read ? '标为未读' : '标为已读'} ${item.title}`} title={read ? '标为未读' : '标为已读'} onClick={() => void readStates.setRead([item.id], !read)}>{read ? <CheckCheck size={16} aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}<span>{read ? '标为未读' : '标为已读'}</span></Button>; return item.paper ? <PaperCard key={item.id} item={item} saved={savedIDs.has(item.id)} pending={savingUnavailable || savingIDs.has(item.id)} onSave={onSave} onRead={onRead} status={status} actions={actions} /> : <ContentCard status={status} actions={actions} headingLevel={3} key={item.id} item={item} saved={savedIDs.has(item.id)} pending={savingUnavailable || savingIDs.has(item.id)} onSave={onSave} onRead={onRead} /> })}</CardCollection> : <div className="subscription-empty"><h3>{filter || kind !== 'all' ? '没有匹配的投稿' : effectiveReadFilter === 'unread' ? '这一页已经读完了' : effectiveReadFilter === 'read' ? '还没有已读内容' : '暂时没有可见投稿'}</h3><p>{filter ? '搜索只覆盖这一页的标题和作者。' : kind !== 'all' ? '可切换媒体类型继续浏览。' : effectiveReadFilter !== 'all' ? '可切换到全部内容继续浏览。' : '更新订阅后，最近内容会出现在这里。'}</p>{filter && <Button variant="secondary" className="button button-secondary" onClick={() => onFilter('')}>清除搜索</Button>}{effectiveReadFilter !== 'all' && <Button variant="secondary" className="button button-secondary" onClick={() => onReadFilter('all')}>查看全部内容</Button>}{kind !== 'all' && <Button variant="secondary" className="button button-secondary" onClick={() => setKind('all')}>查看全部媒体</Button>}</div>

  return <>
    <PageHeader className="subscription-page-header" title="订阅管理" summary={state.loading && !state.sources.length ? '正在读取来源…' : state.sources.length ? `${state.sources.length} 个来源${groups.groups.length ? ` · ${groups.groups.length} 个分组` : ''}` : '管理创作者、频道、RSS 与播客来源。'} actions={<>
      {mode === 'latest' && state.sources.length > 0 && <Button variant="secondary" className="button button-secondary subscription-update-all" disabled={busy || Boolean(state.batch?.running)} onClick={() => void state.batchUpdate(state.sources.map(item => item.id))}>{state.batch?.running && state.batch.kind === 'update' ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}<span>{state.batch?.running && state.batch.kind === 'update' ? `更新中 ${state.batch.completed}/${state.batch.total}` : '全部更新'}</span></Button>}
      <details className="subscription-more"><summary className="button button-secondary"><SlidersHorizontal size={15} aria-hidden="true"/>订阅工具</summary><div className="subscription-more-panel"><SubscriptionPortability /></div></details>
      <Button variant="primary" id="subscription-add-toggle" className="button button-primary subscription-add-toggle" type="button" aria-expanded={adding} aria-controls="subscription-add-panel" onClick={() => adding ? setAdding(false) : openAdd()}>{adding ? <X size={16}/> : <Plus size={16}/>}<span>{adding ? '收起添加' : '添加订阅'}</span></Button>
    </>} aria-busy={state.loading}/>
    <nav className="subscription-page-tabs" aria-label="订阅管理"><Button variant="quiet" aria-label="来源管理" aria-current={mode==='latest'?'page':undefined} onClick={()=>onMode('latest')}>来源管理<span>{state.sources.length}</span></Button><Button variant="quiet" aria-current={mode==='history'?'page':undefined} onClick={()=>onMode('history')}>历史收件箱</Button><Button variant="quiet" aria-current={mode==='health'?'page':undefined} onClick={()=>onMode('health')}>来源健康</Button></nav>
    {state.batch && state.batch.kind === 'update' && <div className={`subscription-batch-progress ${state.batch.running ? 'running' : 'complete'}`} role="status"><div className="subscription-batch-progress-copy"><strong>{state.batch.running ? `正在更新来源 ${state.batch.completed}/${state.batch.total}` : `已完成 ${state.batch.total - state.batch.failed}/${state.batch.total} 个来源`}</strong>{state.batch.failed > 0 && <span>{state.batch.failed} 个来源失败，已保留旧内容。</span>}</div><div className="subscription-batch-progress-track"><span style={{ width: `${state.batch.total ? Math.round(state.batch.completed / state.batch.total * 100) : 0}%` }} /></div>{!state.batch.running && state.batch.failed > 0 && <Button variant="secondary" className="button button-secondary" onClick={() => void state.retryBatchFailed()}><RefreshCw size={14} aria-hidden="true" />重试失败项</Button>}</div>}
    <div id="subscription-add-panel" hidden={!adding}><SubscriptionAddForm busy={busy} creating={state.pending?.kind === 'create'} inputRef={sourceInput} onCreate={(query, name, type) => state.create(query, name, type)} /></div>
    {mode==='history'?<SubscriptionInbox inbox={inbox} sources={state.sources} groups={groups.groups} readStates={readStates} savedIDs={savedIDs} savingIDs={savingIDs} savingUnavailable={savingUnavailable} onRead={onRead} onSave={onSave} saveNotice={saveNotice} saveError={saveError} views={views} selectedViewID={selectedViewID} onSelectView={onSelectView} onApplyFilters={onApplyFilters} onSaveView={onSaveView} onUpdateView={onUpdateView} onDeleteView={onDeleteView}/>:mode==='health'?<SubscriptionHealthCenter state={state} onOpenSource={id=>{state.select(id);onMode('latest')}}/>:<>
    {state.actionError && <div className="error-panel" role="alert"><AlertCircle size={18} /><p>{state.actionError}</p></div>}
    {state.notice && <p className="inline-feedback" role="status"><Check size={17} />{state.notice}</p>}
    {state.listError && <div className="error-panel" role="alert"><AlertCircle size={18} /><p>{state.listError} 已显示的来源可能不是最新记录。</p><Button variant="secondary" className="button button-secondary" disabled={state.loading} onClick={() => void state.reload()}>重新加载来源</Button></div>}
    <div className="subscriptions-workspace">
      <SubscriptionSources state={state} groups={groups} />
      <section className="subscription-results" aria-label={showingAll ? '全部订阅' : '来源投稿'}>
        {showingAll ? <>
          <div className="subscription-all-heading"><div><h2>全部订阅</h2><p>把所有来源的最新内容放在同一条时间线上。</p></div><Button variant="secondary" className="button button-secondary" disabled={busy || Boolean(state.batch?.running)} onClick={() => void state.batchUpdate(state.sources.map(item => item.id))}><RefreshCw size={15}/><span>更新全部来源</span></Button></div>
          {state.allError && <div className="error-panel" role="alert"><AlertCircle size={18}/><p>{state.allError}</p><Button variant="secondary" className="button button-secondary" onClick={() => void state.reloadDetail()}>重新读取</Button></div>}
          {state.allLoading && <p className="field-hint" role="status">正在读取全部订阅…</p>}
          <div className="subscription-reading-toolbar"><label className="subscription-field subscription-filter"><span className="visually-hidden">搜索全部订阅</span><div className="subscription-input"><Search size={15} aria-hidden="true"/><Input type="search" aria-label="搜索全部订阅" placeholder="搜索标题或作者" value={filter} onChange={event => onFilter(event.target.value)} /></div></label><div className="subscription-read-filters" role="group" aria-label="按已读状态筛选"><Button variant="quiet" aria-pressed={readFilter === 'all'} onClick={() => onReadFilter('all')}>全部</Button><Button variant="quiet" aria-pressed={readFilter === 'unread'} onClick={() => onReadFilter('unread')}>未读{unreadCount !== null && <span className="count">{unreadCount}</span>}</Button><Button variant="quiet" aria-pressed={readFilter === 'read'} onClick={() => onReadFilter('read')}>已读</Button></div><Button variant="quiet" iconOnly className="icon-button subscription-mark-shown" aria-label="将当前结果标为已读" title="将当前结果标为已读" disabled={readBusy || !items.some(item => !readStates.get(item.id)?.read)} onClick={() => void readStates.setRead(items.map(item => item.id), true)}><CheckCheck size={17} aria-hidden="true"/></Button></div>
          <div className="subscription-media-toolbar"><MediaFilters value={kind} onChange={setKind}/><span className="subscription-result-count">{items.length} 条内容</span></div>
          {renderItems('全部订阅内容')}
        </> : source ? <>
          <div className="subscription-detail-heading"><div className="subscription-source-identity"><SubscriptionSourceIcon source={source}/><div className="subscription-source-meta"><h2>{source.name}</h2><p><a href={source.url} target="_blank" rel="noreferrer">{sourceLinkLabel(source)}</a></p><p className="subscription-updated" title={updated(source.lastUpdatedAt)}>{source.lastUpdatedAt ? `更新于 ${updated(source.lastUpdatedAt)}` : '尚未更新'}</p></div></div><div className="subscription-actions"><Button variant="primary" className="button button-primary" aria-label={state.pending?.kind === 'update' && state.pending.id === source.id || source.active ? '正在更新投稿' : '更新投稿'} title="更新投稿" disabled={busy || state.reading || source.active} onClick={() => void state.update(source.id)}>{state.pending?.kind === 'update' && state.pending.id === source.id ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{state.pending?.kind === 'update' && state.pending.id === source.id || source.active ? '正在更新' : '更新投稿'}</Button><Button variant="quiet" iconOnly type="button" className="icon-button" aria-label="来源设置" title="来源设置" aria-expanded={settingsOpen} aria-controls="subscription-source-settings" onClick={() => setSettingsOpen(value => !value)}><SlidersHorizontal size={17}/></Button><Button variant="quiet" iconOnly className="icon-button" aria-label="重命名来源" title="重命名来源" disabled={busy} onClick={() => { setDraftName(source.name); setEditing(!editing); setConfirmRemove(false) }}><Pencil size={16} /></Button><Button variant="quiet" iconOnly className="icon-button" aria-label="移除来源" title="移除来源" disabled={busy} onClick={() => { setConfirmRemove(!confirmRemove); setEditing(false) }}><Trash2 size={16} /></Button></div></div>
          <div id="subscription-source-settings" hidden={!settingsOpen}><div className="subscription-detail-settings"><SubscriptionGroupAssignment key={`group:${source.id}`} source={source} groups={groups} busy={busy || state.reading} />
          {supportsRefresh(source) && <SubscriptionRefreshSettings key={`refresh:${source.id}`} source={source} busy={busy || source.active} onSave={(enabled, interval) => state.configureRefresh(source.id, enabled, interval)} />}
          {source.id.startsWith('rss:feed:') && <SubscriptionAddressSettings key={`address:${source.id}`} source={source} busy={busy || state.reading || source.active} onSave={(url, expected) => state.editAddress(source.id, url, expected)} />}
          </div></div>
          {!settingsOpen && source.refresh.message && <p className="subscription-refresh-error" role="status">{source.refresh.message}{source.refresh.enabled && ' 将按延后的计划重试。'}</p>}
          {editing && <form className="subscription-edit" onSubmit={event => { event.preventDefault(); void state.rename(source.id, draftName).then(ok => { if (ok) setEditing(false) }) }}><label className="subscription-field"><span>新名称</span><div className="subscription-input"><Input ref={editInput} aria-label="来源新名称" value={draftName} onChange={event => setDraftName(event.target.value)} required /></div></label><Button variant="secondary" className="button button-secondary" disabled={busy || !draftName.trim()}>保存名称</Button><Button variant="quiet" iconOnly type="button" className="icon-button" aria-label="取消重命名" disabled={busy} onClick={() => setEditing(false)}><X size={16} /></Button></form>}
          {confirmRemove && <div className="subscription-remove"><p>移除来源和最新投稿缓存？历史收件箱、收藏、下载和笔记仍会保留。</p><div><Button variant="secondary" className="button button-secondary" disabled={busy} onClick={() => setConfirmRemove(false)}>保留来源</Button><Button variant="primary" className="button button-primary" disabled={busy} onClick={() => void state.remove(source.id).then(ok => { if (ok) { setConfirmRemove(false); sourceInput.current?.focus() } })}>确认移除</Button></div></div>}
          {state.updateError && <div className="error-panel" role="alert"><AlertCircle size={18} /><div><strong>内容未能更新</strong><p>{state.updateError}</p><small>{source.lastUpdatedAt ? '下面保留上次成功获取的内容，更新时间未改变。' : '来源已保存，暂时还没有成功获取的内容。'}</small></div></div>}
          {state.detailError && <div className="error-panel" role="alert"><AlertCircle size={18} /><p>{state.detailError}</p><Button variant="secondary" className="button button-secondary" disabled={state.reading || Boolean(state.pending)} onClick={() => void state.reloadDetail()}>重新读取缓存</Button></div>}
          {state.reading && <p className="field-hint" role="status">正在读取本地投稿缓存…</p>}
          {!settingsOpen && state.detail && <>
            <div className="subscription-reading-toolbar">
              <label className="subscription-field subscription-filter"><span className="visually-hidden">搜索已加载投稿</span><div className="subscription-input"><Search size={15} aria-hidden="true"/><Input type="search" aria-label="搜索订阅投稿" placeholder="搜索标题或作者" value={filter} onChange={event => onFilter(event.target.value)} /></div></label>
              <div className="subscription-read-filters" role="group" aria-label="按已读状态筛选">
                <Button variant="quiet" aria-pressed={readFilter === 'all'} onClick={() => onReadFilter('all')}>全部</Button>
                <Button variant="quiet" aria-pressed={readFilter === 'unread'} onClick={() => onReadFilter('unread')}>未读{unreadCount !== null && <span className="count">{unreadCount}</span>}</Button>
                <Button variant="quiet" aria-pressed={readFilter === 'read'} onClick={() => onReadFilter('read')}>已读</Button>
              </div>
              <Button variant="quiet" iconOnly className="icon-button subscription-mark-shown" aria-label="将当前结果标为已读" title="将当前结果标为已读" disabled={readBusy || !items.some(item => !readStates.get(item.id)?.read)} onClick={() => void readStates.setRead(items.map(item => item.id), true)}><CheckCheck size={17} aria-hidden="true"/></Button>
            </div>
            <div className="subscription-media-toolbar"><MediaFilters value={kind} onChange={setKind}/><span className="subscription-result-count">{items.length} 条内容</span></div>
            {readStates.loading && !readStates.available && <p className="field-hint" role="status">正在读取已读状态…</p>}
            {readStates.error && <p className="inline-feedback" role="alert">{readStates.error}{!readStates.available && ' 暂时显示全部内容。'}<Button variant="secondary" className="button button-secondary" disabled={Boolean(readStates.pending.size)} onClick={readStates.refresh}>重新读取已读状态</Button></p>}
            {saveNotice && <p className="inline-feedback collection-save-feedback" role={saveError ? 'alert' : 'status'}>{saveError ? <AlertCircle size={17} /> : <Check size={17} />}{saveNotice}</p>}
            {savingUnavailable && <p className="field-hint">资料库暂时无法读取，收藏操作不可用。</p>}
            {renderItems('来源内容')}
            {isYouTubeSource(source) && <p className="field-hint">这里显示频道公开 feed 的近期更新，通常最多 15 条，包含频道发布的不同视频类型。完整历史请打开频道查看。</p>}
            {source.hasMore && <p className="field-hint">这里显示最近一页；获取过的条目会保留在历史收件箱。更多投稿可在 B站主页查看。</p>}
          </>}
        </> : !state.loading && !state.listError && <div className="subscription-empty"><h2>让发现有一个来处</h2><p>先保存一位喜欢的创作者。</p><Button variant="secondary" className="button button-secondary" onClick={openAdd}>添加第一个订阅</Button></div>}
      </section>
    </div>
    </>}
  </>
}
