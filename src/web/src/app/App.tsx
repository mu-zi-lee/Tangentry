import { Button, Select } from '../components/ui'
import { AlertCircle, ArrowRight, Bookmark, Check, Compass, Grid2X2, List, Plus } from 'lucide-react'
import { Activity, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { ReaderActionsProvider } from '../shared/reader/ReaderActions'
import { DiscoveryGallery } from '../features/discovery/DiscoveryGallery'
import { readDiscoveryFilterState } from '../features/discovery/useDiscoveryBatch'
import { bilibiliReturnPath as normalizeBilibiliReturnPath, useBilibiliBrowse } from '../features/bilibili/useBilibiliBrowse'
import { gallerySources, useGallery } from '../features/discovery/useGallery'
import type { GallerySource } from '../features/discovery/useGallery'
import { usePodcastEpisodes } from '../features/podcasts/usePodcastEpisodes'
import { FavoriteFolder, FavoriteSetup, LibrarySources } from '../features/favorites/FavoriteSyncPanel'
import type { LibrarySource } from '../features/favorites/FavoriteSyncPanel'
import { useFavoriteSync } from '../features/favorites/useFavoriteSync'
import { PageHeader } from '../shared/ui/PageHeader'
import { useViewingHistory } from '../features/history/useViewingHistory'
import { ViewingHistoryPage } from '../features/history/ViewingHistoryPage'
import { UnifiedSearchPage } from '../features/search/UnifiedSearchPage'
import { ModernGalleryCard } from '../shared/ui/ModernGalleryCard'
import { PaperCard } from '../features/documents/PaperCard'
import { SkeletonGallery } from '../shared/ui/SkeletonLoading'
import { useFeed } from '../features/discovery/useFeed'
import { useLibrary } from '../features/library/useLibrary'
import { useGlobalNotes } from '../features/notes/useGlobalNotes'
import { supportsProgress, useProgressOverview } from '../features/progress/useProgressOverview'
import { CardProgress, ProgressOverviewControls } from '../features/progress/ProgressOverview'
import { useDownloads } from '../features/downloads/useDownloads'
import { useReadState, supportsReadState } from '../features/readstate/useReadState'
import { useSubscriptionInbox } from '../features/subscriptions/useSubscriptionInbox'
import type { InboxFilters } from '../features/subscriptions/useSubscriptionInbox'
import { useSavedViews } from '../features/subscriptions/useSavedViews'
import { useSubscriptions } from '../features/subscriptions/useSubscriptions'
import type { ContentItem, DownloadJob, ReadingNote } from '../shared/api/types'
import { ContentCard } from '../shared/ui/ContentCard'
import { CardCollection } from '../shared/ui/CardCollection'
import { ExperienceShell } from './ExperienceShell'
import { MediaFilters } from '../shared/ui/MediaFilters'
import { appPageLayers, creatorReturnFromPath, readerPath, readerPathForItem } from './navigation'
import { BackToTop } from '../shared/ui/BackToTop'
import { Toast } from '../shared/ui/Toast'
import { useToast } from '../shared/hooks/useToast'
import { useGalleryLayout } from '../features/settings/useGalleryLayout'
import { useCardAppearance } from '../features/settings/useCardAppearance'
import { useFontSettings } from '../features/settings/useFontSettings'
import { PageLoadBoundary } from './PageLoadBoundary'
import { BrandMark } from '../shared/ui/BrandMark'
import { AppReaderActions } from './AppReaderActions'
import { RestoreViewport, selectedSavedViewFromURL, useAppNavigation } from './useAppNavigation'
import { useCollectionView } from './useCollectionView'
import type { ContentView } from './useCollectionView'
import { UpdaterNotice } from '../features/settings/UpdaterNotice'

const podcastSources: readonly GallerySource[] = ['xiaoyuzhou']
const kindNames: Record<string, string> = { video: '视频', article: '图文', image: '短图文', audio: '音频', pdf: 'PDF' }

const GlobalNotesPage = lazy(() => import('../features/notes/GlobalNotesPage').then(module => ({ default: module.GlobalNotesPage })))
const DownloadsPage = lazy(() => import('../features/downloads/DownloadsPage').then(module => ({ default: module.DownloadsPage })))
const ToolsPage = lazy(() => import('../features/settings/ToolsPage').then(module => ({ default: module.ToolsPage })))
const ContentReadingWorkspace = lazy(() => import('./ContentReadingWorkspace').then(module => ({ default: module.ContentReadingWorkspace })))
const YouTubeReadingWorkspace = lazy(() => import('./YouTubeReadingWorkspace').then(module => ({ default: module.YouTubeReadingWorkspace })))
const ReadingWorkspace = lazy(() => import('./ReadingWorkspace').then(module => ({ default: module.ReadingWorkspace })))
const SubscriptionsPage = lazy(() => import('../features/subscriptions/SubscriptionsPage').then(module => ({ default: module.SubscriptionsPage })))
const PodcastsPage = lazy(() => import('../features/podcasts/PodcastsPage').then(module => ({ default: module.PodcastsPage })))
const BilibiliPage = lazy(() => import('../features/bilibili/BilibiliPage').then(module => ({ default: module.BilibiliPage })))

export function App() {
  const galleryLayout = useGalleryLayout()
  useCardAppearance()
  useFontSettings()
  const discovery = useFeed()
  const library = useLibrary()
  const viewingHistory = useViewingHistory()
  const downloads = useDownloads()
  const input = useRef<HTMLInputElement>(null)
  const navigation = useAppNavigation(input)
  const { view, navigate, returnHome, readerQuery, readerNoteId, readingItem, setReadingItem, readerSourceID, scrollPositions, viewportTarget, viewportVersion, setReaderReturn, returnFromReader, returnToPath } = navigation
  const [discoveryMounted, setDiscoveryMounted] = useState(() => view === 'discovery')
  const pageLayers = appPageLayers(view, discoveryMounted)
  useEffect(() => {
    if (view === 'discovery') setDiscoveryMounted(true)
  }, [view])
  const bilibili = useBilibiliBrowse(view === 'bilibili', path => navigate('bilibili', false, path))
  const subscriptions = useSubscriptions(view === 'subscriptions')
  const [subscriptionView, setSubscriptionView] = useState(() => selectedSavedViewFromURL())
  const [subscriptionMode,setSubscriptionMode] = useState<'latest'|'history'|'health'>(() => selectedSavedViewFromURL() || new URLSearchParams(location.search).get('mode') === 'history' ? 'history' : window.location.hash === '#health' ? 'health' : 'latest')
  const inbox = useSubscriptionInbox(view==='subscriptions' && subscriptionMode==='history', subscriptionView)
  const savedViews = useSavedViews(view==='subscriptions')
  const skipDefaultSubscriptionView = useRef(false)
  useEffect(() => {
    const syncSubscriptionURL = () => {
      if (view !== 'subscriptions') return
      const selected = selectedSavedViewFromURL()
      const params = new URLSearchParams(location.search)
      setSubscriptionView(selected)
      setSubscriptionMode(selected || params.get('mode') === 'history' ? 'history' : location.hash === '#health' ? 'health' : 'latest')
      setSubscriptionFilter(params.get('q') ?? '')
      const read = params.get('read')
      setSubscriptionReadFilter(read === 'unread' || read === 'read' ? read : 'all')
    }
    window.addEventListener('popstate', syncSubscriptionURL)
    return () => window.removeEventListener('popstate', syncSubscriptionURL)
  }, [view])
  useEffect(()=>{
    if(view!=='subscriptions'||subscriptionMode!=='history'||subscriptionView||!savedViews.views.length)return
    if(skipDefaultSubscriptionView.current){skipDefaultSubscriptionView.current=false;return}
    const defaultView=savedViews.views.find(item=>item.default)
    if(defaultView){setSubscriptionView(defaultView.id);navigate('subscriptions',false,`/subscriptions?view=${encodeURIComponent(defaultView.id)}`)}
  },[view,subscriptionMode,subscriptionView,savedViews.views])
  const applyInboxFilters = (filters: InboxFilters) => {
    const activeView=savedViews.views.find(item=>item.id===subscriptionView)
    if(activeView&&!activeView.builtin){
      void savedViews.update(activeView.id,{definition:{version:1,filters}}).then(()=>inbox.updateSavedView(filters))
      return
    }
    skipDefaultSubscriptionView.current = true
    setSubscriptionView('')
    setSubscriptionMode('history')
    void inbox.apply(filters)
    navigate('subscriptions', false, '/subscriptions?mode=history')
  }
  const addPodcastSubscription = () => {
    inbox.selectSavedView()
    setSubscriptionView('')
    setSubscriptionMode('latest')
    skipDefaultSubscriptionView.current = false
    navigate('subscriptions', true, '/subscriptions?add=rss')
  }
  const [subscriptionFilter, setSubscriptionFilter] = useState(() => view === 'subscriptions' ? new URLSearchParams(location.search).get('q') ?? '' : '')
  const [subscriptionReadFilter, setSubscriptionReadFilter] = useState<'all' | 'unread' | 'read'>(() => {
    if (view !== 'subscriptions') return 'all'
    const read = new URLSearchParams(location.search).get('read')
    return read === 'unread' || read === 'read' ? read : 'all'
  })
  const updateSubscriptionFilter = (value: string) => {
    setSubscriptionFilter(value)
    const params = new URLSearchParams(location.search)
    if (value.trim()) params.set('q', value.trim())
    else params.delete('q')
    navigate('subscriptions', false, `/subscriptions${params.toString() ? `?${params}` : ''}${location.hash}`)
  }
  const updateSubscriptionReadFilter = (value: 'all' | 'unread' | 'read') => {
    setSubscriptionReadFilter(value)
    const params = new URLSearchParams(location.search)
    if (value === 'all') params.delete('read')
    else params.set('read', value)
    navigate('subscriptions', false, `/subscriptions${params.toString() ? `?${params}` : ''}${location.hash}`)
  }
  const [galleryKind, setGalleryKind] = useState(() => readDiscoveryFilterState().kind)
  const [galleryOrigin, setGalleryOrigin] = useState('platforms')
  const [galleryQuery, setGalleryQuery] = useState('')
  const creatorReturnPath = useRef('/search')
  const bilibiliReturnPath = useRef('/')
  const gallery = useGallery(view === 'podcasts', view === 'podcasts' ? podcastSources : gallerySources)
  const podcastEpisodes = usePodcastEpisodes(view === 'podcasts')
  const globalNotes = useGlobalNotes(view === 'notes')
  const [downloadIntent, setDownloadIntent] = useState<{ url: string; mode: 'video' | 'audio'; token: number } | null>(null)
  const favorites = useFavoriteSync(view === 'library')
  const [libraryMode, setLibraryMode] = useState<LibrarySource>('local')
  const showLocal = view !== 'library' || libraryMode === 'local'

  // Animation hooks
  const toast = useToast()

  const libraryIDs = useMemo(() => library.items.filter(item => item.kind === 'video' || item.kind === 'audio').map(item => item.id), [library.items])
  const progressOverview = useProgressOverview(libraryIDs, view === 'library' && !library.loading && !library.error)
  const savedIDs = useMemo(() => new Set(library.items.map(item => item.id)), [library.items])
  const collection = useCollectionView({ view, libraryItems: library.items, discoveryItems: discovery.feed?.items ?? [], progressOverview })
  const { contentView, libraryKind, setLibraryKind, filters, setFilters, layouts, setLayouts, sorts, setSorts, sourceItems, items } = collection
  const loading = contentView === 'library' ? library.loading : discovery.loading
  const error = contentView === 'library' ? library.error : discovery.error
  const savingUnavailable = library.loading || Boolean(library.error)

  function focusSource() {
    if (view === 'subscriptions') {
      const toggle = document.getElementById('subscription-add-toggle')
      if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
      window.setTimeout(() => document.getElementById('subscription-query')?.focus(), 0)
      return
    }
    navigate('search', view !== 'search', '/search?entry=add')
    window.setTimeout(() => {
      const target = document.querySelector<HTMLInputElement>('[data-add-content-input]') ?? document.querySelector<HTMLInputElement>('.unified-search-form input') ?? input.current
      target?.focus()
      target?.scrollIntoView({ block: 'center' })
    }, 0)
  }


  function openReader(item: ContentItem) {
    viewingHistory.record(item)
    historyRecorded.current = item.id
    const returnView = view === 'podcasts' ? 'podcasts' : view === 'bilibili' ? 'bilibili' : view === 'history' ? 'history' : view === 'subscriptions' ? 'subscriptions' : view === 'discovery' ? 'discovery' : contentView
    setReaderReturn(returnView, `${location.pathname}${location.search}${location.hash}`)
    readerSourceID.current = item.id
    scrollPositions.current.reader = 0
    setReadingItem(item)
    navigate('reader', true, readerPathForItem(item))
    requestAnimationFrame(() => document.getElementById('main')?.focus({ preventScroll: true }))
  }

  function onDownload(item: ContentItem) {
    setDownloadIntent({ url: item.kind === 'audio' ? item.mediaUrl || item.url : item.url, mode: item.kind === 'audio' ? 'audio' : 'video', token: Date.now() })
    navigate('downloads')
  }

  function updateDiscoveryQuery(query: string) {
    setGalleryQuery(query)
    const params = new URLSearchParams(location.search)
    if (query.trim()) params.set('q', query.trim())
    else params.delete('q')
    navigate('discovery', false, params.toString() ? `/?${params}` : '/')
  }

  function openCreator(platform: string, authorID: string) {
    const path = `/search?creatorPlatform=${encodeURIComponent(platform)}&creator=${encodeURIComponent(authorID)}`
    const params = new URLSearchParams(location.search)
    const alreadyShowing = location.pathname === '/search' && params.get('creatorPlatform') === platform && params.get('creator') === authorID
    const currentCreator = location.pathname === '/search' && Boolean(params.get('creatorPlatform') && params.get('creator'))
    if (!currentCreator) creatorReturnPath.current = `${location.pathname}${location.search}${location.hash}`
    navigate('search', !currentCreator && !alreadyShowing, path)
  }

  function openBilibili() {
    bilibiliReturnPath.current = view === 'discovery'
      ? normalizeBilibiliReturnPath(`${location.pathname}${location.search}${location.hash}`)
      : '/'
    navigate('bilibili')
  }

  function renderCollectionItem(item: ContentItem) {
    if (item.paper) return <PaperCard key={item.id} item={item} saved={savedIDs.has(item.id)} pending={savingUnavailable || library.pending.has(item.id)} onRead={openReader} onSave={item => void library.toggle(item)} />
    const Card = layouts[contentView] === 'grid' ? ModernGalleryCard : ContentCard
    return <Card key={item.id} status={view === 'library' && (item.kind === 'video' || item.kind === 'audio') ? <CardProgress progress={progressOverview.get(item.id)} supported={supportsProgress(item.id)} /> : undefined} item={item} saved={savedIDs.has(item.id)} pending={savingUnavailable || library.pending.has(item.id)} onRead={openReader} onSave={item => void library.toggle(item)} onDownload={onDownload} progress={progressOverview.get(item.id)} />
  }

  const libraryReadingItem = library.items.find(item => item.id === readerQuery || item.platformId === readerQuery)
  const currentReadingItem = readingItem?.id === readerQuery || readingItem?.platformId === readerQuery ? readingItem : null
  const cachedReadingItem = currentReadingItem?.platform === 'rss' && libraryReadingItem && libraryReadingItem.description.length > currentReadingItem.description.length
    ? libraryReadingItem
    : currentReadingItem?.platform === 'linuxdo' && libraryReadingItem
      ? { ...currentReadingItem, savedAt: libraryReadingItem.savedAt }
    : currentReadingItem ?? libraryReadingItem ?? discovery.feed?.items.find(item => (item.id === readerQuery || item.platformId === readerQuery)) ?? subscriptions.detail?.items.find(item => (item.id === readerQuery || item.platformId === readerQuery)) ?? (!library.loading ? viewingHistory.entries.find(({item}) => item.id === readerQuery || item.platformId === readerQuery)?.item : undefined)

  const readingID = readerQuery.startsWith('BV') ? `bilibili:${readerQuery}` : readerQuery
  // What was open in the reader stays one click away after leaving it, so a
  // stray click elsewhere never loses the video or article being worked on.
  const [lastReader, setLastReader] = useState<{ path: string; title: string; sourceID: string } | null>(() => {
    try {
      const raw = sessionStorage.getItem('tangentry.last-reader')
      if (!raw) return null
      const value = JSON.parse(raw) as Partial<{ path: string; title: string; sourceID: string }>
      if (typeof value.path !== 'string' || !value.path.startsWith('/reader?') || typeof value.sourceID !== 'string') return null
      return { path: value.path, title: typeof value.title === 'string' && value.title.trim() ? value.title : '正在阅读的内容', sourceID: value.sourceID }
    } catch { return null }
  })
  useEffect(() => {
    try {
      if (lastReader) sessionStorage.setItem('tangentry.last-reader', JSON.stringify(lastReader))
      else sessionStorage.removeItem('tangentry.last-reader')
    } catch { /* Resume is a convenience; navigation remains usable when storage is unavailable. */ }
  }, [lastReader])
  useEffect(() => {
    if (view === 'reader' && readerQuery) {
      setLastReader({
        path: `${location.pathname}${location.search}${location.hash}`,
        title: cachedReadingItem?.title || '正在阅读的内容',
        sourceID: readerSourceID.current || cachedReadingItem?.id || readingID,
      })
    }
  }, [view, readerQuery, cachedReadingItem?.title])
  const historyRecorded = useRef('')
  useEffect(() => {
    if (view !== 'reader') { historyRecorded.current = ''; return }
    if (!cachedReadingItem || historyRecorded.current === readingID) return
    historyRecorded.current = readingID
    viewingHistory.record(cachedReadingItem)
  }, [view, readingID, cachedReadingItem, viewingHistory.record])
  const readStates = useReadState([
    ...(view === 'subscriptions' ? subscriptionMode==='history' ? inbox.page.entries.map(entry=>entry.item.id) : subscriptions.detail?.items.map(item => item.id) ?? [] : []),
    ...(view === 'reader' && supportsReadState(readingID) ? [readingID] : []),
  ])
  const openedForReading = useRef('')
  useEffect(() => {
    if (view !== 'reader') { openedForReading.current = ''; return }
    if (!cachedReadingItem || !readStates.ready || readStates.pending.size || openedForReading.current === readingID) return
    openedForReading.current = readingID
    if (readStates.get(readingID)?.read === false) void readStates.setRead([readingID], true)
  }, [view, readingID, cachedReadingItem, readStates.ready, readStates.pending, readStates.states, readStates.setRead])

  const localVideos = useMemo(() => downloads.jobs.filter(job => job.state === 'completed' && job.mode !== 'audio' && job.url === `https://www.bilibili.com/video/${readerQuery}/`).map(job => ({ id: job.id, label: `${job.maxHeight ? `最高 ${job.maxHeight}p` : '原画'} · ${new Date(job.createdAt * 1000).toLocaleString('zh-CN')}`, url: `/api/downloads/${encodeURIComponent(job.id)}/media` })), [downloads.jobs, readerQuery])

  function openDownloadReader(job: DownloadJob) {
    const douyin = /^https:\/\/www\.douyin\.com\/video\/([1-9][0-9]{15,19})$/.exec(job.url)?.[1]
    const xhs = /^https:\/\/www\.xiaohongshu\.com\/explore\/([a-f0-9]{24})(?:\?|$)/.exec(job.url)?.[1]
    const social = douyin ? {platform:'douyin',id:douyin} : xhs ? {platform:'xiaohongshu',id:xhs} : null
    if(social){ setReaderReturn('downloads', `${location.pathname}${location.search}${location.hash}`);readerSourceID.current='download:'+job.id;setReadingItem({id:social.platform+':'+social.id,platform:social.platform,platformId:social.id,kind:'video',title:job.title,url:job.url,author:'',authorId:'',thumbnailUrl:'',description:'',durationSeconds:0,publishedAt:0}); navigate('reader',true,'/reader?contentId='+encodeURIComponent(social.platform+':'+social.id));return }
    const videoID = /^https:\/\/www\.bilibili\.com\/video\/(BV[0-9A-Za-z]{10})\/$/.exec(job.url)?.[1]
    if (!videoID) {
      const yt= new URL(job.url).searchParams.get('v')
      if(!yt)return
      setReaderReturn('downloads', `${location.pathname}${location.search}${location.hash}`);readerSourceID.current='download:'+job.id
      setReadingItem({id:'youtube:'+yt,platform:'youtube',platformId:yt,kind:'video',title:job.title,url:job.url,author:'',authorId:'',thumbnailUrl:'',description:'',durationSeconds:0,publishedAt:0})
      navigate('reader',true,'/reader?contentId='+encodeURIComponent('youtube:'+yt));return
    }
    setReaderReturn('downloads', `${location.pathname}${location.search}${location.hash}`)
    readerSourceID.current = `download:${job.id}`
    scrollPositions.current.reader = 0
    setReadingItem(null)
    navigate('reader', true, `/reader?video=${encodeURIComponent(videoID)}`)
  }

  function openNoteReader(note: ReadingNote) {
    setReaderReturn('notes', `${location.pathname}${location.search}${location.hash}`)
    readerSourceID.current = `note:${note.id}`
    scrollPositions.current.reader = 0
    setReadingItem(null)
    navigate('reader', true, readerPath(note.contentId, note.id))
  }

  return <ExperienceShell
      view={view}
      onNavigate={navigate}
      savedViews={savedViews.views}
      onNavigateSavedView={id=>{setSubscriptionView(id);setSubscriptionMode('history');navigate('subscriptions',view !== 'subscriptions',`/subscriptions?view=${encodeURIComponent(id)}`)}}
      onReorderSavedViews={ids=>void savedViews.reorder(ids)}
      onSearchQuery={query => navigate('search', view !== 'search', query.trim() ? `/search?entry=search&q=${encodeURIComponent(query.trim())}` : '/search?entry=search')}
      onHome={returnHome}
      activeDownloads={downloads.jobs.filter(job => job.state === 'queued' || job.state === 'running').length}
      savedCount={library.items.length}
      onAdd={focusSource}
      discoveryQuery={galleryQuery}
      onDiscoveryQuery={updateDiscoveryQuery}
      resume={view !== 'reader' ? lastReader : null}
      onResume={() => {
        if (!lastReader) return
        // Resuming from another page creates a new, explicit source snapshot;
        // the reader should return to where the user resumed, not the page
        // that originally opened this item.
        const sourceView = view === 'reader' ? 'discovery' : view
        setReaderReturn(sourceView, `${location.pathname}${location.search}${location.hash}`)
        readerSourceID.current = lastReader.sourceID
        navigate('reader', true, lastReader.path)
      }}
      onDismissResume={() => setLastReader(null)}
    >
    <ReaderActionsProvider><main id="main" className={`main-workspace ${view === 'reader' ? 'immersive-reader' : ''}`} tabIndex={-1}>
      <div className="content-container">
      <div className="discovery-page-container">
      {pageLayers.mountDiscovery && <PageLoadBoundary key="discovery-page">
        <Activity mode={pageLayers.discoveryVisible ? 'visible' : 'hidden'}>
          <div data-app-view="discovery">
            <DiscoveryGallery active={pageLayers.discoveryVisible} kind={galleryKind} onKind={setGalleryKind} origin={galleryOrigin} onOrigin={setGalleryOrigin} query={galleryQuery} onClearQuery={() => updateDiscoveryQuery('')} onQueryChange={setGalleryQuery} onRouteChange={path => navigate('discovery', false, path)} notice={library.notice} noticeError={library.noticeError} gallery={gallery} savedIDs={savedIDs} pending={library.pending} savingUnavailable={savingUnavailable} onSave={item => void library.toggle(item)} onRead={openReader} onDownload={onDownload} onCreator={openCreator} onSearch={focusSource} onSubscriptions={() => navigate('subscriptions')} onSettings={() => navigate('tools', true, '/tools#accounts')} onBilibili={openBilibili} />
          </div>
        </Activity>
      </PageLoadBoundary>}
      </div>
      <div className="active-page-container">
      <PageLoadBoundary key={`page-${pageLayers.activePage ?? 'discovery'}`}>
      {view === 'reader' && <AppReaderActions item={cachedReadingItem ?? null} saved={cachedReadingItem ? savedIDs.has(cachedReadingItem.id) : false} savingUnavailable={savingUnavailable} libraryPending={library.pending} library={library} downloads={downloads} readState={readStates} readingID={readingID} supportsReadState={supportsReadState(readingID)} onDownload={onDownload}/>}
      {view === 'history' ? <ViewingHistoryPage history={viewingHistory} onRead={openReader} onSave={item => void library.toggle(item)} savedIDs={savedIDs} pending={library.pending} unavailable={savingUnavailable}/>
      : view === 'discovery' ? null
      : view === 'podcasts' ? <PodcastsPage history={viewingHistory.entries} library={library.items} episodes={podcastEpisodes} gallery={gallery} savedIDs={savedIDs} pending={library.pending} unavailable={savingUnavailable} onRead={openReader} onSave={item => void library.toggle(item)} onDownload={onDownload} onSubscriptions={() => navigate('subscriptions')} onSubscribePodcast={addPodcastSubscription} onSettings={() => { navigate('tools', true, '/tools#accounts') }} onAdd={addPodcastSubscription} />
      : view === 'bilibili' ? <BilibiliPage browser={bilibili} savedIDs={savedIDs} pending={library.pending} unavailable={savingUnavailable} notice={library.notice} noticeError={library.noticeError} onRead={openReader} onSave={item => void library.toggle(item)} onReturn={() => returnToPath(bilibiliReturnPath.current, 'discovery')} onLogin={() => navigate('tools', true, '/tools#accounts')} onLibrary={() => navigate('library')} />
      : view === 'notes' ? <GlobalNotesPage browser={globalNotes} savedItems={library.items} onRead={openNoteReader} /> : view === 'reader' ? (
        readerQuery.startsWith('youtube:') ? <YouTubeReadingWorkspace key={readerQuery} id={readerQuery} linkedNoteId={readerNoteId} initialItem={cachedReadingItem} jobs={downloads.jobs} loading={downloads.loading} error={downloads.error} onReturn={returnFromReader} onDownloads={() => navigate('downloads')} onRefresh={() => void downloads.reload()} onCreator={openCreator} />
        : readerQuery.includes(':') ? (library.loading && !cachedReadingItem ? <p className="field-hint" role="status">正在读取本机内容…</p> : <ContentReadingWorkspace key={readerQuery} id={readerQuery} linkedNoteId={readerNoteId} initialItem={cachedReadingItem} jobs={downloads.jobs} jobsLoading={downloads.loading} onItem={setReadingItem} onCreator={openCreator} onReturn={returnFromReader} />)
        : <ReadingWorkspace key={readerQuery} query={readerQuery} linkedNoteId={readerNoteId} initialItem={cachedReadingItem} onReturn={returnFromReader} sources={localVideos} loading={downloads.loading} error={downloads.error} onDownloads={() => navigate('downloads')} onRefresh={() => void downloads.reload()} />
      ) : view === 'subscriptions' ? <SubscriptionsPage inbox={inbox} selectedViewID={subscriptionView} onSelectView={id=>{inbox.selectSavedView();skipDefaultSubscriptionView.current=false;setSubscriptionView(id);setSubscriptionMode('history');navigate('subscriptions',false,`/subscriptions?view=${encodeURIComponent(id)}`)}} onApplyFilters={applyInboxFilters} mode={subscriptionMode} onMode={mode=>{skipDefaultSubscriptionView.current=false;setSubscriptionView('');setSubscriptionMode(mode);navigate('subscriptions',false,mode==='history'?'/subscriptions?mode=history':mode==='health'?'/subscriptions#health':'/subscriptions');if(mode==='history'&&inbox.confirmed)void inbox.reload()}} views={savedViews.views} onSaveView={async (name,filters)=>{const definition={version:1,filters};const existing=savedViews.views.find(item=>item.id===subscriptionView&&!item.builtin);if(existing){await savedViews.update(existing.id,{name,definition});await inbox.updateSavedView(filters)}else{const saved=await savedViews.create(name,definition);inbox.selectSavedView();setSubscriptionView(saved.id);setSubscriptionMode('history');navigate('subscriptions',false,`/subscriptions?view=${encodeURIComponent(saved.id)}`)}}} onUpdateView={(id,edit)=>void savedViews.update(id,edit)} onDeleteView={id=>{void savedViews.remove(id);if(id===subscriptionView){inbox.selectSavedView();setSubscriptionView('');navigate('subscriptions',false,'/subscriptions?mode=history')}}} readStates={readStates} readFilter={subscriptionReadFilter} onReadFilter={updateSubscriptionReadFilter} subscriptions={subscriptions} savedIDs={savedIDs} savingUnavailable={savingUnavailable} savingIDs={library.pending} onSave={item => void library.toggle(item)} onRead={openReader} filter={subscriptionFilter} onFilter={updateSubscriptionFilter} saveNotice={library.notice} saveError={library.noticeError} /> : view === 'search' ? <UnifiedSearchPage initialQuery={new URLSearchParams(location.search).get('q') ?? ''} savedIDs={savedIDs} pending={library.pending} onRead={openReader} onSave={item => void library.toggle(item)} onCreator={openCreator} onReturnCreator={() => { const target = creatorReturnFromPath(creatorReturnPath.current); returnToPath(target.path, target.view) }} onReturnCreatorLabel={creatorReturnFromPath(creatorReturnPath.current).label} onRouteChange={path => navigate('search', false, path)} onSubscribe={(platform, authorID) => { if (platform === 'bilibili' || platform === 'youtube') void subscriptions.create(authorID, '', platform) }} /> : view === 'downloads' ? <DownloadsPage downloads={downloads} onRead={openDownloadReader} intent={downloadIntent} /> : view === 'tools' ? <ToolsPage downloads={downloads} columns={galleryLayout.columns} onColumns={galleryLayout.setColumns} onCookieChanged={platform => { gallery.invalidate(platform); if (platform === 'bilibili') bilibili.invalidate() }} onYouTubeFeed={feed => gallery.accept('youtube', feed)} onDiscover={() => navigate('discovery')} /> : <>
        {view === 'library' ? <PageHeader title="收藏" summary={library.loading ? '正在读取本机收藏…' : library.items.length ? `${library.items.length} 条收藏${(() => { const kinds = Object.entries(kindNames).map(([kind, name]) => [name, library.items.filter(item => item.kind === kind).length] as const).filter(([, count]) => count > 0); return kinds.length > 1 ? ' · ' + kinds.map(([name, count]) => `${name} ${count}`).join(' · ') : '' })()}` : '把想继续看、听、读的内容留在本机。'} actions={<Button variant="primary" className="button button-primary collection-add" onClick={() => navigate('search')}><Plus size={16}/><span>添加内容</span></Button>}/>
        : <PageHeader title="添加内容" summary="粘贴视频、播客、文章或 RSS 链接，也可以导入本机 PDF。识别后可直接阅读或收藏。"/>}
        {view === 'library' && <LibrarySources favorites={favorites} mode={libraryMode} localCount={library.items.length} onLocal={() => setLibraryMode('local')} onFolder={id => { favorites.setSelected(id); setLibraryMode('folder') }} onSetup={() => setLibraryMode('setup')}/>}
        {view === 'library' && libraryMode === 'setup' && <FavoriteSetup favorites={favorites} onFollowed={() => setLibraryMode('folder')}/>}
        {view === 'library' && libraryMode === 'folder' && <FavoriteFolder favorites={favorites} savedIDs={savedIDs} savingUnavailable={savingUnavailable} savingIDs={library.pending} onSave={item => void library.toggle(item)} onRead={openReader} onDownload={onDownload} onRemoved={() => setLibraryMode('local')}/>}
        {!showLocal && library.notice && <p className="inline-feedback collection-save-feedback" role={library.noticeError ? 'alert' : 'status'}>{library.noticeError ? <AlertCircle size={17} /> : <Check size={17} />}{library.notice}</p>}
        {showLocal && <>
        {error && <div className="error-panel" role="alert"><AlertCircle size={19} /><div><strong>这次没能完成</strong><p>{error}</p></div><Button variant="secondary" className="button button-secondary" onClick={() => view === 'library' ? void library.reload() : void discovery.retry()} disabled={loading}>重试</Button></div>}
        {(view === 'library' || sourceItems.length > 0) && <div className={`collection-toolbar ${view === 'library' ? 'library-toolbar' : 'results-toolbar'}`}>
          {view === 'library' ? <MediaFilters value={libraryKind} onChange={setLibraryKind} counts={Object.fromEntries(['all', 'video', 'article', 'image', 'audio', 'pdf'].map(kind => [kind, library.items.filter(item => kind === 'all' || item.kind === kind).length]))}/>
            : <div className="results-heading">{discovery.feed ? <><span className="status-dot" aria-hidden="true"/><strong>{discovery.feed.sourceTitle || '获取结果'}</strong><span>已加载 {discovery.feed.items.length} 条{discovery.feed.total > discovery.feed.items.length ? `，共 ${discovery.feed.total} 条` : ''}</span></> : <strong>获取结果</strong>}</div>}
          <div className="collection-controls">
            {view === 'library' && <ProgressOverviewControls overview={progressOverview} search={filters.library} onSearch={value => setFilters(current => ({ ...current, library: value }))} />}
            <Select className="sort-control" aria-label="内容排序" value={sorts[contentView]} onChange={event => setSorts(current => ({ ...current, [contentView]: event.target.value as 'default' | 'oldest' }))}><option value="default">{view === 'library' ? '最近收藏' : '最新发布'}</option><option value="oldest">从早到晚</option></Select>
            <div className="layout-switch segmented" role="group" aria-label="布局选择"><Button variant="quiet" type="button" onClick={() => setLayouts(current => ({ ...current, [contentView]: 'grid' }))} aria-label="画廊布局" title="画廊布局" aria-pressed={layouts[contentView] === 'grid'}><Grid2X2 size={15} /></Button><Button variant="quiet" type="button" onClick={() => setLayouts(current => ({ ...current, [contentView]: 'list' }))} aria-label="列表布局" title="列表布局" aria-pressed={layouts[contentView] === 'list'}><List size={16} /></Button></div>
          </div>
        </div>}
        {library.notice && <p className="inline-feedback collection-save-feedback" role={library.noticeError ? 'alert' : 'status'}>{library.noticeError ? <AlertCircle size={17} /> : <Check size={17} />}{library.notice}</p>}
        {items.length > 0 && <CardCollection masonry={layouts[contentView] === 'grid' && libraryKind !== 'video' && libraryKind !== 'audio'} data-media={view === 'library' ? libraryKind : 'all'} className={`content-collection ${layouts[contentView] === 'list' ? 'list-layout' : 'gallery-layout modern-gallery'}`} aria-label={view === 'library' ? '收藏内容' : '发现内容'}>{items.map(renderCollectionItem)}</CardCollection>}
        {loading && sourceItems.length === 0 && (view === 'library' || discovery.feed || discovery.loading) && <SkeletonGallery count={layouts[contentView] === 'grid' ? 8 : 6} />}
        {!loading && !error && items.length === 0 && view === 'library' && progressOverview.effectiveFilter !== 'all' && <section className="empty-state"><h2>没有符合当前进度的收藏</h2><p>进度与标题、作者搜索共同筛选；可以查看全部进度或调整关键词。</p><Button variant="secondary" className="button button-secondary" onClick={() => progressOverview.setFilter('all')}>查看全部进度</Button></section>}
        {!loading && !error && items.length === 0 && !(view === 'library' && progressOverview.effectiveFilter !== 'all') && (view === 'library' || discovery.feed || filters.search) && <section className="empty-state"><div className="empty-art" aria-hidden="true">{filters[view as ContentView] ? <Compass size={26} strokeWidth={1.4} /> : view === 'library' ? <Bookmark size={26} strokeWidth={1.4} /> : <BrandMark className="empty-brand"/>}</div><h2>{filters[view as ContentView] ? '没有找到匹配的内容' : view === 'library' ? libraryKind !== 'all' ? `还没有收藏${kindNames[libraryKind] ?? ''}` : '给喜欢的内容留个位置' : '这位创作者暂时没有可见投稿'}</h2><p>{filters[view as ContentView] ? '搜索仅覆盖当前已加载的标题与作者，试试其他关键词。' : view === 'library' ? libraryKind !== 'all' ? '切换到其他类型，或从发现与订阅里收藏更多内容。' : '在发现、订阅或阅读时点击收藏，它们就会出现在这里。' : '换一位 UP 主，或直接输入视频地址。'}</p>{filters[view as ContentView] ? <Button variant="secondary" className="button button-secondary" onClick={() => setFilters(current => ({ ...current, [view]: '' }))}>清除搜索</Button> : view === 'library' && libraryKind !== 'all' ? <Button variant="secondary" className="button button-secondary" onClick={() => setLibraryKind('all')}>查看全部收藏</Button> : <Button variant="quiet" className="empty-link" onClick={view === 'library' ? () => navigate('discovery') : focusSource}>{view === 'library' ? '去发现内容' : '添加第一个来源'}<ArrowRight size={15} /></Button>}</section>}
        </>}
      </>}
      </PageLoadBoundary>
      </div>
      <RestoreViewport key={`${view}:${viewportTarget.current.routeKey}:${viewportVersion}`} view={view} {...viewportTarget.current}/>
      </div>
    </main></ReaderActionsProvider>
    <BackToTop />
    <UpdaterNotice />
    {toast.toasts.map(message => <Toast key={message.id} message={message.message} type={message.type} visible duration={0} onClose={() => toast.hide(message.id)} />)}
  </ExperienceShell>
}
