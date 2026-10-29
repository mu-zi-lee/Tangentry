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
type SearchOverrides = { platform?: string; kind?: string; time?: TimeFilter }
type Props = { initialQuery?: string; routeSearch?: string; savedIDs: Set<string>; pending: Set<string>; onRead: (item: ContentItem) => void; onSave: (item: ContentItem) => void; onCreator: (platform: string, authorID: string) => void; onReturnCreator?: () => void; onReturnCreatorLabel?: string; onRouteChange?: (path: string) => void; onSubscribe: (platform: string, authorID: string) => void }

const addResultStorageKey = 'tangentry.search.add-result'

function readStoredAddResult(): { result: UnifiedSearchResponse; source: string } | null {
  try {
    const raw = sessionStorage.getItem(addResultStorageKey)
    if (!raw) return null
    const value = JSON.parse(raw) as { result?: UnifiedSearchResponse; source?: string }
    return value.result && typeof value.source === 'string' ? { result: value.result, source: value.source } : null
  } catch { return null }
}

function storeAddResult(result: UnifiedSearchResponse, source: string) {
  try { sessionStorage.setItem(addResultStorageKey, JSON.stringify({ result, source })) } catch { /* Cache is only a return-path convenience. */ }
}

function clearStoredAddResult() {
  try { sessionStorage.removeItem(addResultStorageKey) } catch { /* Storage may be unavailable in private browsing. */ }
}

function timeBounds(value: TimeFilter): { from?: number; to?: number } {
  if (!value) return {}
  const to = Math.floor(Date.now() / 1000)
  return { from: to - (value === 'day' ? 86400 : value === 'week' ? 7 * 86400 : 30 * 86400), to }
}

function searchPageFromFeed(feed: Feed, platform: string): SearchPage {
  return {
    ...feed,
    items: appendSearchItems([], feed.items),
    platform,
    // The legacy discovery endpoint paginates B站 creator feeds by page
    // number. Keep that detail opaque to the rest of the search UI.
    cursor: platform === 'bilibili' && feed.hasMore ? String(feed.page + 1) : undefined,
  }
}

export function UnifiedSearchPage({ initialQuery = '', routeSearch = location.search, savedIDs, pending, onRead, onSave, onCreator, onReturnCreator, onReturnCreatorLabel = '返回搜索', onRouteChange, onSubscribe }: Props) {
  const initialParams = new URLSearchParams(routeSearch)
  const initialCachedAdd = (() => {
    const addQuery = initialParams.get('addQuery')
    const source = initialParams.get('source')
    const cached = addQuery && source ? readStoredAddResult() : null
    return cached && cached.result.query === addQuery && cached.source === source ? cached : null
  })()
  const [query, setQuery] = useState(initialQuery)
  const [platform, setPlatform] = useState(initialParams.get('platform') ?? '')
  const [kind, setKind] = useState(initialParams.get('kind') ?? '')
  const [time, setTime] = useState<TimeFilter>((initialParams.get('time') as TimeFilter) || '')
  const [mode, setMode] = useState<SearchMode>(initialParams.get('mode') === 'mixed' ? 'mixed' : 'grouped')
  const [listQuery, setListQuery] = useState(initialParams.get('list') ?? '')
  const [entryMode, setEntryMode] = useState<'add' | 'search'>(() => searchEntryMode(routeSearch))
  const [addSource, setAddSource] = useState<DiscoverySource>(() => detectSource(initialQuery) ?? 'bilibili')
  const [addDraft, setAddDraft] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')
  const addInput = useRef<HTMLInputElement | null>(null)
  const searchHistory = useSearchHistory()
  const [result, setResult] = useState<UnifiedSearchResponse | null>(initialCachedAdd?.result ?? null)
  const [loadingMore, setLoadingMore] = useState<Set<string>>(new Set())
  const routeParams = new URLSearchParams(routeSearch)
  const creator = routeParams.get('creator')
  const creatorPlatform = routeParams.get('creatorPlatform')
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const directFeed = useRef<{ source: string; query: string } | null>(initialCachedAdd ? { source: initialCachedAdd.source, query: initialCachedAdd.result.query } : null)
  const retryAction = useRef<(() => void) | null>(null)
  const lastSearchKey = useRef<string | null>(null)
  const groups = useMemo(() => result ? groupSearchResults(result, labels) : [], [result])
  const visibleGroups = useMemo(() => {
    const needle = entryMode === 'add' ? listQuery.trim().toLocaleLowerCase() : ''
    if (!needle) return groups
    return groups.map(group => ({
      ...group,
      items: group.items.filter(item => [item.title, item.author, item.description].join(' ').toLocaleLowerCase().includes(needle)),
    })).filter(group => group.items.length > 0 || group.error || result?.sources[group.key]?.page.hasMore)
  }, [entryMode, groups, listQuery, result])
  const mixed = useMemo(() => mergeSearchItems(visibleGroups), [visibleGroups])
  function syncStateFromURL() {
    const params = new URLSearchParams(routeSearch)
    setQuery(params.get('q') ?? '')
    setPlatform(params.get('platform') ?? '')
    setKind(params.get('kind') ?? '')
    setTime((params.get('time') as TimeFilter) || '')
    setMode(params.get('mode') === 'mixed' ? 'mixed' : 'grouped')
    setEntryMode(searchEntryMode(routeSearch))
    setListQuery(params.get('list') ?? '')
    const addQuery = params.get('addQuery') ?? ''
    const source = params.get('source')
    if (searchEntryMode(routeSearch) === 'add' && addQuery) {
      setAddDraft(addQuery)
      if (source && ['bilibili', 'youtube', 'douyin', 'xiaohongshu', 'rss', 'xiaoyuzhou', 'pdf', 'paper'].includes(source)) setAddSource(source as DiscoverySource)
    }
    if (searchEntryMode(routeSearch) === 'search') directFeed.current = null
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

  function syncAddListQuery(value: string) {
    setListQuery(value)
    const params = new URLSearchParams(routeSearch)
    params.set('entry', 'add')
    params.delete('q')
    if (value.trim()) params.set('list', value.trim())
    else params.delete('list')
    onRouteChange?.(`/search?${params}`)
  }

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    syncStateFromURL()
    const params = new URLSearchParams(routeSearch)
    const value = params.get('q')?.trim() ?? ''
    if (searchEntryMode(routeSearch) === 'add' && !result && params.get('addQuery')) {
      const cached = readStoredAddResult()
      if (cached && cached.result.query === params.get('addQuery') && cached.source === params.get('source')) {
        directFeed.current = { source: cached.source, query: cached.result.query }
        setResult(cached.result)
      }
    }
    const searchKey = JSON.stringify([value, params.get('platform') ?? '', params.get('kind') ?? '', params.get('time') ?? ''])
    const requestWasAborted = controller.current?.signal.aborted ?? false
    if ((searchKey !== lastSearchKey.current || requestWasAborted) && searchEntryMode(routeSearch) === 'search' && value && !params.get('creator')) {
      lastSearchKey.current = searchKey
      void search(value, { platform: params.get('platform') ?? '', kind: params.get('kind') ?? '', time: (params.get('time') as TimeFilter) || '' })
    } else if (searchKey !== lastSearchKey.current) {
      lastSearchKey.current = searchKey
    }
  }, [routeSearch])
  useEffect(() => { setEntryMode(searchEntryMode(routeSearch)) }, [routeSearch])

  async function search(nextQuery = query, overrides: SearchOverrides = {}) {
    const value = nextQuery.trim()
    if (!value) return
    retryAction.current = () => { void search(value, overrides) }
    directFeed.current = null
    controller.current?.abort()
    const next = new AbortController(); controller.current = next; setError('')
    try {
      const linkSource = value.match(/bilibili\.com|b23\.tv|youtube\.com|youtu\.be|linux\.do|xiaoyuzhoufm\.com|xiaohongshu\.com|xhslink\.com|douyin\.com/i)
      if (linkSource) {
        const source = /bilibili|b23\.tv/i.test(value) ? 'bilibili' : /youtube|youtu\.be/i.test(value) ? 'youtube' : /linux\.do/i.test(value) ? 'linuxdo' : /xiaoyuzhou/i.test(value) ? 'xiaoyuzhou' : /xiaohongshu|xhslink/i.test(value) ? 'xiaohongshu' : 'douyin'
        const feed = await request<Feed>(`/discovery/${source}?q=${encodeURIComponent(value)}&page=1`, { signal: next.signal })
        directFeed.current = { source, query: value }
        setResult({ query: value, local: { items: [], total: 0, counts: {} }, sources: { [source]: { page: searchPageFromFeed(feed, source) } }, link: feed }); return
      }
      const activePlatform = overrides.platform ?? platform
      const activeKind = overrides.kind ?? kind
      const activeTime = overrides.time ?? time
      const bounds = timeBounds(activeTime)
      const params = buildSearchParams(value, { platform: activePlatform, kind: activeKind, ...bounds })
      setResult(await request<UnifiedSearchResponse>(`/search?${params}`, { signal: next.signal }))
    } catch (cause) { if (!next.signal.aborted) setError(cause instanceof Error ? cause.message : '搜索未能完成。') }
  }

  function selectEntryMode(next: 'add' | 'search') {
    setEntryMode(next)
    setResult(null)
    setError('')
    setAddError('')
    retryAction.current = null
    const params = new URLSearchParams(location.search)
    if (next === 'add') {
      params.set('entry', 'add')
      params.delete('q')
      params.delete('source')
      params.delete('addQuery')
      params.delete('platform')
      params.delete('kind')
      params.delete('time')
      params.delete('mode')
      params.delete('list')
      setListQuery('')
      clearStoredAddResult()
    } else {
      params.set('entry', 'search')
      params.delete('list')
      clearStoredAddResult()
    }
    params.delete('creator')
    params.delete('creatorPlatform')
    directFeed.current = null
    onRouteChange?.(`/search${params.toString() ? `?${params}` : ''}`)
  }

  async function addContent() {
    const value = addDraft.trim()
    if (!value || addLoading) return
    setAddLoading(true)
    setAddError('')
    setResult(null)
    setListQuery('')
    retryAction.current = null
    directFeed.current = null
    clearStoredAddResult()
    const nextParams = new URLSearchParams(routeSearch)
    nextParams.set('entry', 'add')
    nextParams.set('source', addSource)
    nextParams.set('addQuery', value)
    nextParams.delete('list')
    onRouteChange?.(`/search?${nextParams}`)
    searchHistory.add(value, addSource)
    try {
      if (addSource === 'paper') {
        const item = await request<ContentItem>('/papers/import', { method: 'POST', body: JSON.stringify({ query: value }) })
        onRead(item)
        return
      }
      const feed = await request<Feed>(`/discovery/${addSource}?q=${encodeURIComponent(value)}&page=1`)
      directFeed.current = { source: addSource, query: value }
      const nextResult = { query: value, local: { items: [], total: 0, counts: {} }, sources: { [addSource]: { page: searchPageFromFeed(feed, addSource) } }, link: feed }
      storeAddResult(nextResult, addSource)
      setResult(nextResult)
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
    setError('')
    try {
      const direct = directFeed.current
      if (direct && direct.source === group.key && direct.query === result.query) {
        retryAction.current = () => { void loadMore(group) }
        const feed = await request<Feed>(`/discovery/${group.key}?q=${encodeURIComponent(result.query)}&page=${encodeURIComponent(cursor)}`)
        const incoming = searchPageFromFeed(feed, group.key)
        setResult(current => {
          if (!current) return current
          const previous = current.sources[group.key]?.page
          const merged: SearchPage = { ...incoming, items: appendSearchItems(previous?.items ?? [], incoming.items) }
          const nextResult = { ...current, link: feed, sources: { ...current.sources, [group.key]: { page: merged } } }
          storeAddResult(nextResult, group.key)
          return nextResult
        })
        return
      }
      const bounds = timeBounds(time)
      retryAction.current = () => { void loadMore(group) }
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
    setError('')
    retryAction.current = () => { void loadCreatorMore() }
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
    if (entryMode !== 'search' || !creator || !creatorPlatform) return
    if (!creatorPlatformSupport(creatorPlatform).view) { setError(`${labels[creatorPlatform] ?? creatorPlatform} 暂时不支持创作者临时视图。`); return }
    const next = new AbortController(); controller.current = next
    retryAction.current = null
    request<SearchPage>(`/search/creator/${creatorPlatform}/${encodeURIComponent(creator)}`, { signal: next.signal }).then(feed => {
      setError('')
      setResult({ query: creator, local: { items: [], total: 0, counts: {} }, sources: { [creatorPlatform]: { page: feed } } })
    }).catch(cause => {
      if (next.signal.aborted) return
      const message = cause instanceof Error ? cause.message : '暂时无法读取创作者内容。'
      setError(message)
      retryAction.current = () => {
        const retry = new AbortController()
        controller.current?.abort()
        controller.current = retry
        setError('')
        request<SearchPage>(`/search/creator/${creatorPlatform}/${encodeURIComponent(creator)}`, { signal: retry.signal }).then(feed => {
          setError('')
          setResult({ query: creator, local: { items: [], total: 0, counts: {} }, sources: { [creatorPlatform]: { page: feed } } })
        }).catch(retryCause => {
          if (!retry.signal.aborted) setError(retryCause instanceof Error ? retryCause.message : '暂时无法读取创作者内容。')
        })
      }
    })
    return () => next.abort()
  }, [creator, creatorPlatform, entryMode])

  function card(item: ContentItem) { return <ModernGalleryCard item={item} saved={savedIDs.has(item.id)} pending={pending.has(item.id)} onRead={onRead} onSave={onSave} onCreator={item.authorId ? value => onCreator(value.platform, value.authorId) : undefined} /> }

  if (entryMode === 'search' && creator && creatorPlatform) {
    const support = creatorPlatformSupport(creatorPlatform)
    return <section className="creator-temporary-view"><Button variant="secondary" type="button" className="button button-secondary" onClick={() => onReturnCreator?.()}><ArrowLeft size={16}/>{onReturnCreatorLabel}</Button><div className="results-heading"><div><strong>{labels[creatorPlatform] ?? creatorPlatform} 创作者最近内容</strong>{!support.subscribe && <p className="field-hint">该平台暂不支持一键订阅；这是一次性的临时查看，不会写入订阅或推荐偏好。</p>}</div>{support.subscribe && <Button variant="primary" type="button" className="button button-primary" onClick={() => onSubscribe(creatorPlatform, creator)}>订阅</Button>}</div>{error && <div className="error-panel" role="alert">{error}</div>}{groups.map(group => <div key={group.key}><CardCollection masonry className="modern-gallery">{group.items.map(card)}</CardCollection>{result?.sources[group.key]?.page.hasMore && result.sources[group.key].page.cursor && <Button variant="secondary" type="button" className="button button-secondary" onClick={() => void loadCreatorMore()} disabled={loadingMore.has(group.key)}>{loadingMore.has(group.key) ? '正在加载…' : '查看更多'}</Button>}</div>)}</section>
  }

  return <>
    <section className="unified-search-head">
      <div className="unified-search-title-row"><div><h1>{entryMode === 'add' ? '添加内容' : '统一搜索'}</h1><p>{entryMode === 'add' ? '粘贴链接、ID 或订阅地址，识别后直接进入阅读。' : '在本机资料库与已启用的平台中查找内容。'}</p></div><div className="segmented" role="group" aria-label="内容入口"><Button variant="quiet" type="button" aria-pressed={entryMode === 'add'} onClick={() => selectEntryMode('add')}><Link2 size={14}/>添加内容</Button><Button variant="quiet" type="button" aria-pressed={entryMode === 'search'} onClick={() => selectEntryMode('search')}><Search size={14}/>搜索内容</Button></div></div>
      {entryMode === 'add' ? <>
        <SourceComposer source={addSource} onSource={source => { setAddSource(source); setAddError('') }} draft={addDraft} onDraft={setAddDraft} loading={addLoading} input={addInput} onSubmit={() => void addContent()} onImported={onRead} />
        {addError && <div className="error-panel" role="alert"><strong>添加失败</strong><p>{addError}</p><Button variant="secondary" type="button" className="button button-secondary" onClick={() => void addContent()} disabled={addLoading}>重试</Button></div>}
      </> : <form className="search-field unified-search-form" role="search" onSubmit={event => { event.preventDefault(); const value = query.trim(); const currentQuery = new URLSearchParams(routeSearch).get('q') ?? ''; syncSearchURL(); if (!onRouteChange || value === currentQuery) void search(value) }}><Search size={17} aria-hidden="true"/><Input autoFocus type="search" aria-label="搜索本机资料库与各平台" placeholder="搜索标题、作者、正文或字幕" value={query} onChange={event => setQuery(event.target.value)} /><Button variant="primary" type="submit" className="button button-primary">搜索</Button></form>}
      {entryMode === 'search' && <div className="unified-search-filters"><label><span>平台</span><Select value={platform} onChange={event => { const value = event.target.value; setPlatform(value); syncSearchURL(query, value) }}><option value="">全部平台</option>{Object.entries(labels).filter(([key]) => key !== 'local').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label><label><span>媒体</span><Select value={kind} onChange={event => { const value = event.target.value; setKind(value); syncSearchURL(query, platform, value) }}><option value="">全部类型</option><option value="video">视频</option><option value="audio">音频</option><option value="article">文章</option><option value="image">图文</option><option value="pdf">PDF</option></Select></label><label><span>时间</span><Select value={time} onChange={event => { const value = event.target.value as TimeFilter; setTime(value); syncSearchURL(query, platform, kind, value) }}><option value="">全部时间</option><option value="day">最近一天</option><option value="week">最近一周</option><option value="month">最近一个月</option></Select></label><div className="segmented" role="group" aria-label="结果显示方式"><Button variant="quiet" type="button" aria-pressed={mode === 'grouped'} onClick={() => { setMode('grouped'); syncSearchURL(query, platform, kind, time, 'grouped') }}>按平台</Button><Button variant="quiet" type="button" aria-pressed={mode === 'mixed'} onClick={() => { setMode('mixed'); syncSearchURL(query, platform, kind, time, 'mixed') }}>混合排序</Button></div></div>}
    </section>
    {error && <div className="error-panel" role="alert"><p>{error}</p>{retryAction.current && <Button variant="secondary" type="button" className="button button-secondary" onClick={() => retryAction.current?.()}>重试</Button>}</div>}{result && visibleGroups.length === 0 && <section className="empty-state"><h2>{listQuery.trim() ? '当前列表没有匹配内容' : '没有找到相关内容'}</h2><p>{listQuery.trim() ? '换个标题、作者或正文关键词。' : '换个关键词，或粘贴链接导入内容。'}</p></section>}
    {entryMode === 'add' && result && <label className="progress-collection-search add-result-search"><Search size={15} aria-hidden="true"/><Input type="search" aria-label="搜索当前列表" placeholder="筛选已加载的标题、作者或正文" value={listQuery} onChange={event => syncAddListQuery(event.target.value)}/></label>}
    {mode === 'mixed' && result && <section className="unified-search-group"><div className="results-heading"><strong>混合排序</strong><span>{mixed.length} 条去重结果</span></div><CardCollection masonry className="modern-gallery">{mixed.map(card)}</CardCollection></section>}
    {mode === 'grouped' && visibleGroups.map(group => <section className="unified-search-group" key={group.key}><div className="results-heading"><strong>{group.title}</strong><span>{group.error || `${group.items.length} 条结果`}</span></div><CardCollection masonry className="modern-gallery">{(directFeed.current?.source === group.key ? group.items : group.items.slice(0, 8)).map(card)}</CardCollection>{result?.sources[group.key]?.page.hasMore && result.sources[group.key].page.cursor && <Button variant="secondary" type="button" className="button button-secondary" onClick={() => void loadMore(group)} disabled={loadingMore.has(group.key)}>{loadingMore.has(group.key) ? '正在加载…' : directFeed.current?.source === group.key ? '继续浏览' : '查看更多'}</Button>}</section>)}
    {entryMode === 'add' && <SearchHistory history={searchHistory} onRepeat={record => { setAddSource(record.source); setAddDraft(record.query) }} />}
  </>
}
