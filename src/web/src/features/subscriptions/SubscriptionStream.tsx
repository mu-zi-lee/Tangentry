import { Button, Input } from '../../components/ui'
import { AlertCircle, ArrowRight, Check, CheckCheck, Circle, ExternalLink, History, LoaderCircle, RefreshCw, Search, Settings2, X } from 'lucide-react'
import { useMemo } from 'react'
import type { ContentItem, SubscriptionSource } from '../../shared/api/types'
import { ContentCard } from '../../shared/ui/ContentCard'
import { MediaFilters } from '../../shared/ui/MediaFilters'
import { CardCollection } from '../../shared/ui/CardCollection'
import { PaperCard } from '../documents/PaperCard'
import type { useReadState } from '../readstate/useReadState'
import { allSubscriptionsID, type useSubscriptions } from './useSubscriptions'
import { isYouTubeSource, sourceLinkLabel } from './sourcePresentation'
import { SubscriptionSourceIcon } from './SubscriptionSourceIcon'
import { formatTime, healthLabels, healthTone, needsAttention, refreshLabel, relativeTime } from './sourceHealth'

type ReadStates = ReturnType<typeof useReadState>
export type ReadFilter = 'all' | 'unread' | 'read'

export function ReadStatus({ readStates, id }: { readStates: ReadStates; id: string }) {
  const read = readStates.get(id)?.read
  return <span className="subscription-read-status" data-read={read ?? 'unknown'}>{readStates.available ? read ? <><Check size={12} aria-hidden="true"/>已读</> : <><span className="unread-dot" aria-hidden="true"/>未读</> : '状态待读取'}</span>
}

export function ReadToggle({ readStates, item, disabled }: { readStates: ReadStates; item: ContentItem; disabled: boolean }) {
  const read = readStates.get(item.id)?.read
  return <Button variant="quiet" disabled={disabled} aria-label={`${read ? '标为未读' : '标为已读'} ${item.title}`} title={read ? '标为未读' : '标为已读'} onClick={() => void readStates.setRead([item.id], !read)}>{read ? <CheckCheck size={16} aria-hidden="true"/> : <Circle size={15} aria-hidden="true"/>}<span>{read ? '标为未读' : '标为已读'}</span></Button>
}

export function SubscriptionStream({ state, readStates, savedIDs, savingIDs, savingUnavailable, onSave, onRead, filter, onFilter, readFilter, onReadFilter, kind, onKind, saveNotice, saveError, busy, onOpenSettings, settingsOpen, onSourceHistory, onAdd }: {
  state: ReturnType<typeof useSubscriptions>
  readStates: ReadStates
  savedIDs: Set<string>; savingIDs: Set<string>; savingUnavailable: boolean
  onSave: (item: ContentItem) => void; onRead: (item: ContentItem) => void
  filter: string; onFilter: (value: string) => void
  readFilter: ReadFilter; onReadFilter: (value: ReadFilter) => void
  kind: string; onKind: (value: string) => void
  saveNotice: string; saveError: boolean
  busy: boolean
  onOpenSettings: (source: SubscriptionSource) => void
  settingsOpen: boolean
  onSourceHistory: (sourceID: string) => void
  onAdd: () => void
}) {
  const showingAll = state.selectedId === allSubscriptionsID
  const source = showingAll ? undefined : state.sources.find(item => item.id === state.selectedId)
  const streamItems = showingAll ? state.allItems : state.detail?.items ?? []
  const keyword = filter.trim().toLocaleLowerCase()
  const matchingItems = useMemo(() => streamItems.filter(item => (kind === 'all' || item.kind === kind) && (!keyword || `${item.title} ${item.author}`.toLocaleLowerCase().includes(keyword))), [streamItems, keyword, kind])
  const effectiveReadFilter = readStates.available ? readFilter : 'all'
  const items = matchingItems.filter(item => effectiveReadFilter === 'all' || readStates.get(item.id)?.read === (effectiveReadFilter === 'read'))
  const unreadCount = readStates.available ? streamItems.filter(item => !readStates.get(item.id)?.read).length : null
  const kindCounts = useMemo(() => {
    const counts: Partial<Record<string, number>> = { all: streamItems.length }
    for (const item of streamItems) counts[item.kind] = (counts[item.kind] ?? 0) + 1
    return counts
  }, [streamItems])
  const readBusy = !readStates.ready || Boolean(readStates.pending.size) || state.reading || Boolean(state.pending) || state.allLoading || (!showingAll && state.detail?.source.id !== state.selectedId)
  const updating = Boolean(source && (state.pending?.kind === 'update' && state.pending.id === source.id || source.active))
  const loaded = showingAll ? !state.allLoading || state.allItems.length > 0 : Boolean(state.detail)
  const filtered = Boolean(keyword) || kind !== 'all' || effectiveReadFilter !== 'all'

  if (!showingAll && !source) {
    if (state.loading) return <section id="subscription-stream" tabIndex={-1} className="subscription-results" aria-label="来源投稿" aria-busy="true"><p className="field-hint" role="status">正在读取来源…</p></section>
    return <section id="subscription-stream" tabIndex={-1} className="subscription-results" aria-label="来源投稿"><div className="subscription-empty"><h2>这个来源已不在列表中</h2><p>它可能已被移除或在其他页面改名。历史内容仍保留在历史收件箱。</p></div></section>
  }

  const clear = () => { onFilter(''); onKind('all'); onReadFilter('all') }
  const empty = <div className="subscription-empty">
    <h3>{filter || kind !== 'all' ? '没有匹配的内容' : effectiveReadFilter === 'unread' ? '这一页已经读完了' : effectiveReadFilter === 'read' ? '还没有已读内容' : source && !source.lastUpdatedAt ? '还没有获取过内容' : '暂时没有可见内容'}</h3>
    <p>{filter ? '搜索只覆盖这一页已加载的标题和作者；更早的内容请到历史收件箱查找。' : kind !== 'all' ? '可切换媒体类型继续浏览。' : effectiveReadFilter !== 'all' ? '可切换到全部内容继续浏览。' : source ? '从来源获取最近一页后，内容会出现在这里。' : '更新订阅后，各来源的最新内容会汇总在这里。'}</p>
    <div className="subscription-empty-actions">
      {filtered && <Button className="button button-secondary" variant="secondary" onClick={clear}>清除筛选</Button>}
      {!filtered && source && <Button className="button button-primary" variant="primary" disabled={busy || state.reading || updating} onClick={() => void state.update(source.id)}><RefreshCw size={15} aria-hidden="true"/>获取最近内容</Button>}
      {!filtered && !source && !state.sources.length && <Button className="button button-primary" variant="primary" onClick={onAdd}>添加第一个订阅</Button>}
    </div>
  </div>

  return <section id="subscription-stream" tabIndex={-1} className="subscription-results" aria-label={showingAll ? '全部订阅' : '来源投稿'}>
    <header className="subscription-stream-header">
      {source ? <div className="subscription-stream-identity">
        <SubscriptionSourceIcon source={source} size={20}/>
        <div className="subscription-stream-title">
          <h2>{source.name}</h2>
          <p className="subscription-stream-meta">
            <a href={source.url} target="_blank" rel="noreferrer">{sourceLinkLabel(source)}<ExternalLink size={11} aria-hidden="true"/></a>
            <span title={formatTime(source.lastUpdatedAt, '尚未更新')}>{source.lastUpdatedAt ? `更新于 ${relativeTime(source.lastUpdatedAt)}` : '尚未更新'}</span>
            <span>{refreshLabel(source)}</span>
            {healthTone(source.refresh.status) !== 'healthy' && <span className="subscription-health-badge" data-tone={healthTone(source.refresh.status)}>{healthLabels[source.refresh.status]}</span>}
            <span className="subscription-result-count" aria-live="polite">{filtered ? `筛选后 ${items.length} / ${streamItems.length} 条` : `${streamItems.length} 条`}</span>
          </p>
        </div>
      </div> : <div className="subscription-stream-title">
        <h2>全部订阅</h2>
        <p className="subscription-stream-meta"><span className="subscription-result-count" aria-live="polite">{filtered ? `筛选后 ${items.length} / ${state.allItems.length} 条` : `各来源最新 ${state.allItems.length} 条`}</span>{unreadCount !== null && <span>{unreadCount} 条未读</span>}</p>
      </div>}
      <div className="subscription-stream-actions">
        <Button variant="quiet" className="subscription-mark-shown" aria-label="将当前结果标为已读" title="将当前结果标为已读" disabled={readBusy || !items.some(item => !readStates.get(item.id)?.read)} onClick={() => void readStates.setRead(items.map(item => item.id), true)}><CheckCheck size={16} aria-hidden="true"/><span className="subscription-hide-narrow">全部已读</span></Button>
        {source && <>
        <Button className="button button-primary" variant="primary" aria-label={updating ? '正在更新投稿' : '更新投稿'} title="从来源获取最近一页" disabled={busy || state.reading || source.active} onClick={() => void state.update(source.id)}>{updating ? <LoaderCircle className="spin" size={15} aria-hidden="true"/> : <RefreshCw size={15} aria-hidden="true"/>}{updating ? '正在更新' : '更新投稿'}</Button>
        <Button className="button button-secondary" variant="secondary" aria-label="来源设置" title="名称、分组、自动更新与健康" aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls="subscription-source-sheet" onClick={() => onOpenSettings(source)}><Settings2 size={15} aria-hidden="true"/><span className="subscription-hide-narrow">设置</span></Button>
        </>}
      </div>
    </header>

    {source && needsAttention(source) && !state.updateError && <div className="subscription-callout" role="status" data-tone="attention">
      <AlertCircle size={16} aria-hidden="true"/>
      <div><strong>{healthLabels[source.refresh.status]}</strong><p>{source.refresh.message || '最近一次同步没有成功。'}{source.refresh.enabled && ' 将按延后的计划重试。'}{source.lastUpdatedAt ? ' 下方保留上次成功获取的内容。' : ''}</p></div>
      <Button variant="quiet" className="text-button" onClick={() => onOpenSettings(source)}>查看详情</Button>
    </div>}
    {state.updateError && source && <div className="error-panel" role="alert"><AlertCircle size={18} aria-hidden="true"/><div><strong>内容未能更新</strong><p>{state.updateError}</p><small>{source.lastUpdatedAt ? '下面保留上次成功获取的内容，更新时间未改变。' : '来源已保存，暂时还没有成功获取的内容。'}</small></div></div>}
    {showingAll && state.allError && <div className="error-panel" role="alert"><AlertCircle size={18} aria-hidden="true"/><p>{state.allError}</p><Button className="button button-secondary" variant="secondary" onClick={() => void state.reloadDetail()}>重新读取</Button></div>}
    {!showingAll && state.detailError && <div className="error-panel" role="alert"><AlertCircle size={18} aria-hidden="true"/><p>{state.detailError}</p><Button className="button button-secondary" variant="secondary" disabled={state.reading || Boolean(state.pending)} onClick={() => void state.reloadDetail()}>重新读取缓存</Button></div>}

    <div className="subscription-reading-toolbar" role="search" aria-label="筛选当前内容">
      <label className="subscription-input subscription-filter">
        <Search size={15} aria-hidden="true"/>
        <span className="visually-hidden">{showingAll ? '搜索全部订阅' : '搜索已加载投稿'}</span>
        <Input type="search" aria-label={showingAll ? '搜索全部订阅' : '搜索订阅投稿'} placeholder="搜索标题或作者" value={filter} onChange={event => onFilter(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && filter) { event.stopPropagation(); onFilter('') } }}/>
        {filter && <Button variant="quiet" iconOnly className="icon-button" aria-label="清除搜索" onClick={() => onFilter('')}><X size={14} aria-hidden="true"/></Button>}
      </label>
      <div className="subscription-read-filters" role="group" aria-label="按已读状态筛选">
        <Button variant="quiet" aria-pressed={readFilter === 'all'} onClick={() => onReadFilter('all')}>全部</Button>
        <Button variant="quiet" aria-pressed={readFilter === 'unread'} onClick={() => onReadFilter('unread')}>未读{unreadCount !== null && <span className="count">{unreadCount}</span>}</Button>
        <Button variant="quiet" aria-pressed={readFilter === 'read'} onClick={() => onReadFilter('read')}>已读</Button>
      </div>
      <MediaFilters value={kind} onChange={onKind} counts={kindCounts}/>
    </div>

    {(state.reading || showingAll && state.allLoading) && !streamItems.length && <p className="field-hint" role="status">{showingAll ? '正在读取全部订阅…' : '正在读取本地投稿缓存…'}</p>}
    {readStates.loading && !readStates.available && <p className="field-hint" role="status">正在读取已读状态…</p>}
    {readStates.error && <p className="inline-feedback" role="alert">{readStates.error}{!readStates.available && ' 暂时显示全部内容。'}<Button className="button button-secondary" variant="secondary" disabled={Boolean(readStates.pending.size)} onClick={readStates.refresh}>重新读取已读状态</Button></p>}
    {saveNotice && <p className="inline-feedback collection-save-feedback" role={saveError ? 'alert' : 'status'}>{saveError ? <AlertCircle size={17} aria-hidden="true"/> : <Check size={17} aria-hidden="true"/>}{saveNotice}</p>}
    {savingUnavailable && <p className="field-hint">资料库暂时无法读取，收藏操作不可用。</p>}

    {items.length > 0 ? <CardCollection className="content-collection subscription-gallery" aria-label={showingAll ? '全部订阅内容' : '来源内容'} data-media={items.every(item => item.kind === 'article') ? 'article' : kind} masonry={false}>
      {items.map(item => item.paper
        ? <PaperCard key={item.id} item={item} saved={savedIDs.has(item.id)} pending={savingUnavailable || savingIDs.has(item.id)} onSave={onSave} onRead={onRead} status={<ReadStatus readStates={readStates} id={item.id}/>} actions={<ReadToggle readStates={readStates} item={item} disabled={readBusy}/>}/>
        : <ContentCard key={item.id} headingLevel={3} item={item} saved={savedIDs.has(item.id)} pending={savingUnavailable || savingIDs.has(item.id)} onSave={onSave} onRead={onRead} status={<ReadStatus readStates={readStates} id={item.id}/>} actions={<ReadToggle readStates={readStates} item={item} disabled={readBusy}/>}/>)}
    </CardCollection> : loaded && empty}

    <footer className="subscription-stream-footer">
      {source && isYouTubeSource(source) && <p className="field-hint">这里显示频道公开 feed 的近期更新，通常最多 15 条。完整历史请打开频道查看。</p>}
      {source?.hasMore && <p className="field-hint">这里显示最近一页；获取过的条目都会保留在历史收件箱。</p>}
      {(source || state.allItems.length >= 50) && <Button variant="quiet" className="text-button subscription-history-link" onClick={() => onSourceHistory(source?.id ?? '')}><History size={14} aria-hidden="true"/>{source ? '在历史收件箱查看这个来源的全部内容' : '在历史收件箱查看更早的内容'}<ArrowRight size={14} aria-hidden="true"/></Button>}
    </footer>
  </section>
}
