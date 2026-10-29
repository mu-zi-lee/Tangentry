import { Button, Input, Select } from '../../components/ui'
import { ArrowLeft, Link2, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { request } from '../../shared/api/client'
import type { ContentItem, Feed, SearchPage, UnifiedSearchResponse } from '../../shared/api/types'
import { ModernGalleryCard } from '../../shared/ui/ModernGalleryCard'
import { CardCollection } from '../../shared/ui/CardCollection'
import { appendSearchItems, buildSearchParams, creatorPlatformSupport, groupSearchResults, mergeSearchItems, type SearchGroup, type SearchMode } from './searchLogic'
import { SourceComposer, detectSource } from '../discovery/SourceComposer'
import type { DiscoverySource } from '../discovery/sources'
import { SearchHistory } from './SearchHistory'
import { useSearchHistory } from './useSearchHistory'
import { searchEntryMode } from './entryMode'

const labels: Record<string, string> = { bilibili: 'B站', youtube: 'YouTube', linuxdo: 'Linux.do', xiaoyuzhou: '小宇宙', xiaohongshu: '小红书', douyin: '抖音', local: '本机资料库与订阅' }
type TimeFilter = '' | 'day' | 'week' | 'month'
type Props = { initialQuery?: string; savedIDs: Set<string>; pending: Set<string>; onRead: (item: ContentItem) => void; onSave: (item: ContentItem) => void; onCreator: (platform: string, authorID: string) => void; onReturnCreator?: () => void; onReturnCreatorLabel?: string; onRouteChange?: (path: string) => void; onSubscribe: (platform: string, authorID: string) => void }

function timeBounds(value: TimeFilter): { from?: number; to?: number } {
  if (!value) return {}
  const to = Math.floor(Date.now() / 1000)
  return { from: to - (value === 'day' ? 86400 : value === 'week' ? 7 * 86400 : 30 * 86400), to }
}

export function UnifiedSearchPage({ initialQuery = '', savedIDs, pending, onRead, onSave, onCreator, onReturnCreator, onReturnCreatorLabel = '返回搜索', onRouteChange, onSubscribe }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [platform, setPlatform] = useState('')
  const [kind, setKind] = useState('')
  const [time, setTime] = useState<TimeFilter>('')
  const [mode, setMode] = useState<SearchMode>('grouped')
  const [entryMode, setEntryMode] = useState<'add' | 'search'>(() => searchEntryMode(location.search))
  const [addSource, setAddSource] = useState<DiscoverySource>(() => detectSource(initialQuery) ?? 'bilibili')
  const [addDraft, setAddDraft] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')
  const addInput = useRef<HTMLInputElement | null>(null)
  const searchHistory = useSearchHistory()
  const [result, setResult] = useState<UnifiedSearchResponse | null>(null)
  const [loadingMore, setLoadingMore] = useState<Set<string>>(new Set())
  const creator = new URLSearchParams(location.search).get('creator')
  const creatorPlatform = new URLSearchParams(location.search).get('creatorPlatform')
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const groups = useMemo(() => result ? groupSearchResults(result, labels) : [], [result])
  const mixed = useMemo(() => mergeSearchItems(groups), [groups])
  function syncStateFromURL() {
    const params = new URLSearchParams(location.search)
    setQuery(params.get('q') ?? '')
    setPlatform(params.get('platform') ?? '')
    setKind(params.get('kind') ?? '')
    setTime((params.get('time') as TimeFilter) || '')
    setMode(params.get('mode') === 'mixed' ? 'mixed' : 'grouped')
    setEntryMode(searchEntryMode(location.search))
  }
  function syncSearchURL(nextQuery = query, nextPlatform = platform, nextKind = kind, nextTime = time, nextMode = mode) {
    const params = new URLSearchParams({ entry: 'search' })
    if (nextQuery.trim()) params.set('q', nextQuery.trim())
    if (nextPlatform) params.set('platform', nextPlatform)
    if (nextKind) params.set('kind', nextKind)
    if (nextTime) params.set('time', nextTime)
    if (nextMode !== 'grouped') params.set('mode', nextMode)
    onRouteChange?.(`/search${params.toString() ? `?${params}` : ''}`)
  }

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    syncStateFromURL()
    if (initialQuery.trim()) void search(initialQuery)
    const onPopState = () => syncStateFromURL()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [initialQuery])
  useEffect(() => { if (result && query.trim() && !creator) void search(query) }, [platform, kind, time])

  async function search(nextQuery = query) {
    const value = nextQuery.trim()
    if (!value) return
    controller.current?.abort()
    const next = new AbortController(); controller.current = next; setError('')
    try {
      const linkSource = value.match(/bilibili\.com|b23\.tv|youtube\.com|youtu\.be|linux\.do|xiaoyuzhoufm\.com|xiaohongshu\.com|xhslink\.com|douyin\.com/i)
      if (linkSource) {
        const source = /bilibili|b23\.tv/i.test(value) ? 'bilibili' : /youtube|youtu\.be/i.test(value) ? 'youtube' : /linux\.do/i.test(value) ? 'linuxdo' : /xiaoyuzhou/i.test(value) ? 'xiaoyuzhou' : /xiaohongshu|xhslink/i.test(value) ? 'xiaohongshu' : 'douyin'
        const feed = await request<Feed>(`/discovery/${source}?q=${encodeURIComponent(value)}`, { signal: next.signal })
        setResult({ query: value, local: { items: [], total: 0, counts: {} }, sources: { [source]: { page: { ...feed, platform: source, cursor: undefined } } }, link: feed }); return
      }
      const bounds = timeBounds(time)
      const params = buildSearchParams(value, { platform, kind, ...bounds })
      setResult(await request<UnifiedSearchResponse>(`/search?${params}`, { signal: next.signal }))
    } catch (cause) { if (!next.signal.aborted) setError(cause instanceof Error ? cause.message : '搜索未能完成。') }
  }

  function selectEntryMode(next: 'add' | 'search') {
    setEntryMode(next)
    setResult(null)
    setError('')
    const params = new URLSearchParams(location.search)
    if (next === 'add') {
      params.set('entry', 'add')
      params.delete('q')
    } else {
      params.set('entry', 'search')
    }
    onRouteChange?.(`/search${params.toString() ? `?${params}` : ''}`)
  }

  async function addContent() {
    const value = addDraft.trim()
    if (!value || addLoading) return
    setAddLoading(true)
    setAddError('')
    searchHistory.add(value, addSource)
    try {
      if (addSource === 'paper') {
        const item = await request<ContentItem>('/papers/import', { method: 'POST', body: JSON.stringify({ query: value }) })
        onRead(item)
        return
      }
      const feed = await request<Feed>(`/discovery/${addSource}?q=${encodeURIComponent(value)}`)
      if (feed.items.length === 1) {
        onRead(feed.items[0])
        return
      }
      setResult({ query: value, local: { items: [], total: 0, counts: {} }, sources: { [addSource]: { page: { ...feed, platform: addSource, cursor: undefined } } }, link: feed })
    } catch (cause) {
      setAddError(cause instanceof Error ? cause.message : '内容未能获取，请检查链接或稍后重试。')
    } finally {
      setAddLoading(false)
    }
  }

  async function loadMore(group: SearchGroup) {
    const source = result?.sources[group.key]; const cursor = source?.page.cursor
    if (!result || !cursor || loadingMore.has(group.key) || group.key === 'local') return
    setLoadingMore(current => new Set(current).add(group.key))
    try {
      const bounds = timeBounds(time)
      const params = buildSearchParams(result.query, { platform: group.key, cursor, kind, ...bounds })
      const page = await request<UnifiedSearchResponse>(`/search?${params}`); const incoming = page.sources[group.key]?.page
      if (incoming) setResult(current => { if (!current) return page; const previous = current.sources[group.key]?.page; const merged: SearchPage = { ...incoming, items: appendSearchItems(previous?.items ?? [], incoming.items) }; return { ...current, sources: { ...current.sources, [group.key]: { page: merged, error: page.sources[group.key]?.error } } } })
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加载更多结果失败。') }
    finally { setLoadingMore(current => { const next = new Set(current); next.delete(group.key); return next }) }
  }

  async function loadCreatorMore() {
    if (!result || !creator || !creatorPlatform || loadingMore.has(creatorPlatform)) return
    const page = result.sources[creatorPlatform]?.page.cursor
    if (!page) return
    setLoadingMore(current => new Set(current).add(creatorPlatform))
    try {
      const feed = await request<SearchPage>(`/search/creator/${creatorPlatform}/${encodeURIComponent(creator)}?cursor=${encodeURIComponent(page)}`)
      setResult(current => {
        if (!current) return current
        const previous = current.sources[creatorPlatform]?.page
        const merged: SearchPage = { ...previous, ...feed, platform: creatorPlatform, items: appendSearchItems(previous?.items ?? [], feed.items) }
        return { ...current, sources: { ...current.sources, [creatorPlatform]: { page: merged } } }
      })
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加载创作者内容失败。') }
    finally { setLoadingMore(current => { const next = new Set(current); next.delete(creatorPlatform); return next }) }
  }

  useEffect(() => {
    if (!creator || !creatorPlatform) return
    if (!creatorPlatformSupport(creatorPlatform).view) { setError(`${labels[creatorPlatform] ?? creatorPlatform} 暂时不支持创作者临时视图。`); return }
    const next = new AbortController(); controller.current = next
    request<SearchPage>(`/search/creator/${creatorPlatform}/${encodeURIComponent(creator)}`, { signal: next.signal }).then(feed => setResult({ query: creator, local: { items: [], total: 0, counts: {} }, sources: { [creatorPlatform]: { page: feed } } })).catch(cause => { if (!next.signal.aborted) setError(cause instanceof Error ? cause.message : '暂时无法读取创作者内容。') })
    return () => next.abort()
  }, [creator, creatorPlatform])

  function card(item: ContentItem) { return <ModernGalleryCard item={item} saved={savedIDs.has(item.id)} pending={pending.has(item.id)} onRead={onRead} onSave={onSave} onCreator={item.authorId ? value => onCreator(value.platform, value.authorId) : undefined} /> }

  if (creator && creatorPlatform) {
    const support = creatorPlatformSupport(creatorPlatform)
    return <section className="creator-temporary-view"><Button variant="secondary" type="button" className="button button-secondary" onClick={() => onReturnCreator?.()}><ArrowLeft size={16}/>{onReturnCreatorLabel}</Button><div className="results-heading"><div><strong>{labels[creatorPlatform] ?? creatorPlatform} 创作者最近内容</strong>{!support.subscribe && <p className="field-hint">该平台暂不支持一键订阅；这是一次性的临时查看，不会写入订阅或推荐偏好。</p>}</div>{support.subscribe && <Button variant="primary" type="button" className="button button-primary" onClick={() => onSubscribe(creatorPlatform, creator)}>订阅</Button>}</div>{error && <div className="error-panel" role="alert">{error}</div>}{groups.map(group => <div key={group.key}><CardCollection masonry className="modern-gallery">{group.items.map(card)}</CardCollection>{result?.sources[group.key]?.page.hasMore && result.sources[group.key].page.cursor && <Button variant="secondary" type="button" className="button button-secondary" onClick={() => void loadCreatorMore()} disabled={loadingMore.has(group.key)}>{loadingMore.has(group.key) ? '正在加载…' : '查看更多'}</Button>}</div>)}</section>
  }

  return <>
    <section className="unified-search-head">
      <div className="unified-search-title-row"><div><h1>{entryMode === 'add' ? '添加内容' : '统一搜索'}</h1><p>{entryMode === 'add' ? '粘贴链接、ID 或订阅地址，识别后直接进入阅读。' : '在本机资料库与已启用的平台中查找内容。'}</p></div><div className="segmented" role="group" aria-label="内容入口"><Button variant="quiet" type="button" aria-pressed={entryMode === 'add'} onClick={() => selectEntryMode('add')}><Link2 size={14}/>添加内容</Button><Button variant="quiet" type="button" aria-pressed={entryMode === 'search'} onClick={() => selectEntryMode('search')}><Search size={14}/>搜索内容</Button></div></div>
      {entryMode === 'add' ? <>
        <SourceComposer source={addSource} onSource={source => { setAddSource(source); setAddError('') }} draft={addDraft} onDraft={setAddDraft} loading={addLoading} input={addInput} onSubmit={() => void addContent()} onImported={onRead} />
        {addError && <div className="error-panel" role="alert"><strong>添加失败</strong><p>{addError}</p></div>}
        <SearchHistory history={searchHistory} onRepeat={record => { setAddSource(record.source); setAddDraft(record.query) }} />
      </> : <form className="search-field unified-search-form" role="search" onSubmit={event => { event.preventDefault(); syncSearchURL(); void search() }}><Search size={17} aria-hidden="true"/><Input autoFocus type="search" aria-label="搜索本机资料库与各平台" placeholder="搜索标题、作者、正文或字幕" value={query} onChange={event => setQuery(event.target.value)} /><Button variant="primary" type="submit" className="button button-primary">搜索</Button></form>}
      {entryMode === 'search' && <div className="unified-search-filters"><label>平台<Select value={platform} onChange={event => { const value = event.target.value; setPlatform(value); syncSearchURL(query, value) }}><option value="">全部平台</option>{Object.entries(labels).filter(([key]) => key !== 'local').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label><label>媒体<Select value={kind} onChange={event => { const value = event.target.value; setKind(value); syncSearchURL(query, platform, value) }}><option value="">全部类型</option><option value="video">视频</option><option value="audio">音频</option><option value="article">文章</option><option value="image">图文</option><option value="pdf">PDF</option></Select></label><label>时间<Select value={time} onChange={event => { const value = event.target.value as TimeFilter; setTime(value); syncSearchURL(query, platform, kind, value) }}><option value="">全部时间</option><option value="day">最近一天</option><option value="week">最近一周</option><option value="month">最近一个月</option></Select></label><div className="segmented" role="group" aria-label="结果显示方式"><Button variant="quiet" type="button" aria-pressed={mode === 'grouped'} onClick={() => { setMode('grouped'); syncSearchURL(query, platform, kind, time, 'grouped') }}>按平台</Button><Button variant="quiet" type="button" aria-pressed={mode === 'mixed'} onClick={() => { setMode('mixed'); syncSearchURL(query, platform, kind, time, 'mixed') }}>混合排序</Button></div></div>}
    </section>
    {error && <div className="error-panel" role="alert">{error}</div>}{result && groups.length === 0 && <section className="empty-state"><h2>没有找到相关内容</h2><p>换个关键词，或粘贴链接导入内容。</p></section>}
    {mode === 'mixed' && result && <section className="unified-search-group"><div className="results-heading"><strong>混合排序</strong><span>{mixed.length} 条去重结果</span></div><CardCollection masonry className="modern-gallery">{mixed.map(card)}</CardCollection></section>}
    {mode === 'grouped' && groups.map(group => <section className="unified-search-group" key={group.key}><div className="results-heading"><strong>{group.title}</strong><span>{group.error || `${group.items.length} 条结果`}</span></div><CardCollection masonry className="modern-gallery">{group.items.slice(0, 8).map(card)}</CardCollection>{result?.sources[group.key]?.page.hasMore && result.sources[group.key].page.cursor && <Button variant="secondary" type="button" className="button button-secondary" onClick={() => void loadMore(group)} disabled={loadingMore.has(group.key)}>{loadingMore.has(group.key) ? '正在加载…' : '查看更多'}</Button>}</section>)}
  </>
}
