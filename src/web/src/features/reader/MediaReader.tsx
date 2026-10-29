import { Button } from '../../components/ui'
import { ArrowLeft, BookOpen, Download, ExternalLink, RotateCw, StickyNote } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { ContentItem, Discussion, DownloadJob, ReadingNote, TextAnchor, PDFAnchor } from '../../shared/api/types'
import { APIError, request } from '../../shared/api/client'
import { diagnosticOutcomeName, diagnosticStageFacts, diagnosticStageName, parseDouyinDiagnostics, type DouyinDiagnosticStage } from './douyinDiagnostics'
import { PDFReader } from '../documents/PDFReader'
import { FeedDocumentReader } from './FeedDocumentReader'
import { ArticleReader } from './ArticleReader'
import { FullTextArticle } from './FullTextArticle'
import { ImageAlbum } from './ImageAlbum'
import { IframePlayer } from './IframePlayer'
import type { PlaybackHandle } from '../../shared/media/types'
import { mediaLabel } from '../../shared/ui/ContentCard'
import { BilingualTitle } from '../ai/TextTranslation'
import { ReaderActionsSlot, ReaderNavigationSlot } from '../../shared/reader/ReaderActions'
import { useNativePlaybackClock } from '../player/useNativePlaybackClock'
import { NativeReadingProgress } from '../progress/NativeReadingProgress'
import { useCompatibilityPlayback } from '../player/useCompatibilityPlayback'
import { ReaderDescription } from './ReaderDescription'
import { hasPlayableOnlineSource, shouldStartCompatibilityPlayback } from './onlinePlayback'
import { AudioControls } from './AudioControls'
import { ReadingNotebook } from '../../shared/reader/ReadingNotebook'
import { XiaohongshuSourceForm } from './XiaohongshuSourceForm'
import { PodcastArtwork } from '../../shared/ui/PodcastArtwork'
import { ReaderPublication } from './ReaderPublication'
import { PaperInfoCard } from '../documents/PaperInfoCard'
import { DiscussionReader } from './DiscussionReader'
import { DiscussionFallback } from './DiscussionFallback'
import { creatorViewSupported } from '../../shared/ui/cardHelpers'
import { useReaderContent } from './useReaderContent'
import { openDesktopPlatformLogin, useCapabilities } from '../../shared/api/desktop'
import './reader.css'
import './watch.css'
import './listen.css'

function useDouyinPlayback(identity: string, id: string) {
  const [attempt, setAttempt] = useState(0)
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [diagnostics, setDiagnostics] = useState<DouyinDiagnosticStage[]>([])
  const [session, setSession] = useState('')
  const automaticRetries = useRef(0)
  const readyReported = useRef(false)
  const failureReportInFlight = useRef(false)
  useEffect(() => { setAttempt(0); setSource(''); setError(''); setDiagnostics([]); setSession(''); automaticRetries.current = 0 }, [identity, id])
  useEffect(() => {
    if (!attempt || !id) return
    let active = true
    const controller = new AbortController()
    let token = ''
    setDiagnostics([])
    readyReported.current = false
    void request<{ id: string }>(`/playback/douyin/${encodeURIComponent(id)}`, { method: 'POST', signal: controller.signal }).then(value => {
      token = value.id
      if (active) { setSession(token); setSource(`/api/playback/sessions/${encodeURIComponent(token)}/media`) }
      else void request(`/playback/sessions/${encodeURIComponent(token)}`, { method: 'DELETE', keepalive: true }).catch(() => {})
    }).catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : '抖音在线视频暂不可用。'); setDiagnostics(cause instanceof APIError ? parseDouyinDiagnostics(cause.details) : []) } })
    return () => { active = false; controller.abort(); if (token) void request(`/playback/sessions/${encodeURIComponent(token)}`, { method: 'DELETE', keepalive: true }).catch(() => {}) }
  }, [attempt, id])
  const fail = async (media: HTMLMediaElement | null) => {
    if (failureReportInFlight.current) return
    failureReportInFlight.current = true
    if (session) {
      try {
        const value = await request<{ details?: unknown[] }>(`/playback/sessions/${encodeURIComponent(session)}/diagnostics`, { method: 'POST', body: JSON.stringify({ code: media?.error?.code ?? 0, message: media?.error?.message ?? '', retries: automaticRetries.current, failed: true }) })
        setDiagnostics(parseDouyinDiagnostics(value.details))
      } catch { /* Playback can still be retried if diagnostic reporting fails. */ }
    }
    setSource('')
    if (automaticRetries.current < 1) {
      automaticRetries.current += 1
      setDiagnostics([])
      setSession('')
      readyReported.current = false
      setError('播放地址已失效，正在重新解析抖音视频…')
      setAttempt(value => value + 1)
    } else {
      setError('抖音播放地址已过期，请重试。')
    }
    failureReportInFlight.current = false
  }
  const ready = async () => {
    if (!session || readyReported.current) return
    readyReported.current = true
    try {
      const value = await request<{ details?: unknown[] }>(`/playback/sessions/${encodeURIComponent(session)}/diagnostics`, { method: 'POST', body: JSON.stringify({ code: 0, message: '', retries: automaticRetries.current, ready: true }) })
      setDiagnostics(parseDouyinDiagnostics(value.details))
    } catch { /* Playback remains usable if reporting fails. */ }
  }
  return { source, error, diagnostics, active: attempt > 0, start: () => { automaticRetries.current = 0; readyReported.current = false; setDiagnostics([]); setError(''); setSource(''); setSession(''); setAttempt(value => value + 1) }, fail, ready }
}

export function MediaReader({ id, initialItem, jobs, jobsLoading = false, video, reading, notes, insights, mediaRef, playbackRef, onReady, onPosition, onSeek, onItem, onDiscussionChange, onQuote, annotations = [], textFocus, onOpenNotes, onUnresolved, onPDFQuote, onCreator, onAudioStreamChange, onReturn }: { id: string; initialItem?: ContentItem; jobs: DownloadJob[]; jobsLoading?: boolean; video?: ReactNode; reading?: ReactNode; notes?: ReactNode; insights?: ReactNode; mediaRef?:RefObject<HTMLMediaElement|null>; playbackRef?:RefObject<PlaybackHandle|null>; onReady?:(ready:boolean)=>void; onPosition?:(seconds:number|null)=>void; onSeek?:(seconds:number)=>void; onItem?:(item:ContentItem)=>void; onDiscussionChange?:(discussion:Discussion)=>void; onQuote?:(text:string,anchor?:TextAnchor)=>void; annotations?:ReadingNote[]; textFocus?:{id:string;token:number;allowReturn?:boolean}|null; onOpenNotes?:(ids:string[])=>void; onUnresolved?:(ids:string[])=>void; onPDFQuote?:(text:string,anchor:PDFAnchor)=>void; onCreator?:(platform:string, authorID:string)=>void; onAudioStreamChange?:(stream:MediaStream|null)=>void; onReturn: () => void }) {
  const [quote,setQuote]=useState('')
  const { item, error, errorRequiresVerification, localReadFailed, retryLocalRead, social, localSocial, refreshDetails, detailError, detailRequiresVerification, detailLoading, detailRead, sourceEditing, setSourceEditing, onSourceUpdated } = useReaderContent({ id, initialItem, jobs, jobsLoading, onItem })
  const itemRef = useRef<ContentItem | null>(null)
  itemRef.current = item
  const updateDiscussion = useCallback((discussion: Discussion) => {
    const current = itemRef.current
    if (current) onItem?.({ ...current, discussion })
    onDiscussionChange?.(discussion)
  }, [onDiscussionChange, onItem])
  const capabilities = useCapabilities()
  const [audioError, setAudioError] = useState(false)
  const lastAudioPosition = useRef(0)
  const audioResume = useRef<number | null>(null)
  useEffect(() => { setAudioError(false); lastAudioPosition.current = 0; audioResume.current = null }, [id, item?.mediaUrl])
  const body=useRef<HTMLDivElement>(null)
  const notesRegion = useRef<HTMLElement>(null)
  const notesShortcut = useRef<HTMLButtonElement>(null)
  const readingPosition = useRef<number | null>(null)
  const [notesVisited, setNotesVisited] = useState(false)
  const [notesNavigation, setNotesNavigation] = useState<HTMLDivElement | null>(null)
  function returnedToReading() {
    readingPosition.current = null
    setNotesVisited(false)
  }
  useEffect(() => { readingPosition.current = null; setNotesVisited(false) }, [id])
  function openNotes() {
    if (!notesRegion.current) return
    if (readingPosition.current === null) readingPosition.current = window.scrollY
    setNotesVisited(true)
    requestAnimationFrame(() => {
      notesRegion.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
      notesRegion.current?.focus({ preventScroll: true })
    })
  }
  function resumeReading() {
    const position = readingPosition.current
    if (position === null) return
    window.scrollTo({ top: position, behavior: 'instant' })
    readingPosition.current = null
    setNotesVisited(false)
    notesShortcut.current?.focus({ preventScroll: true })
  }
  const native=useRef<HTMLMediaElement|null>(null)
  const lastVideoPosition = useRef(0)
  const compatibilityResume = useRef<number | null>(null)
  const compatibilityRequested = useRef<HTMLMediaElement | null>(null)
  const compatibilityAutoStarted = useRef('')
  const local = localSocial || jobs.find(job => job.state === 'completed' && job.url === item?.url && (item?.kind !== 'video' || job.mode !== 'audio'))
  useEffect(() => { lastVideoPosition.current = 0; compatibilityResume.current = null; compatibilityRequested.current = null; compatibilityAutoStarted.current = '' }, [id, item?.mediaUrl])
  const compatibility = useCompatibilityPlayback(id, item?.url ?? '')
  const douyinPlayback = useDouyinPlayback(id, item?.platform === 'douyin' ? item.platformId : '')
  const compatibilityBlocked = compatibility.active && !compatibility.source
  useEffect(() => {
    if (item?.kind !== 'video' || item.platform !== 'douyin' || local || douyinPlayback.active || douyinPlayback.source || compatibilityAutoStarted.current === id) return
    compatibilityAutoStarted.current = id
    douyinPlayback.start()
  }, [id, item?.kind, item?.platform, local, douyinPlayback.active, douyinPlayback.source])
  async function verifyLinuxdo() {
    try {
      await openDesktopPlatformLogin('linuxdo')
    } catch {
      // The detail error remains visible so the user can retry after closing
      // a failed or unavailable native verification window.
    }
  }
  useNativePlaybackClock(native, `${id}:${item?.mediaUrl}:${localSocial?.id}:${compatibility.source}:${douyinPlayback.source}:${compatibilityBlocked}`, seconds => {
    if (seconds !== null && item?.kind === 'video') lastVideoPosition.current = seconds
    onPosition?.(seconds)
  })
  const lastMedia = useRef<HTMLMediaElement|null>(null)
  const captureAudioStream = (node: HTMLMediaElement | null) => {
    const capture = (node as (HTMLMediaElement & { captureStream?: () => MediaStream }) | null)?.captureStream
    try { onAudioStreamChange?.(capture ? capture.call(node) : null) } catch { onAudioStreamChange?.(null) }
  }
  const bindMedia = useCallback((node: HTMLMediaElement | null) => {
    native.current = node
    if (node) lastMedia.current = node
    if (mediaRef) mediaRef.current = node
    if (node) captureAudioStream(node)
    else onAudioStreamChange?.(null)
  }, [mediaRef, onAudioStreamChange])
  useEffect(()=>{return()=>{const node=lastMedia.current;node?.pause();if(node){node.removeAttribute('src');node.load()}onAudioStreamChange?.(null);onReady?.(false);onPosition?.(null)}},[id,onReady,onPosition,onAudioStreamChange])
  const captureQuote=()=>{
    if (item?.kind==='article'||item?.kind==='image'||item?.kind==='pdf') { setQuote(''); return }
    const selection=window.getSelection()
    setQuote(selection?.anchorNode && selection.focusNode && body.current?.contains(selection.anchorNode) && body.current.contains(selection.focusNode) ? selection.toString().trim().slice(0,2000) : '')
  }
  const report=()=>{
    const node = native.current
    const position = node && node.readyState >= 1 && !node.error && !(item?.kind === 'audio' && node.seeking) && (!(node instanceof HTMLVideoElement) || node.videoWidth > 0) && Number.isFinite(node.currentTime) ? node.currentTime : null
    if (item?.kind === 'audio' && position !== null && audioResume.current === null) lastAudioPosition.current = position
    if (item?.kind === 'video' && position !== null) lastVideoPosition.current = position
    onPosition?.(audioResume.current === null ? position : null)
  }
  function startCompatibility() {
    const node = native.current
    if (!node || compatibilityRequested.current === node) return
    compatibilityRequested.current = node
    compatibilityResume.current = lastVideoPosition.current
    node?.pause()
    node?.removeAttribute('src')
    node?.load()
    onReady?.(false)
    onPosition?.(null)
    compatibility.start()
  }
  useEffect(() => {
    // Cached media can already have metadata before React receives its event.
    // Douyin uses its own server-side playback session and must never fall
    // through to the legacy compatibility renderer.
    const node = native.current
    if (shouldStartCompatibilityPlayback(item?.platform) && !local && !compatibility.active && node instanceof HTMLVideoElement && node.readyState >= 1 && node.videoWidth === 0) startCompatibility()
  })
  function videoLoaded() {
    const node = native.current
    if (shouldStartCompatibilityPlayback(item?.platform) && !local && node instanceof HTMLVideoElement && node.videoWidth === 0) {
      if (compatibility.active) compatibility.fail()
      else startCompatibility()
      return
    }
    const resume = compatibilityResume.current
    compatibilityResume.current = null
    if (node && compatibility.source && resume !== null && resume > 0 && resume < node.duration) {
      try { node.currentTime = resume } catch { /* The saved-progress control remains available. */ }
    }
    onReady?.(true)
    captureAudioStream(native.current)
    report()
  }
  function onlineVideoPlaying() {
    if (item?.platform === 'douyin') void douyinPlayback.ready()
  }
  function onlineVideoFailed() {
    if (item?.platform === 'douyin') void douyinPlayback.fail(native.current)
    else if (shouldStartCompatibilityPlayback(item?.platform)) startCompatibility()
  }
  function audioLoaded() {
    setAudioError(false)
    const node = native.current
    const resume = audioResume.current
    audioResume.current = null
    if (node && resume !== null && resume > 0 && Number.isFinite(node.duration) && resume < node.duration) {
      try { node.currentTime = resume } catch { /* Native controls remain usable if the source cannot seek. */ }
    }
    onReady?.(true)
    captureAudioStream(native.current)
    report()
  }
  function reconnectAudio() {
    audioResume.current = lastAudioPosition.current
    setAudioError(false)
    onReady?.(false)
    onPosition?.(null)
    native.current?.load()
  }
  const quoteText = onQuote ? (text: string, anchor?: TextAnchor) => onQuote(text, anchor) : undefined
  const revealNotes = onOpenNotes ? (ids: string[]) => onOpenNotes(ids) : undefined
  const pdfAnnotations={notes:annotations,focus:textFocus,onQuote:onPDFQuote,onOpenNotes:revealNotes,onUnresolved}
  const descriptionSeek = onSeek ?? (!video && (item?.kind === 'audio' && item.mediaUrl || item?.kind === 'video' && (local || item.mediaUrl || compatibility.source || douyinPlayback.source)) ? (seconds: number) => {
    const node = native.current
    if (!node || Number.isFinite(node.duration) && seconds > node.duration) return
    node.currentTime = seconds
    void node.play().catch(() => {})
    report()
  } : undefined)
  const description = item && (item.kind === 'video' || item.kind === 'audio') && reading
    ? <ReaderDescription key={item.id} item={item} onSeek={descriptionSeek}/>
    : null
  const textAboveNotes = Boolean(notes && item?.platform === 'xiaohongshu' && item.kind === 'image')
  const sourceText = item && (item.kind === 'article' || item.kind === 'image') && !(item.kind === 'article' && item.platform === 'rss')
    ? <ArticleReader collapsible={textAboveNotes} contentId={item.description?.trim() || item.articleBlocks?.length ? item.id : undefined} summarySource="article:content" toolbarOwnsSummary={item.platform==='linuxdo'} sourceTitle={item.title} sourceURL={item.url} title={item.platform==='rss'?'订阅源正文':item.platform==='linuxdo'?'':'笔记正文'} text={item.description || (item.articleBlocks?.length ? item.articleBlocks.filter(block => block.kind !== 'image' && block.kind !== 'emoji').map(block => block.text).filter(Boolean).join('\n\n') : '') || (item.platform==='xiaohongshu'?(detailRead?'这篇笔记没有附加文字。':detailLoading?'正在获取正文…':'正文尚未读取。'):item.platform==='linuxdo'?'话题正文暂不可用，可打开原内容查看。':'来源没有提供正文，可打开原内容查看。')} blocks={item.articleBlocks?.length ? item.articleBlocks : undefined} feed={item.platform==='rss'} notes={annotations} focus={textFocus} onQuote={item.description || item.articleBlocks?.length ? quoteText : undefined} onOpenNotes={revealNotes} onUnresolved={onUnresolved} navigationTarget={notesNavigation} onReturnedToReading={returnedToReading}/>
    : null
  const discussionText = item?.platform === 'linuxdo' ? <DiscussionFallback discussion={item.discussion?.posts?.length ? <DiscussionReader discussion={item.discussion} sourceURL={item.url} viewCount={item.viewCount} likeCount={item.likeCount} notes={annotations} focus={textFocus} onQuote={quoteText} onOpenNotes={revealNotes} onUnresolved={onUnresolved} onDiscussionChange={updateDiscussion}/> : undefined} loading={detailLoading} error={detailError} onRetry={refreshDetails} onVerify={detailRequiresVerification && capabilities.platformWebViewLogin ? () => { void verifyLinuxdo() } : undefined}>{sourceText || <article className="article-reader"><p>{item.description || '话题正文暂不可用，可打开原内容查看。'}</p></article>}</DiscussionFallback>
    : null
  const videoLayout = Boolean(video || item?.kind === 'video')
  const audioLayout = item?.kind === 'audio'
  const heading = <>{item ? <BilingualTitle heading contentId={item.id} text={item.title}/> : <h1>内容阅读</h1>}{item && <p className="reading-meta">{item.authorId && onCreator && creatorViewSupported(item.platform) ? <Button variant="quiet" type="button" className="reader-author-link" aria-label={`查看 ${item.author || '未知作者'} 的最近内容`} title={`查看 ${item.author || '未知作者'} 的最近内容`} onClick={() => onCreator(item.platform, item.authorId)}>{item.author || '未知作者'}</Button> : item.author || '未知作者'} · <ReaderPublication key={item.id} item={item}/></p>}</>
  const player = video
  const videoDetails = <div className="watch-details">{heading}{description}</div>
  const onlineVideoRequired = Boolean(item?.kind === 'video' && !video && !local && ((item.platform === 'rss' || item.platform === 'xiaohongshu') && item.mediaUrl || item.platform === 'douyin'))
  const compatibilityMessage = item?.platform === 'douyin' ? (douyinPlayback.error || '正在准备抖音视频…') : compatibility.message
  const douyinDetails = douyinPlayback.diagnostics.length > 0 && <details className="douyin-playback-details"><summary>详情</summary><ol>{douyinPlayback.diagnostics.map((stage, index) => <li key={`${stage.stage}-${index}`}><div className="douyin-diagnostic-heading"><strong>{diagnosticStageName(stage.stage)}</strong><span data-outcome={stage.outcome}>{diagnosticOutcomeName(stage.outcome)}</span></div>{diagnosticStageFacts(stage).length > 0 && <p>{diagnosticStageFacts(stage).join(' · ')}</p>}</li>)}</ol></details>
  const onlineSource = item?.platform === 'douyin' ? douyinPlayback.source : (compatibility.source || item?.mediaUrl || '')
  return <section className={`media-reader${item?.kind === 'article' ? ' article-workspace' : ''}${item?.kind === 'pdf' ? ' document-workspace' : ''}${videoLayout ? ' video-workspace' : ''}${audioLayout ? ' audio-workspace' : ''}`}>
    <div className="reading-nav"><Button variant="secondary" className="button button-secondary" title="返回列表" onClick={onReturn}><ArrowLeft size={16}/>返回列表</Button><span>{item?mediaLabel(item):'内容阅读'}</span><ReaderNavigationSlot/><ReaderActionsSlot/>{item?.platform==='xiaohongshu'&&<Button variant="quiet" iconOnly className="icon-button" aria-label="刷新笔记详情" title="刷新笔记详情" disabled={detailLoading} onClick={refreshDetails}><RotateCw size={16}/></Button>}{item && <a className="button button-secondary reader-original-link" aria-label={item.kind==='pdf'?'打开 PDF 原文件':'打开原内容'} title={item.kind==='pdf'?'打开 PDF 原文件':'打开原内容'} href={item.kind==='pdf' ? (item.platform === 'pdf' ? '/api/documents/'+item.platformId+'/file' : item.mediaUrl || item.url) : item.url} target="_blank" rel="noopener noreferrer"><span className="visually-hidden">{item.kind==='pdf'?'打开 PDF 原文件':'打开原内容'}</span><ExternalLink size={15} aria-hidden="true"/></a>}</div>
    {!videoLayout && !audioLayout && heading}
    {item?.paper && <PaperInfoCard paper={item.paper}/>}
    {error&&<div className={`error-panel${social?.[0]==='xiaohongshu'?' reader-source-error':''}`} role="alert"><p>{error}</p>{localReadFailed?<div className="reader-source-error-actions"><Button variant="secondary" className="button button-secondary" onClick={retryLocalRead}><RotateCw size={14}/>重新读取</Button></div>:social?.[0]==='xiaohongshu'?<div className="reader-source-error-actions"><Button variant="secondary" className="button button-secondary" onClick={refreshDetails}>重新读取</Button><Button variant="secondary" className="button button-secondary" onClick={()=>setSourceEditing(true)}>更新链接</Button><a className="button button-secondary" href="/tools#accounts">检查登录</a></div>:<div className="reader-source-error-actions"><Button variant="secondary" className="button button-secondary" onClick={refreshDetails}>重新读取</Button>{errorRequiresVerification && id.startsWith('linuxdo:') && capabilities.platformWebViewLogin && <Button variant="secondary" className="button button-secondary" onClick={() => { void verifyLinuxdo() }}>重新验证</Button>}</div>}</div>}
    {sourceEditing && <XiaohongshuSourceForm key={id} id={id} onClose={()=>setSourceEditing(false)} onUpdated={detail=>{
      onSourceUpdated(detail)
    }}/>}
    {!item&&!error&&<p role="status" className="field-hint">正在读取内容…</p>}
      <ReadingNotebook enabled={Boolean(notes || insights || reading)} ai={insights} contentLabel={videoLayout ? '字幕与正文' : audioLayout ? '逐字稿与正文' : '正文'}><div className="reader-primary" ref={body} onMouseUp={captureQuote} onKeyUp={captureQuote}>{videoLayout && videoDetails}{player}{(!item||item.kind==='video'&&Boolean(video))&&reading}
      {audioLayout && item && <div className="listen-heading"><PodcastArtwork key={item.id + item.thumbnailUrl} item={item} className="listen-artwork" resolveMissing={Boolean(item.mediaUrl)}/><div>{heading}</div></div>}
      {detailLoading && item?.platform === 'xiaohongshu' && <p className="field-hint" role="status">正在读取笔记正文与图片…</p>}
      {detailError && item?.platform === 'xiaohongshu' && <div className="error-panel reader-source-error" role="alert"><p>{detailError}</p><div className="reader-source-error-actions"><Button variant="secondary" className="button button-secondary" onClick={refreshDetails}><RotateCw size={14}/>重新获取笔记</Button><Button variant="secondary" className="button button-secondary" onClick={()=>setSourceEditing(true)}>更新链接</Button><a className="button button-secondary" href="/tools#accounts">检查登录</a></div></div>}
      {item && (item.kind==='pdf'?((item.platform==='pdf' || item.paper?.documentId)?<PDFReader id={item.paper?.documentId ?? item.platformId} contentId={item.id} paper={item.paper} {...pdfAnnotations}/>:item.paper?.pdfUrl || item.mediaUrl ? <FeedDocumentReader url={item.paper?.pdfUrl ?? item.mediaUrl!} annotations={pdfAnnotations}/>:<p className="field-hint">来源没有提供 PDF 文件地址。</p>):<>
        {item.kind==='audio'&&<div className="audio-reader">{item.mediaUrl?<><audio ref={bindMedia} aria-label="播客播放器" controls preload="none" src={item.mediaUrl} onLoadedMetadata={audioLoaded} onTimeUpdate={report} onSeeking={report} onSeeked={report} onPause={report} onError={()=>{setAudioError(true);onReady?.(false);onPosition?.(null)}}/>{audioError&&<div className="audio-playback-error" role="alert"><p>音频暂时无法播放，可重新连接或打开原内容收听。</p><Button variant="secondary" type="button" className="button button-secondary" onClick={reconnectAudio}><RotateCw size={14}/>重新连接音频</Button></div>}</>:<p className="field-hint">这份内容没有可播放的公开音频地址，可在原站收听。</p>}</div>}
        {item.kind==='audio'&&item.mediaUrl&&<AudioControls media={native} identity={`${id}:${item.mediaUrl}`}/>}
        {item.kind==='audio'&&item.mediaUrl&&<NativeReadingProgress contentId={id} media={native} identity={`${id}:${item.mediaUrl}`}/>}
        {audioLayout && description}
        {item.kind==='audio'&&reading}
        {item.kind === 'video' && !video && (onlineVideoRequired ? (item.platform === 'douyin' ? (!douyinPlayback.source ? <div className={douyinPlayback.error ? 'error-panel' : 'field-hint'} role={douyinPlayback.error ? 'alert' : 'status'}><p>{compatibilityMessage}</p>{douyinDetails}<div className="reader-source-error-actions"><Button variant="secondary" className="button button-secondary" onClick={douyinPlayback.start}><RotateCw size={14}/>重试</Button>{douyinPlayback.error && <a className="button button-secondary" href={item.url} target="_blank" rel="noopener noreferrer">打开原内容<ExternalLink size={15}/></a>}</div></div> : <video ref={bindMedia} onLoadedMetadata={videoLoaded} onPlaying={onlineVideoPlaying} onTimeUpdate={report} onSeeking={report} onSeeked={report} onPause={report} onError={onlineVideoFailed} className="local-video" aria-label="抖音在线视频播放器" controls playsInline preload="metadata" poster={item.thumbnailUrl} src={onlineSource}/>) : (compatibilityBlocked || !hasPlayableOnlineSource(item.mediaUrl, compatibility.source) ? <div className={compatibility.error ? 'error-panel' : 'field-hint'} role={compatibility.error ? 'alert' : 'status'}><p>{compatibilityMessage}</p><div className="reader-source-error-actions">{compatibility.error && <Button variant="secondary" className="button button-secondary" onClick={compatibility.start}><RotateCw size={14}/>重试</Button>}{compatibility.error && <a className="button button-secondary" href={'/downloads?url=' + encodeURIComponent(item.url)}><Download size={14}/>下载视频</a>}{!compatibility.error && <Button variant="secondary" className="button button-secondary" onClick={compatibility.cancel}>取消兼容处理</Button>}</div></div> : <video ref={bindMedia} onLoadedMetadata={videoLoaded} onTimeUpdate={report} onSeeking={report} onSeeked={report} onPause={report} onError={onlineVideoFailed} className="local-video" controls playsInline preload="metadata" poster={item.thumbnailUrl} src={onlineSource}/>)) : local ? <video ref={bindMedia} onLoadedMetadata={() => { onReady?.(true); report() }} className="local-video" controls playsInline preload="metadata" src={'/api/downloads/' + encodeURIComponent(local.id) + '/media'}/> : (item.platform === 'bilibili' || item.platform === 'youtube') ? <IframePlayer ref={playbackRef} item={item} onReady={onReady} onPosition={onPosition} initialTime={0}/> : !detailLoading && (item.platform === 'xiaohongshu' ? <div className="field-hint"><p>小红书成功读取了笔记正文，但没有提供可用的视频地址。可重新获取笔记，或在原站确认视频可播放。</p><div className="reader-source-error-actions"><Button variant="secondary" className="button button-secondary" onClick={refreshDetails}><RotateCw size={14}/>重新获取笔记</Button><a className="button button-secondary" href={item.url} target="_blank" rel="noopener noreferrer">打开原内容<ExternalLink size={15}/></a></div></div> : <p className="field-hint">来源未提供可播放的视频地址，可打开原内容查看。</p>))}
        {item.kind==='video'&&!video&&!compatibilityBlocked&&(local || ((item.platform==='rss'||item.platform==='xiaohongshu')&&item.mediaUrl) || compatibility.source || douyinPlayback.source)&&<NativeReadingProgress contentId={id} media={native} identity={`${id}:${local?.id ?? (douyinPlayback.source || compatibility.source || item.mediaUrl)}`}/>}
        {item.kind==='video'&&!video&&reading}
        {item.kind==='image'&&<ImageAlbum key={item.id} item={item} onRefresh={item.platform==='xiaohongshu'?refreshDetails:undefined} onUpdateSource={item.platform==='xiaohongshu'?()=>setSourceEditing(true):undefined} refreshing={detailLoading}/>}

        {item.kind==='audio'&&!reading&&<p className="field-hint">当前来源未提供可用的逐字字幕，下面显示节目说明。</p>}
        {item?.platform === 'linuxdo' ? discussionText : description ? !notes && !videoLayout && !audioLayout && description : item.kind==='article'&&item.platform==='rss'?<FullTextArticle key={item.id} item={item} notes={annotations} focus={textFocus} onQuote={quoteText} onOpenNotes={revealNotes} onUnresolved={onUnresolved} navigationTarget={notesNavigation} onReturnedToReading={returnedToReading}/>:sourceText ? !textAboveNotes && sourceText : <article className="article-reader"><h2>{item.kind==='audio'?'节目说明':'内容简介'}</h2><p>{item.description||'来源没有提供正文，可打开原内容查看。'}</p>{item.platform==='rss'&&<p className="field-hint">显示订阅源提供的文字；摘要源可能不包含全文。</p>}</article>}
      </>)}
      {quote&&onQuote&&<Button variant="secondary" className="button button-secondary reader-quote" onClick={()=>{onQuote(quote);setQuote('')}}><StickyNote size={15}/>引用选中文字到批注</Button>}
      </div>{notes&&<aside className="reading-notes" ref={notesRegion} tabIndex={-1} aria-label="当前内容笔记">{!videoLayout && !audioLayout && description}{textAboveNotes && <section className="reader-source-text" aria-label="来源正文">{sourceText}</section>}{notes}</aside>}</ReadingNotebook>
    {notes && item?.kind === 'article' && <div ref={setNotesNavigation} className="mobile-reader-notes-nav" aria-label="阅读与笔记"><Button variant="quiet" ref={notesShortcut} type="button" title="笔记" onClick={openNotes}><StickyNote size={16}/>笔记</Button>{notesVisited && <Button variant="quiet" type="button" className="mobile-reader-resume" onClick={resumeReading}><BookOpen size={16}/>继续阅读</Button>}</div>}

  </section>
}
