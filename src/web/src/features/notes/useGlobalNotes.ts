import { useCallback, useEffect, useRef, useState } from 'react'
import { APIError, request } from '../../shared/api/client'
import type { ReadingNote } from '../../shared/api/types'
import { notifyNotesChanged, subscribeNotesChanged } from './changes'
import { dateRange } from './timeline'
import type { NoteViewSelection } from './savedViews'
import { changeTaskState } from './taskList'

interface Filters { tag: string; from: number; to: number; pinnedOnly?: boolean }
interface Page extends Filters { notes: ReadingNote[]; nextCursor: string; query: string }
interface TagCount { tag: string; count: number }
const noFilters: Filters = { tag: '', from: 0, to: 0 }
const keyOf = (text: string, filters: Filters) => JSON.stringify([text, filters.tag, filters.from, filters.to, Boolean(filters.pinnedOnly)])
export function useGlobalNotes(active: boolean) {
  const [notes, setNotes] = useState<ReadingNote[]>([])
  const [query, setQuery] = useState('')
  const [draftQuery, setDraftQuery] = useState('')
  const [draftTag, setDraftTag] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [filters, setFilters] = useState<Filters>(noFilters)
  const [tags, setTags] = useState<TagCount[]>([])
  const [tagsError, setTagsError] = useState('')
  const [nextCursor, setNextCursor] = useState('')
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasResult, setHasResult] = useState(false)
  const [pinPending, setPinPending] = useState<Set<string>>(new Set())
  const pinRequests = useRef(new Set<string>())
  const [pinError, setPinError] = useState('')
  const [taskPending, setTaskPending] = useState<Set<string>>(new Set())
  const [taskError, setTaskError] = useState('')
  const taskRequests = useRef(new Map<string, AbortController>())
  const [removePending, setRemovePending] = useState<Set<string>>(new Set())
  const [removeError, setRemoveError] = useState<{ id: string; message: string } | null>(null)
  const removeRequests = useRef(new Map<string, AbortController>())
  const reader = useRef<AbortController | null>(null)
  const tagReader = useRef<AbortController | null>(null)
  const desired = useRef({ query: '', filters: noFilters })
  const activeRef = useRef(active)
  activeRef.current = active
  const loaded = useRef({ key: keyOf('', noFilters), pages: 1, cursor: '' })
  const hasLoaded = useRef(false)

  const load = useCallback(async (text: string, filter: Filters, appendCursor = '') => {
    if (!activeRef.current) return
    reader.current?.abort()
    const controller = new AbortController()
    reader.current = controller
    // Refreshing the list already on screen happens in the background.
    if (appendCursor || !hasLoaded.current || keyOf(text, filter) !== loaded.current.key) setLoading(true)
    setError('')
    try {
      let cursor = appendCursor
      let page: Page | null = null
      const result: ReadingNote[] = []
      const key = keyOf(text, filter)
      const depth = appendCursor ? 1 : key === loaded.current.key ? loaded.current.pages : 1
      let pages = 0
      do {
        const params = new URLSearchParams({ q: text, ...(filter.pinnedOnly ? { pinnedOnly: 'true' } : {}), ...(cursor ? { cursor } : {}), ...(filter.tag ? { tag: filter.tag } : {}), ...(filter.from ? { from: String(filter.from) } : {}), ...(filter.to ? { to: String(filter.to) } : {}) })
        page = await request<Page>(`/notes/search?${params}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        result.push(...page.notes); cursor = page.nextCursor; pages++
      } while (cursor && pages < depth)
      if (controller.signal.aborted || !page) return
      setNotes(previous => [...new Map((appendCursor ? [...previous, ...result] : result).map(note => [note.id, note])).values()])
      setQuery(page.query)
      setFilters({ tag: page.tag ?? '', from: page.from ?? 0, to: page.to ?? 0, pinnedOnly: Boolean(page.pinnedOnly) })
      setNextCursor(cursor); setHasResult(true)
      loaded.current = { key, pages: appendCursor ? loaded.current.pages + 1 : pages, cursor }
      hasLoaded.current = true
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '笔记暂时无法读取。')
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [])

  const reloadTags = useCallback(async () => {
    tagReader.current?.abort()
    const controller = new AbortController(); tagReader.current = controller
    try {
      const result = await request<{ tags: TagCount[] }>('/notes/tags', { signal: controller.signal })
      if (!controller.signal.aborted) { setTags(result.tags); setTagsError('') }
    } catch { if (!controller.signal.aborted) setTagsError('标签暂时无法读取，可以刷新重试。') }
  }, [])
  const reload = useCallback(() => { void load(desired.current.query, desired.current.filters); void reloadTags() }, [load, reloadTags])
  const cancel = () => {
    reader.current?.abort()
    desired.current = { query, filters }
    setLoading(false)
  }
  useEffect(() => {
    if (!active) return
    reload()
    const unsubscribe = subscribeNotesChanged(reload)
    const refresh = () => { if (!document.hidden) reload() }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { reader.current?.abort(); tagReader.current?.abort(); for (const controller of taskRequests.current.values()) controller.abort(); for (const controller of removeRequests.current.values()) controller.abort(); unsubscribe(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [active, reload])

  function search() {
    const range = dateRange(fromDate, toDate)
    if (!range) { setError('请检查日期，结束日期应不早于开始日期。'); return }
    desired.current = { query: draftQuery.trim(), filters: { tag: draftTag, ...range, pinnedOnly: filters.pinnedOnly } }
    void load(desired.current.query, desired.current.filters)
  }
  function applyView(selection: NoteViewSelection) {
    const range = dateRange(selection.fromDate, selection.toDate)
    if (!range) { setError('这个视图的日期筛选无效。'); return }
    setDraftQuery(selection.query); setDraftTag(selection.tag)
    setFromDate(selection.fromDate); setToDate(selection.toDate)
    desired.current = { query: selection.query, filters: { tag: selection.tag, ...range, pinnedOnly: Boolean(selection.pinnedOnly) } }
    void load(desired.current.query, desired.current.filters)
  }
  function filterTag(tag: string) {
    setDraftTag(tag)
    desired.current = { query: query, filters: { ...filters, tag } }
    void load(desired.current.query, desired.current.filters)
  }
  function filterDates(from: string, to: string) {
    const range = dateRange(from, to)
    if (!range) { setError('请检查日期，结束日期应不早于开始日期。'); return }
    setFromDate(from); setToDate(to)
    desired.current = { query, filters: { ...filters, ...range } }
    void load(desired.current.query, desired.current.filters)
  }
  function clear() {
    setDraftQuery(''); setDraftTag(''); setFromDate(''); setToDate('')
    desired.current = { query: '', filters: noFilters }; void load('', noFilters)
  }
  function filterPinned(pinnedOnly: boolean) {
    desired.current = { query, filters: { ...filters, pinnedOnly } }
    void load(query, desired.current.filters)
  }
  async function togglePin(note: ReadingNote) {
    if (pinRequests.current.has(note.id) || removeRequests.current.has(note.id)) return
    pinRequests.current.add(note.id); setPinPending(new Set(pinRequests.current)); setPinError('')
    try {
      const updated = await request<ReadingNote>(`/notes/${note.id}/pin`, { method: 'PUT', body: JSON.stringify({ pinned: !note.pinned }) })
      // Keep the confirmed write even if the subsequent list read fails.
      setNotes(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item))
      await load(desired.current.query, desired.current.filters)
    } catch (cause) {
      setPinError(cause instanceof Error ? cause.message : '固定状态未保存，请重试。')
    } finally {
      pinRequests.current.delete(note.id); setPinPending(new Set(pinRequests.current))
    }
  }
  async function toggleTask(note: ReadingNote, offset: number, checked: boolean) {
    if (!activeRef.current || loading || error || taskRequests.current.has(note.id) || removeRequests.current.has(note.id)) return
    const body = changeTaskState(note.body, offset, checked)
    if (body === null || body === note.body) return
    const controller = new AbortController()
    taskRequests.current.set(note.id, controller)
    setTaskPending(new Set(taskRequests.current.keys())); setTaskError('')
    try {
      const updated = await request<ReadingNote>(`/notes/${note.id}`, { method: 'PATCH', signal: controller.signal, body: JSON.stringify({ body, positionSeconds: note.positionSeconds, expectedUpdatedAt: note.updatedAt }) })
      if (controller.signal.aborted) return
      setNotes(current => current.map(item => item.id === updated.id ? { ...item, ...updated } : item))
      notifyNotesChanged(note.contentId)
    } catch (cause) {
      if (!controller.signal.aborted) setTaskError((cause instanceof Error ? cause.message : '待办没有保存。') + ' 请刷新笔记后再试。')
    } finally {
      if (taskRequests.current.get(note.id) === controller) {
        taskRequests.current.delete(note.id)
        setTaskPending(new Set(taskRequests.current.keys()))
      }
    }
  }
  async function remove(note: ReadingNote, expectedUpdatedAt: number): Promise<boolean> {
    if (!activeRef.current || loading || error || removeRequests.current.has(note.id) || pinRequests.current.has(note.id) || taskRequests.current.has(note.id)) return false
    const controller = new AbortController()
    removeRequests.current.set(note.id, controller)
    setRemovePending(new Set(removeRequests.current.keys())); setRemoveError(null)
    try {
      await request<void>(`/notes/${encodeURIComponent(note.id)}?expectedUpdatedAt=${expectedUpdatedAt}`, { method: 'DELETE', signal: controller.signal })
      if (controller.signal.aborted) return false
      setNotes(current => current.filter(item => item.id !== note.id))
      notifyNotesChanged(note.contentId)
      return true
    } catch (cause) {
      if (!controller.signal.aborted) {
        const conflict = cause instanceof APIError && cause.code === 'note_conflict'
        setRemoveError({ id: note.id, message: (cause instanceof Error ? cause.message : '笔记没有删除，请重试。') + (conflict ? ' 请核对最新内容后重新确认删除。' : '') })
        if (conflict) notifyNotesChanged(note.contentId)
      }
      return false
    } finally {
      if (removeRequests.current.get(note.id) === controller) {
        removeRequests.current.delete(note.id)
        setRemovePending(new Set(removeRequests.current.keys()))
      }
    }
  }
  return { notes, query, draftQuery, setDraftQuery, draftTag, setDraftTag, fromDate, setFromDate, toDate, setToDate, filters, tags, tagsError, loading, error, hasResult, nextCursor, selectedContentId, setSelectedContentId, reload, cancel, search, applyView, filterTag, filterDates, filterPinned, togglePin, pinPending, pinError, toggleTask, taskPending, taskError, remove, removePending, removeError, clearRemoveError: () => setRemoveError(null), clear,
    more: () => { if (!loading && !error && loaded.current.cursor) void load(query, filters, loaded.current.cursor) } }
}
