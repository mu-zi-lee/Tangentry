import { Button } from '../../components/ui'
import type { SubtitleAssistance } from '../../shared/ui/subtitleAssistance'
import { ArrowLeft, ExternalLink, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { request } from '../../shared/api/client'
import type { ContentItem, Feed, SubtitleAvailability, SubtitleLanguage, SubtitleTrack, SubtitleReference } from '../../shared/api/types'
import { formatDate, formatDuration } from '../../shared/ui/ContentCard'
import { SubtitleReader } from './SubtitleReader'
import { BilingualTitle } from '../ai/TextTranslation'
import { ReaderActionsSlot, ReaderNavigationSlot } from '../../shared/reader/ReaderActions'
import { ReadingNotebook } from '../../shared/reader/ReadingNotebook'
import { ReaderDescription } from '../reader/ReaderDescription'
import '../reader/reader.css'
import '../reader/watch.css'

function SubtitlePlayer({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function SubtitlePage({ query, initialItem, onItem, onReturn, notes, insights, onNoteAt, player, position, ended = false, onSeek, onTrackChange, onPlatformLanguagesChange, onAvailabilityChange, assistance, audioStream }: {
  query: string; initialItem?: ContentItem; onReturn: () => void; notes?: ReactNode; insights?: ReactNode; onNoteAt?: (position: number, reference?: SubtitleReference) => void
  onItem?: (item: ContentItem) => void
  assistance?: SubtitleAssistance
  player?: ReactNode; position?: number | null; ended?: boolean; onSeek?: (position: number) => void; onTrackChange?: (track: SubtitleTrack | null) => void; onPlatformLanguagesChange?: (languages: SubtitleLanguage[]) => void; onAvailabilityChange?: (status: SubtitleAvailability | 'available' | 'login_required' | null) => void; audioStream?: MediaStream | null
}) {
  const [item, setItem] = useState<ContentItem | null>(initialItem ?? null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const valid = /^BV[0-9A-Za-z]{10}$/.test(query)

  useEffect(() => {
    if (!valid) return
    if (initialItem?.platformId === query) { setItem(initialItem); onItem?.(initialItem); setError(''); return }
    const controller = new AbortController()
    setError('')
    void request<Feed>(`/discovery/bilibili?q=${encodeURIComponent(query)}&page=1`, { signal: controller.signal }).then(feed => {
      const video = feed.items.find(candidate => candidate.platformId === query)
      if (!video) throw new Error('没有找到这段视频，请返回列表重试。')
      if (!controller.signal.aborted) { setItem(video); onItem?.(video) }
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '视频信息暂时无法获取。')
    })
    return () => controller.abort()
  }, [query, initialItem, onItem, valid, attempt])

  return <section className="subtitle-page video-workspace">
    <div className="reading-nav"><Button variant="secondary" className="button button-secondary" onClick={onReturn}><ArrowLeft size={16} />返回列表</Button><span>视频阅读 · 第一分 P</span><ReaderNavigationSlot/><ReaderActionsSlot/><a className="button button-secondary reader-original-link" href={`https://www.bilibili.com/video/${query}/`} target="_blank" rel="noopener noreferrer" aria-label="打开原视频" title="打开原视频"><span className="visually-hidden">打开原视频</span><ExternalLink size={15} aria-hidden="true" /></a></div>
    {!valid ? <><h1 className="reading-title">视频阅读</h1><p role="alert" className="subtitle-error">阅读地址缺少正确的视频 BV 号，请返回列表选择视频。</p></> : <>
      <ReadingNotebook enabled={Boolean(notes || insights)} ai={insights} contentLabel="字幕"><div className="reader-primary">
        <div className="watch-details">{item ? <BilingualTitle heading contentId={item.id} text={item.title}/> : <h1 className="reading-video-title">{query}</h1>}
        {item && <p className="reading-meta">{item.author || '未知作者'} · {formatDate(item.publishedAt)}{item.durationSeconds > 0 && ` · ${formatDuration(item.durationSeconds)}`}</p>}
        {item?.description && <ReaderDescription key={item.id} item={item} onSeek={onSeek} className="watch-description"/>}</div><SubtitlePlayer>{player}</SubtitlePlayer>
        {error ? <div className="subtitle-error" role="alert"><p>{error}</p><Button variant="secondary" className="button button-secondary" onClick={() => setAttempt(value => value + 1)}>重新获取视频信息</Button></div> : !item && <p className="subtitle-note" role="status"><LoaderCircle size={16} className="spin" />正在获取视频信息…</p>}<SubtitleReader key={query} item={item ?? { platformId: query, url: `https://www.bilibili.com/video/${query}/` }} onNoteAt={onNoteAt} position={position} ended={ended} onSeek={onSeek} onTrackChange={onTrackChange} onPlatformLanguagesChange={onPlatformLanguagesChange} onAvailabilityChange={onAvailabilityChange} assistance={assistance} audioStream={audioStream} /></div><aside className="reading-notes">{notes}</aside></ReadingNotebook>
    </>}
  </section>
}
