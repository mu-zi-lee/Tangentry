import { Button, Dialog, Input } from '../../components/ui'
import { AlertCircle, ArrowLeft, Edit3, LoaderCircle, LogIn, Plus, RefreshCw, SlidersHorizontal, Trash2, TvMinimal, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ContentItem, DiscoveryTopicRule } from '../../shared/api/types'
import { ModernGalleryCard } from '../../shared/ui/ModernGalleryCard'
import { CardCollection } from '../../shared/ui/CardCollection'
import { gallerySources } from './useGallery'
import type { GallerySource, useGallery } from './useGallery'
import './discovery.css'
import { request } from '../../shared/api/client'
import { useRecommendationExposure } from './useRecommendationExposure'
import { SkeletonGallery } from '../../shared/ui/SkeletonLoading'
import { openDesktopPlatformLogin, useCapabilities, type PlatformWebView } from '../../shared/api/desktop'
import { discoveryBottomState, discoveryReasonType, getDiscoverySourceLabel, hasDiscoveryContinuation, readDiscoveryFilterState, updateDiscoveryFilterState, useDiscoveryBatch } from './useDiscoveryBatch'
import { useDiscoveryTopics } from './useDiscoveryTopics'
import { feedbackMessage, type DiscoveryFeedbackTarget, type DiscoveryFeedbackType } from './discoveryFeedback'
import { PaperCard } from '../documents/PaperCard'
import { canPollPlatformVerification } from './discoveryVerification'

const labels: Record<GallerySource | 'huggingface', string> = { subscriptions: '我的订阅', bilibili: 'B站推荐', youtube: 'YouTube 推荐', xiaohongshu: '小红书推荐', linuxdo: 'Linux.do 话题', xiaoyuzhou: '小宇宙发现', douyin: '抖音推荐', huggingface: 'HF 每日论文' }

function DiscoveryTopicsDialog({ topics, error, onSave, onRemove, onClose }: {
  topics: DiscoveryTopicRule[]
  error: string
  onSave: (topic: DiscoveryTopicRule | null, name: string) => Promise<boolean>
  onRemove: (topic: DiscoveryTopicRule) => Promise<boolean>
  onClose: () => void
}) {
  const [editor, setEditor] = useState<{ topic: DiscoveryTopicRule | null } | null>(null)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState('')
  const busy = saving || Boolean(removing)
  const edit = (topic: DiscoveryTopicRule | null) => { setName(topic?.name ?? ''); setEditor({ topic }) }
  const title = editor ? editor.topic ? '编辑主题' : '新增主题' : '管理主题'

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editor || busy || !name.trim()) return
    setSaving(true)
    try { if (await onSave(editor.topic, name.trim())) { setEditor(null); setQuery('') } }
    finally { setSaving(false) }
  }

  return <Dialog open className="discovery-topic-dialog" aria-labelledby="discovery-topic-dialog-title" onClose={onClose}>
    <div className="discovery-topic-dialog-heading">
      {editor && <Button variant="quiet" iconOnly type="button" className="icon-button" aria-label="返回主题列表" title="返回主题列表" disabled={busy} onClick={() => setEditor(null)}><ArrowLeft size={16}/></Button>}
      <h2 id="discovery-topic-dialog-title">{title}</h2>
      <Button variant="quiet" iconOnly type="button" className="icon-button" aria-label="关闭" title="关闭" onClick={onClose}><X size={18} /></Button>
    </div>
    {editor ? <form onSubmit={event => void submit(event)}>
      <label className="discovery-topic-dialog-field" htmlFor="discovery-topic-name">主题名称</label>
      <Input autoFocus id="discovery-topic-name" value={name} maxLength={60} autoComplete="off" onChange={event => setName(event.target.value)} />
      <div className="discovery-topic-dialog-actions">
        <Button variant="secondary" type="button" className="button button-secondary" disabled={busy} onClick={() => setEditor(null)}>取消</Button>
        <Button variant="primary" type="submit" className="button button-primary" disabled={busy || !name.trim()}>{saving && <LoaderCircle size={15} className="spin" />}{saving ? '保存中' : '保存主题'}</Button>
      </div>
    </form> : <>
      <div className="discovery-topic-manager-tools">
        <Input type="search" aria-label="搜索主题" placeholder="搜索主题" value={query} onChange={event => setQuery(event.target.value)}/>
        <Button variant="secondary" type="button" className="button button-secondary" disabled={busy} onClick={() => edit(null)}><Plus size={15}/>新增主题</Button>
      </div>
      <ul className="discovery-topic-manager-list" aria-label="主题列表">
        {topics.filter(topic => topic.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(topic => <li key={topic.id}>
          <span title={topic.name}>{topic.name}</span>
          <Button variant="quiet" iconOnly type="button" className="icon-button" aria-label={`编辑主题 ${topic.name}`} title="编辑主题" disabled={busy} onClick={() => edit(topic)}><Edit3 size={15}/></Button>
          <Button variant="quiet" iconOnly type="button" className="icon-button discovery-topic-remove" aria-label={`删除主题 ${topic.name}`} title="删除主题" disabled={busy} onClick={async () => { setRemoving(topic.id); try { await onRemove(topic) } finally { setRemoving('') } }}>{removing === topic.id ? <LoaderCircle size={15} className="spin"/> : <Trash2 size={15}/>}</Button>
        </li>)}
      </ul>
      {!topics.length && <p className="field-hint">还没有主题</p>}
      {topics.length > 0 && !topics.some(topic => topic.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && <p className="field-hint">没有匹配的主题</p>}
    </>}
    {error && <p className="discovery-topic-dialog-error" role="alert">{error}</p>}
  </Dialog>
}

export function DiscoveryGallery({ active, query, onClearQuery, onQueryChange, notice, noticeError, gallery, savedIDs, pending, savingUnavailable, onSave, onRead, onDownload, onCreator, onSearch, onSubscriptions, onSettings, onBilibili, onRouteChange }: {
  active: boolean
  notice: string; noticeError: boolean
  query: string; onClearQuery: () => void; onQueryChange?: (query: string) => void
  gallery: ReturnType<typeof useGallery>; savedIDs: Set<string>; pending: Set<string>; savingUnavailable: boolean
  onSave: (item: ContentItem) => void; onRead: (item: ContentItem) => void; onDownload: (item: ContentItem) => void; onCreator: (platform: string, authorID: string) => void; onSearch: () => void; onSubscriptions: () => void; onSettings: () => void; onBilibili: () => void; onRouteChange?: (path: string) => void
}) {
  const capabilities = useCapabilities()
  const batchState = useDiscoveryBatch(active)
  const topicState = useDiscoveryTopics(active)
  const sentinel = useRef<HTMLDivElement>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const pollTimer = useRef<number | undefined>(undefined)
  const [platform, setPlatformState] = useState(() => readDiscoveryFilterState().platform)
  const [topic, setTopicState] = useState(() => readDiscoveryFilterState().topic)
  const [webViewPlatform, setWebViewPlatform] = useState<PlatformWebView | ''>('')
  const [webViewError, setWebViewError] = useState('')
  const [managingTopics, setManagingTopics] = useState(false)
  const [feedbackHidden, setFeedbackHidden] = useState(() => new Set<string>())
  const [undoFeedback, setUndoFeedback] = useState<{ id: string; itemID: string; message: string } | null>(null)
  const [feedbackError, setFeedbackError] = useState('')
  const sourceOptions = gallerySources.filter(source => source === 'subscriptions' || gallery.enabled?.[source] !== false)
  const sourceStatus = batchState.batch?.sourceStatus ?? {}
  const selectedEntries = (batchState.batch?.items ?? []).filter(entry => platform === 'all' || entry.source === platform)
  const search = query.trim().toLocaleLowerCase()
  // Discovery is intentionally one mixed stream. Media type is metadata on a
  // card, not a second navigation system competing with sources and topics.
  const items = selectedEntries.filter(({ item, reason }) => !feedbackHidden.has(item.id) && (!search || `${item.title} ${item.author} ${item.description} ${item.previewText || ''} ${item.platform} ${reason}`.toLocaleLowerCase().includes(search)))
  useRecommendationExposure(active, items.map(({ item }) => item.id).join(','), '[data-app-view="discovery"]')
  const loading = batchState.loading
  const errorCount = Object.values(sourceStatus).filter(status => status.status !== 'ok' && status.status !== 'disabled' && status.status !== 'loading').length
  const loadingCount = Object.values(sourceStatus).filter(status => status.status === 'loading').length
  const syncURL = (next: Partial<{ platform: string; topic: string; query: string }>) => {
    const params = new URLSearchParams()
    const values = { platform, topic, query, ...next }
    if (values.platform && values.platform !== 'all') params.set('platform', values.platform)
    if (values.topic) params.set('topic', values.topic)
    if (values.query.trim()) params.set('q', values.query.trim())
    onRouteChange?.(`/${params.toString() ? `?${params}` : ''}`)
  }
  const setPlatform = (value: string) => { setPlatformState(value); updateDiscoveryFilterState({ platform: value }); batchState.setOptions({ source: value === 'all' ? '' : value }); syncURL({ platform: value }) }
  const setTopic = (value: string) => { setTopicState(value); updateDiscoveryFilterState({ topic: value }); batchState.setOptions({ topic: value }); syncURL({ topic: value }) }
  useEffect(() => {
    const sync = () => {
      if (location.pathname !== '/') return
      const params = new URLSearchParams(location.search)
      const nextPlatform = params.get('platform') ?? 'all', nextTopic = params.get('topic') ?? ''
      // Ignore the legacy media-type filter. Existing bookmarks still open the
      // same mixed feed instead of silently hiding most of the content.
      setPlatformState(nextPlatform); setTopicState(nextTopic); onQueryChange?.(params.get('q') ?? ''); updateDiscoveryFilterState({ kind: 'all', platform: nextPlatform, topic: nextTopic })
      const source = nextPlatform === 'all' ? '' : nextPlatform
      if (batchState.options.topic !== nextTopic || batchState.options.source !== source) batchState.setOptions({ topic: nextTopic, source })
    }
    sync(); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync)
  }, [batchState.options.source, batchState.options.topic, batchState.setOptions, onQueryChange])

  useEffect(() => {
    const target = sentinel.current
    if (!active || !target || !hasDiscoveryContinuation(batchState.batch)) return
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) batchState.nextBatch() }, { rootMargin: '720px 0px' })
    observer.observe(target)
    // Refresh can leave the sentinel in the same viewport position. Do not
    // depend on a leave/re-enter event to discover the new continuation.
    const rect = target.getBoundingClientRect()
    if (rect.bottom >= -720 && rect.top <= window.innerHeight + 720) batchState.nextBatch()
    return () => observer.disconnect()
  }, [active, batchState.batch, batchState.nextBatch])

  useEffect(() => () => {
    if (pollTimer.current !== undefined) window.clearTimeout(pollTimer.current)
  }, [])
  useEffect(() => {
    if (active) return
    if (pollTimer.current !== undefined) window.clearTimeout(pollTimer.current)
    pollTimer.current = undefined
    setWebViewPlatform('')
  }, [active])

  async function verifyPlatform(source: PlatformWebView) {
    if (webViewPlatform) return
    setWebViewPlatform(source); setWebViewError('')
    try {
      const before = await request<{ platforms: Array<{ platform: string; configured: boolean; updatedAt: number }> }>('/settings/cookies')
      const previous = before.platforms.find(value => value.platform === source)
      await openDesktopPlatformLogin(source)
      let attempts = 0
      const poll = async () => {
        if (!canPollPlatformVerification(activeRef.current, attempts)) { setWebViewPlatform(''); return }
        attempts++
        try {
          const result = await request<{ platforms: Array<{ platform: string; configured: boolean; updatedAt: number }> }>('/settings/cookies')
          const state = result.platforms.find(value => value.platform === source)
          if (!activeRef.current) return
          if (state?.configured && (!previous?.configured || state.updatedAt > (previous.updatedAt ?? 0))) { setWebViewPlatform(''); batchState.retry(); return }
        } catch { /* The native window may still be completing its challenge. */ }
        if (activeRef.current) pollTimer.current = window.setTimeout(() => void poll(), 1500)
      }
      pollTimer.current = window.setTimeout(() => void poll(), 1500)
    } catch (cause) { setWebViewError(cause instanceof Error ? cause.message : '无法打开应用内登录窗口。'); setWebViewPlatform('') }
  }

  const saveTopic = (existing: DiscoveryTopicRule | null, name: string) => existing
    ? topicState.update(existing, name)
    : topicState.create(name)
  const removeTopic = async (existing: DiscoveryTopicRule) => {
    const removed = await topicState.remove(existing)
    if (removed && topic === existing.id) setTopic('')
    return removed
  }
  const openRecommendation = (item: ContentItem) => {
    if (['bilibili', 'youtube', 'xiaohongshu', 'linuxdo', 'xiaoyuzhou', 'douyin', 'huggingface'].includes(item.platform)) void request(`/recommendations/${item.platform}/marks`, { method: 'PUT', keepalive: true, body: JSON.stringify({ contentId: item.id, opened: true }) }).catch(() => {})
    onRead(item)
  }
  async function sendFeedback(type: DiscoveryFeedbackType, target: DiscoveryFeedbackTarget, value: string, item: ContentItem) {
    try {
      setFeedbackError('')
      const saved = await request<{ id: string }>('/discovery/feedback', { method: 'POST', body: JSON.stringify({ type, target, value }) })
      if (type === 'hide') setFeedbackHidden(current => new Set(current).add(item.id))
      if (type === 'block_creator') setFeedbackHidden(current => new Set([...current, ...selectedEntries.filter(entry => (entry.item.authorId || entry.item.author) === value).map(entry => entry.item.id)]))
      setUndoFeedback({ id: saved.id, itemID: item.id, message: feedbackMessage(type) })
      if (type === 'more' || type === 'less' || type === 'block_creator') batchState.retry()
    } catch (cause) { setFeedbackError(cause instanceof Error ? cause.message : '发现反馈未能保存，请重试。') }
  }
  async function undoFeedbackAction() {
    if (!undoFeedback) return
    const current = undoFeedback
    try {
      await request(`/discovery/feedback/${encodeURIComponent(current.id)}`, { method: 'DELETE' })
      setFeedbackHidden(previous => { const next = new Set(previous); next.delete(current.itemID); return next })
      setUndoFeedback(null)
      batchState.retry()
    } catch (cause) { setFeedbackError(cause instanceof Error ? cause.message : '撤销失败，请到设置中重试。') }
  }

  return <>
    <div className="discovery-toolbar discovery-home-toolbar">
      <div className="discovery-heading"><h1>发现</h1></div>
      <div className="discovery-toolbar-actions">
        <span className="content-count">{items.length} 条内容</span>
        <Button variant="quiet" iconOnly type="button" className="icon-button" aria-label="管理主题" title="管理主题" onClick={() => setManagingTopics(true)}><SlidersHorizontal size={18}/></Button>
        {(errorCount > 0 || loadingCount > 0) && <details className="gallery-errors-summary"><summary aria-label={`${errorCount} 个来源异常${loadingCount ? `，${loadingCount} 个来源加载中` : ''}`} title="来源状态"><AlertCircle size={14} /><span>{errorCount > 0 ? `${errorCount} 个来源异常` : `${loadingCount} 个来源加载中`}</span></summary><div className="gallery-errors-popover">{Object.entries(sourceStatus).filter(([, status]) => status.status !== 'ok' && status.status !== 'disabled').map(([source, status]) => <div key={source}><strong>{labels[source as GallerySource] ?? source}</strong><p role={status.status === 'loading' ? 'status' : 'alert'}>{status.message || (status.status === 'loading' ? '正在加载，继续下滑后会补充此来源。' : status.status === 'unavailable' ? '来源暂不可用，已保留其他来源内容。' : '来源获取失败，已保留其他来源内容。')}</p>{capabilities.platformWebViewLogin && status.requiresVerification && (source === 'linuxdo' || source === 'douyin') && <Button variant="quiet" className="text-button" disabled={Boolean(webViewPlatform)} onClick={() => void verifyPlatform(source as PlatformWebView)}>{webViewPlatform === source ? <LoaderCircle size={14} className="spin" /> : <LogIn size={14} />}{webViewPlatform === source ? '正在打开' : '重新验证'}</Button>}</div>)}{webViewError && <p className="gallery-errors-feedback" role="alert">{webViewError}</p>}<a className="text-button gallery-health-link" href="/subscriptions#health">管理来源健康</a></div></details>}
        <Button variant="quiet" iconOnly type="button" className="icon-button" aria-label="打开B站专区" title="打开B站专区" onClick={onBilibili}><TvMinimal size={18} /></Button>
        <Button variant="quiet" iconOnly type="button" className="icon-button" aria-label="刷新发现内容" title="刷新发现内容" disabled={loading} onClick={batchState.retry}>{loading ? <LoaderCircle size={18} className="spin" /> : <RefreshCw size={18} />}</Button>
      </div>
      <div className="discovery-filter-rail" role="group" aria-label="发现内容来源与主题" tabIndex={0}>
        <div className="discovery-platforms" role="group" aria-label="内容来源"><Button variant="quiet" type="button" aria-pressed={platform === 'all'} onClick={() => setPlatform('all')}>全部</Button>{sourceOptions.map(source => <Button variant="quiet" key={source} type="button" data-platform={source} aria-pressed={platform === source} onClick={() => setPlatform(platform === source ? 'all' : source)}><span className="platform-dot" aria-hidden="true" />{labels[source]}</Button>)}</div>
        <div className="discovery-topics" role="group" aria-label="主题筛选"><Button variant="quiet" type="button" aria-pressed={!topic} onClick={() => setTopic('')}>全部主题</Button>{topicState.topics.map(value => <Button variant="quiet" type="button" key={value.id} aria-pressed={topic === value.id} onClick={() => setTopic(value.id)}>{value.name}</Button>)}</div>
      </div>
    </div>
    {managingTopics && <DiscoveryTopicsDialog topics={topicState.topics} error={topicState.error} onSave={saveTopic} onRemove={removeTopic} onClose={() => setManagingTopics(false)} />}
    {topicState.error && !managingTopics && <p className="inline-feedback" role="alert">{topicState.error}<Button variant="quiet" type="button" className="text-button" onClick={() => void topicState.reload()}>重试</Button></p>}
    {batchState.optionsStale && <p className="discovery-new-content" role="status">有新内容，点击刷新<Button variant="quiet" type="button" className="text-button" onClick={batchState.retry}>刷新</Button></p>}
    {undoFeedback && <p className="inline-feedback collection-save-feedback" role="status">{undoFeedback.message}<Button variant="quiet" type="button" className="text-button" onClick={() => void undoFeedbackAction()}>撤销</Button></p>}
    {feedbackError && <p className="inline-feedback" role="alert">{feedbackError}</p>}
    {notice && <p className="inline-feedback collection-save-feedback" role={noticeError ? 'alert' : 'status'}>{notice}</p>}
    {savingUnavailable && <p className="field-hint" role="status">资料库暂不可用，收藏操作等待重新连接。</p>}
    {search && <p className="discovery-search-result" role="status">当前已加载内容中找到 {items.length} 条结果<Button variant="quiet" type="button" className="text-button" onClick={onClearQuery}>清除搜索</Button></p>}
    {items.length > 0 ? <CardCollection masonry rowGap={20} data-media="all" className="mixed-gallery" aria-label="发现内容">{items.map(({ item, source, reason, carriedOver }) => item.paper ? <PaperCard key={item.id} item={item} saved={savedIDs.has(item.id)} pending={savingUnavailable || pending.has(item.id)} onRead={openRecommendation} onSave={onSave} /> : <ModernGalleryCard discovery key={item.id} item={item} origin={getDiscoverySourceLabel(source, reason, carriedOver)} discoveryReason={reason} discoveryType={discoveryReasonType(source, reason, carriedOver)} saved={savedIDs.has(item.id)} pending={savingUnavailable || pending.has(item.id)} onRead={openRecommendation} onSave={onSave} onCreator={item.authorId ? value => onCreator(value.platform, value.authorId) : undefined} onDownload={onDownload} onFeedback={(type, target, value) => void sendFeedback(type, target, value, item)} />)}</CardCollection> : loading ? <SkeletonGallery count={8} /> : search ? <section className="empty-state"><h2>没有找到匹配的内容</h2><p>试试其他关键词，或清除搜索查看当前内容。</p><Button variant="secondary" type="button" className="button button-secondary" onClick={onClearQuery}>查看全部内容</Button></section> : <section className="empty-state"><h2>还没有可浏览的推荐</h2><p>添加链接开始阅读，或连接平台和订阅来获取个性化内容。</p><div className="empty-state-actions"><Button variant="primary" className="button button-primary" onClick={onSearch}>添加内容</Button><Button variant="secondary" className="button button-secondary" onClick={onSettings}>连接平台</Button><Button variant="quiet" className="text-button" onClick={onSubscriptions}>管理订阅</Button></div></section>}
    <div ref={sentinel} className="gallery-load-more discovery-feed-status" aria-live="polite">{(() => {
      const state = discoveryBottomState(batchState.error, loading, batchState.batch, items.length)
      if (state.kind === 'error') return <><span role="alert">{state.message}</span><Button variant="secondary" className="button button-secondary" onClick={batchState.retry}><RefreshCw size={15} />重试</Button></>
      if (state.kind === 'loading') return <><LoaderCircle size={15} className="spin" />正在加载更多…</>
      if (state.kind === 'more') return <span>继续下滑加载更多</span>
      if (state.kind === 'filtered') return <span>{state.message}</span>
      if (state.kind === 'ended') return <><span>{state.message}</span><Button variant="secondary" className="button button-secondary" onClick={batchState.retry}><RefreshCw size={15} />刷新</Button></>
      return null
    })()}</div>
  </>
}
