import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from '../../shared/api/client'
import type { ContentItem } from '../../shared/api/types'
import { readFullContent } from '../../shared/data/fullContent'

export function useLibrary() {
  const [items, setItems] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState('')
  const [noticeError, setNoticeError] = useState(false)
  const reading = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const saving = useRef(new Set<string>())
  const refreshAfterSave = useRef(false)
  // Full copies of cards removed in this session, so saving one again
  // restores its body instead of the card projection.
  const removed = useRef(new Map<string, ContentItem>())
  // Background refreshes keep showing the current list; only the first read
  // shows loading, so returning to the window never reflows the page.
  const loaded = useRef(false)

  const reload = useCallback(async () => {
    if (saving.current.size) { refreshAfterSave.current = true; return }
    refreshAfterSave.current = false
    reading.current?.abort()
    const controller = new AbortController()
    const token = ++generation.current
    reading.current = controller
    if (!loaded.current) setLoading(true)
    setError('')
    try {
      const result = await request<{ items: ContentItem[] }>('/library', { signal: controller.signal })
      if (!controller.signal.aborted && token === generation.current) { setItems(result.items); loaded.current = true }
    }
    catch (error) { if (!controller.signal.aborted && token === generation.current) setError(error instanceof Error ? error.message : '无法读取资料库。') }
    finally { if (!controller.signal.aborted && token === generation.current) setLoading(false) }
  }, [])

  useEffect(() => {
    void reload()
    const focus = () => { void reload() }
    const visible = () => { if (document.visibilityState === 'visible') void reload() }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visible)
    return () => {
      reading.current?.abort()
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [reload])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function toggle(item: ContentItem) {
    if (saving.current.has(item.id) || loading || error) return
    saving.current.add(item.id)
    reading.current?.abort()
    ++generation.current
    setPending(current => new Set(current).add(item.id))
    setNotice('')
    setNoticeError(false)
    const saved = items.some(existing => existing.id === item.id)
    try {
      if (saved) {
        if (item.partial) removed.current.set(item.id, await request<ContentItem>(`/library/${encodeURIComponent(item.id)}`))
        await request(`/library/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
        setItems(current => current.filter(existing => existing.id !== item.id))
        setNotice('已取消收藏')
      } else {
        const full = removed.current.get(item.id) ?? await readFullContent(item)
        const result = await request<ContentItem>('/library', { method: 'POST', body: JSON.stringify(full) })
        setItems(current => [result, ...current.filter(existing => existing.id !== item.id)])
        setNotice('已收藏到资料库')
      }
    } catch (error) { setNoticeError(true); setNotice(error instanceof Error ? error.message : '收藏操作未能完成。') }
    finally {
      saving.current.delete(item.id)
      setPending(current => { const next = new Set(current); next.delete(item.id); return next })
      if (!saving.current.size && refreshAfterSave.current) void reload()
    }
  }

  return { items, loading, error, reload, toggle, pending, notice, noticeError }
}
