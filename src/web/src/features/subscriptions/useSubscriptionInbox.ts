import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from '../../shared/api/client'
import type { SavedViewFilters, SavedViewInboxPage, SubscriptionInboxPage } from '../../shared/api/types'
import { useInboxPageSize } from '../settings/useInboxPageSize'
import { emptySavedViewFilters, relativeDateFilterTimestamp } from './savedViewDefinition'

export type InboxFilters = SavedViewFilters
export const emptyFilters: InboxFilters = emptySavedViewFilters
const emptyPage: SubscriptionInboxPage = { entries: [], sources: [], nextCursor: '' }

// Keep cursors rather than every visited page's full descriptions/media data.
// Back navigation re-reads a page using its original time-filter snapshot.
export function useSubscriptionInbox(active: boolean, savedViewID = '') {
  const { pageSize } = useInboxPageSize()
  const loadedPageSize = useRef(pageSize)
  const [filters, setFilters] = useState<InboxFilters>(emptyFilters)
  const [page, setPage] = useState(emptyPage)
  const [count, setCount] = useState(0)
  const [cursors, setCursors] = useState([''])
  const [pageIndex, setPageIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const confirmedFilters = useRef(emptyFilters)
  const since = useRef(0)
  const generation = useRef(0)
  const skipViewReset = useRef(false)
  const loadedViewID = useRef(savedViewID)

  const load = useCallback(async (nextFilters: InboxFilters, cursor = '', index = 0, savedViewOverride?: string) => {
    controller.current?.abort()
    const current = new AbortController(), token = ++generation.current
    controller.current = current
    setLoading(true); setError('')
    const viewID = savedViewOverride === undefined ? savedViewID : savedViewOverride
    const resolvedSince = index === 0 ? nextFilters.since || relativeDateFilterTimestamp(nextFilters.sinceOffset) : since.current
    const params = viewID ? new URLSearchParams({ cursor, limit: String(pageSize), cards: 'true' }) : new URLSearchParams({
      q: nextFilters.query, sourceId: nextFilters.sourceId, groupId: nextFilters.groupId,
      platform: nextFilters.platform, kind: nextFilters.kind, topic: nextFilters.topic, tag: nextFilters.tag,
      read: nextFilters.read, favorite: String(nextFilters.favorite), since: String(resolvedSince),
      until: nextFilters.until ? String(nextFilters.until) : '', cursor, limit: String(pageSize), cards: 'true',
    })
    for (const [key, value] of params) if (!value) params.delete(key)
    try {
      const path = viewID ? `/saved-views/${encodeURIComponent(viewID)}/inbox?${params}` : `/subscription-inbox?${params}`
      const response = await request<SubscriptionInboxPage | SavedViewInboxPage>(path, { signal: current.signal })
      if (current.signal.aborted || token !== generation.current) return false
      const result = 'page' in response ? response.page : response
      setCursors(old => index === 0 ? [''] : [...old.slice(0, index), cursor])
      setPageIndex(index)
      since.current = resolvedSince
      setPage(result); setFilters(nextFilters); confirmedFilters.current = nextFilters; setConfirmed(true)
      setCount('page' in response ? response.count : result.entries.length)
      return true
    } catch (cause) {
      if (!current.signal.aborted && token === generation.current) setError(cause instanceof Error ? cause.message : '收件箱暂时无法读取。')
      return false
    } finally {
      if (controller.current === current) controller.current = null
      if (!current.signal.aborted && token === generation.current) setLoading(false)
    }
  }, [savedViewID, pageSize])
  const reset = useCallback(() => {
    controller.current?.abort(); ++generation.current
    setPage(emptyPage); setCursors(['']); setPageIndex(0); setConfirmed(false); setLoading(false); setError('')
  }, [])
  useEffect(() => {
    if (loadedViewID.current === savedViewID) return
    loadedViewID.current = savedViewID
    if (skipViewReset.current) { skipViewReset.current = false; return }
    reset()
  }, [savedViewID, reset])
  useEffect(() => {
    if (loadedPageSize.current === pageSize) return
    loadedPageSize.current = pageSize
    reset()
  }, [pageSize, reset])
  useEffect(() => { if (active && !confirmed && !loading && !error) void load(confirmedFilters.current) }, [active, confirmed, loading, error, load])
  useEffect(() => {
    if (!active) { controller.current?.abort(); ++generation.current; setLoading(false) }
    return () => { controller.current?.abort() }
  }, [active])
  const apply = (next: InboxFilters) => {
    setFilters(next)
    confirmedFilters.current = next
    if (savedViewID) skipViewReset.current = true
    return load(next, '', 0, '')
  }
  return {
    filters, page, count, loading, error, confirmed, pageNumber: pageIndex + 1, hasPrevious: pageIndex > 0,
    apply, selectSavedView: reset,
    updateSavedView: (next: InboxFilters) => load(next), reload: () => load(confirmedFilters.current),
    next: () => !loading && page.nextCursor ? load(confirmedFilters.current, page.nextCursor, pageIndex + 1) : Promise.resolve(false),
    back: () => !loading && pageIndex > 0 ? load(confirmedFilters.current, cursors[pageIndex - 1], pageIndex - 1) : Promise.resolve(false),
  }
}
