import { useEffect, useRef, useState } from 'react'
import type { ContentItem, DownloadJob } from '../../shared/api/types'
import { APIError, request } from '../../shared/api/client'
import { cachedNote, cacheNote, sameNoteLocator } from '../../shared/data/noteDetails'
import { rememberPublicationItem } from '../../shared/data/publicationDetails'
import { readFullContent } from '../../shared/data/fullContent'

class LocalNoteReadError extends Error {
  constructor() { super('本机笔记读取失败，已有内容未删除，请重新读取。') }
}

type SocialSource = [platform: string, id: string]

export interface ReaderContentState {
  item: ContentItem | null
  error: string
  errorRequiresVerification: boolean
  localReadFailed: boolean
  retryLocalRead: () => void
  social: SocialSource | null
  localSocial?: DownloadJob
  waitingForDownloads: boolean
  refreshDetails: () => void
  detailError: string
  detailRequiresVerification: boolean
  detailLoading: boolean
  detailRead: boolean
  sourceEditing: boolean
  setSourceEditing: (editing: boolean) => void
  onSourceUpdated: (detail: ContentItem) => void
}

interface ReaderContentOptions {
  id: string
  initialItem?: ContentItem
  jobs: DownloadJob[]
  jobsLoading: boolean
  onItem?: (item: ContentItem) => void
}

export function useReaderContent({ id, initialItem, jobs, jobsLoading, onItem }: ReaderContentOptions): ReaderContentState {
  const social = /^(douyin:[1-9][0-9]{15,19}|xiaohongshu:[a-f0-9]{24})$/.test(id) ? id.split(':') as SocialSource : null
  const localSocial = social
    ? jobs.find(job => job.state === 'completed' && job.mode !== 'audio' && (social[0] === 'douyin'
      ? job.url === 'https://www.douyin.com/video/' + social[1]
      : /^https:\/\/www\.xiaohongshu\.com\/explore\/([a-f0-9]{24})(?:\?|$)/.exec(job.url)?.[1] === social[1]))
    : undefined
  const waitingForDownloads = Boolean(social && jobsLoading && initialItem?.id !== id)
  const [item, setItem] = useState<ContentItem | null>(initialItem ?? null)
  const [error, setError] = useState('')
  const [errorRequiresVerification, setErrorRequiresVerification] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [localAttempt, setLocalAttempt] = useState(0)
  const [localReadFailed, setLocalReadFailed] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailRequiresVerification, setDetailRequiresVerification] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailRead, setDetailRead] = useState(false)
  const [sourceEditing, setSourceEditing] = useState(false)
  const storedDetail = useRef<{ key: string; value: { item: ContentItem | null; complete: boolean } } | null>(null)
  const detailCompleted = useRef('')
  const detailFailure = useRef<{ key: string; message: string } | null>(null)

  function refreshDetails() {
    setLocalAttempt(0)
    setAttempt(value => value + 1)
  }

  function retryLocalRead() {
    setLocalAttempt(value => value + 1)
  }

  useEffect(() => setSourceEditing(false), [id])

  useEffect(() => {
    if (waitingForDownloads) {
      setItem(null)
      setError('')
      return
    }
    const controller = new AbortController()
    setError('')
    setErrorRequiresVerification(false)
    setDetailError('')
    setDetailRequiresVerification(false)
    setDetailLoading(false)
    setDetailRead(false)
    setLocalReadFailed(false)
    setItem(previous => attempt > 0 && previous?.id === id ? previous : initialItem?.id === id ? initialItem : null)
    let localDetail: Promise<{ item: ContentItem | null; complete: boolean }> | undefined

    function readLocalDetail() {
      const key = `${id}:${attempt}:${localAttempt}`
      if (storedDetail.current?.key === key) return Promise.resolve(storedDetail.current.value)
      return localDetail ??= request<{ item: ContentItem | null; complete: boolean }>('/xiaohongshu/details/' + encodeURIComponent(id), { signal: controller.signal })
        .then(value => {
          if (!controller.signal.aborted) storedDetail.current = { key, value }
          return value
        })
        .catch(cause => {
          if (controller.signal.aborted) throw cause
          const fallback = cachedNote(id)
          if (fallback) setItem(previous => previous?.id === id ? previous : fallback)
          throw new LocalNoteReadError()
        })
    }

    async function resolve(): Promise<ContentItem | undefined> {
      if (initialItem?.id === id && initialItem.partial) return readFullContent(initialItem, controller.signal)
      if (initialItem?.id === id && !initialItem.partial && (initialItem.platform !== 'linuxdo' || initialItem.discussion)) return initialItem
      try {
        return await request<ContentItem>('/library/' + encodeURIComponent(id), { signal: controller.signal })
      } catch (cause) {
        if (!(cause instanceof APIError && cause.status === 404)) throw cause
      }
      if (initialItem?.id === id) return initialItem
      if (id.startsWith('pdf:')) return request<ContentItem>('/documents/' + encodeURIComponent(id.slice(4)), { signal: controller.signal })
      if (id.startsWith('youtube:')) {
        const feed = await request<{ items: ContentItem[] }>('/discovery/youtube?q=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id.slice(8)), { signal: controller.signal })
        return feed.items[0]
      }
      if (social) {
        if (social[0] === 'xiaohongshu') {
          const cached = attempt === 0 ? cachedNote(id) : undefined
          if (cached) setItem(cached)
          const stored = await readLocalDetail()
          if (stored.item?.id === id) return stored.item
          if (cached) return cached
          if (localAttempt > 0) throw new Error('本机尚未保存这篇笔记，可刷新详情或更新分享链接。')
        }
        if (localSocial) return { id, platform: social[0], platformId: social[1], kind: 'video' as const, title: localSocial.title || id, url: localSocial.url, author: '', authorId: '', thumbnailUrl: '', description: '', durationSeconds: 0, publishedAt: 0 }
        const original = social[0] === 'douyin' ? 'https://www.douyin.com/video/' + social[1] : 'https://www.xiaohongshu.com/explore/' + social[1]
        const feed = await request<{ items: ContentItem[] }>('/discovery/' + social[0] + '?q=' + encodeURIComponent(original), { signal: controller.signal })
        if (social[0] === 'xiaohongshu' && feed.items[0] && !controller.signal.aborted) cacheNote(feed.items[0])
        return feed.items[0]
      }
      if (id.startsWith('xiaoyuzhou:')) {
        const feed = await request<{ items: ContentItem[] }>('/discovery/xiaoyuzhou?q=' + encodeURIComponent('https://www.xiaoyuzhoufm.com/episode/' + id.slice(11)), { signal: controller.signal })
        if (feed.items[0]) rememberPublicationItem(feed.items[0])
        return feed.items[0]
      }
      if (id.startsWith('rss:')) return request<ContentItem>('/subscription-inbox/' + encodeURIComponent(id), { signal: controller.signal })
      if (id.startsWith('linuxdo:')) {
        const feed = await request<{ items: ContentItem[] }>('/discovery/linuxdo?q=' + encodeURIComponent('https://linux.do/t/' + id.slice(8)), { signal: controller.signal })
        return feed.items[0]
      }
      throw new Error('这份内容还未收藏，请返回来源再次获取。')
    }

    void resolve().then(async value => {
      if (controller.signal.aborted || !value) return
      if (value.platform === 'xiaoyuzhou' && !value.mediaUrl) {
        const feed = await request<{ items: ContentItem[] }>('/discovery/xiaoyuzhou?q=' + encodeURIComponent(value.url), { signal: controller.signal })
        const detail = feed.items.find(candidate => candidate.id === id)
        if (controller.signal.aborted) return
        if (detail) {
          rememberPublicationItem(detail)
          value = detail
        }
      }
      const resolvedValue = value
      setItem(previous => attempt > 0 && previous?.id === id && resolvedValue.platform !== 'xiaoyuzhou' ? previous : resolvedValue)
      if (value.platform !== 'xiaohongshu') return
      const stored = await readLocalDetail()
      if (controller.signal.aborted) return
      if (stored.item?.id === id) {
        const storedURL = new URL(stored.item.url)
        if (!new URL(value.url).searchParams.has('xsec_token') && storedURL.searchParams.has('xsec_token')) value = { ...value, url: stored.item.url }
        if (stored.complete) {
          const detail = { ...stored.item, url: value.url }
          setItem(previous => attempt > 0 && previous?.id === id ? previous : detail)
          if ((attempt === 0 || localAttempt > 0) && sameNoteLocator(stored.item.url, value.url) && (stored.item.kind !== 'video' || localSocial || localAttempt > 0)) {
            cacheNote(detail)
            setItem(detail)
            setDetailRead(true)
            return
          }
        }
      }
      const cached = cachedNote(id)
      if (cached && sameNoteLocator(cached.url, value.url) && (!stored.complete || stored.item?.id === id && sameNoteLocator(stored.item.url, value.url)) && (attempt === 0 || localAttempt > 0 || detailCompleted.current === `${id}:${attempt}`)) {
        const preferred = stored.complete && stored.item?.id === id ? stored.item : cached
        const detail = new URL(value.url).searchParams.has('xsec_token') ? { ...preferred, url: value.url } : preferred
        cacheNote(detail)
        setItem(detail)
        setDetailRead(true)
        return
      }
      if (localSocial && attempt === 0) return
      if (localAttempt > 0) {
        setDetailError('本机尚未保存完整内容，可重新获取笔记。')
        return
      }
      const detailKey = `${id}:${attempt}:${value.url}`
      if (detailFailure.current?.key === detailKey) {
        setDetailError(detailFailure.current.message)
        return
      }
      setDetailLoading(true)
      try {
        const feed = await request<{ items: ContentItem[] }>('/discovery/xiaohongshu?q=' + encodeURIComponent(value.url), { signal: controller.signal })
        const detail = feed.items.find(candidate => candidate.id === id)
        if (!detail) throw new Error('未能读取这篇笔记的详情，请重试。')
        if (!controller.signal.aborted) {
          storedDetail.current = { key: `${id}:${attempt}:${localAttempt}`, value: { item: detail, complete: true } }
          detailFailure.current = null
          detailCompleted.current = `${id}:${attempt}`
          cacheNote(detail)
          setItem(detail)
          setDetailRead(true)
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          const message = cause instanceof Error ? cause.message : '笔记详情暂时无法读取。'
          detailFailure.current = { key: detailKey, message }
          setDetailError(message)
        }
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false)
      }
    }).catch(cause => {
      if (!controller.signal.aborted) {
        setLocalReadFailed(cause instanceof LocalNoteReadError)
        setErrorRequiresVerification(cause instanceof APIError && cause.code === 'platform_restricted')
        setError(cause instanceof Error ? cause.message : '内容暂不可用。')
      }
    })
    return () => controller.abort()
  }, [id, initialItem?.id, initialItem?.url, initialItem?.platform !== 'xiaohongshu' ? initialItem?.description : undefined, attempt, localAttempt, localSocial?.id, waitingForDownloads])

  useEffect(() => {
    if (item && (item.platform !== 'xiaohongshu' || detailRead || detailError || localSocial)) onItem?.(item)
  }, [item, onItem, detailRead, detailError, localSocial?.id])

  useEffect(() => {
    if (item?.platform !== 'linuxdo' || item.discussion?.posts.length) return
    const controller = new AbortController()
    setDetailLoading(true)
    setDetailError('')
    setDetailRequiresVerification(false)
    void request<{ items: ContentItem[] }>('/discovery/linuxdo?q=' + encodeURIComponent(item.url), { signal: controller.signal }).then(async feed => {
      const fetched = feed.items.find(candidate => candidate.id === id && candidate.platform === 'linuxdo' && candidate.discussion)
      if (!fetched) throw new Error('未能读取话题楼层，请重试。')
      if (controller.signal.aborted) return
      let detail: ContentItem = { ...fetched, savedAt: item.savedAt }
      if (item.savedAt) {
        try {
          detail = await request<ContentItem>('/library', { method: 'POST', body: JSON.stringify(detail) })
        } catch {
          // The freshly fetched discussion remains available for this reading session.
        }
      }
      if (!controller.signal.aborted) {
        setDetailLoading(false)
        setItem(detail)
        onItem?.(detail)
      }
    }).catch(cause => {
      if (!controller.signal.aborted) {
        setDetailRequiresVerification(cause instanceof APIError && cause.code === 'platform_restricted')
        setDetailError(cause instanceof Error ? cause.message : '话题楼层暂时无法读取。')
      }
    }).finally(() => {
      if (!controller.signal.aborted) setDetailLoading(false)
    })
    return () => controller.abort()
  }, [id, item?.platform, item?.url, Boolean(item?.discussion?.posts.length), attempt, onItem])

  function onSourceUpdated(detail: ContentItem) {
    storedDetail.current = { key: `${id}:${attempt}:${localAttempt}`, value: { item: detail, complete: true } }
    cacheNote(detail)
    detailFailure.current = null
    setItem(detail)
    setDetailRead(true)
    setError('')
    setDetailError('')
    setSourceEditing(false)
  }

  return { item, error, errorRequiresVerification, localReadFailed, retryLocalRead, social, localSocial, waitingForDownloads, refreshDetails, detailError, detailRequiresVerification, detailLoading, detailRead, sourceEditing, setSourceEditing, onSourceUpdated }
}
