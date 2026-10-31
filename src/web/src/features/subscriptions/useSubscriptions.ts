import { useCallback, useEffect, useRef, useState } from 'react'
import { APIError, request } from '../../shared/api/client'
import type { SubscriptionDetail, SubscriptionInboxPage, SubscriptionSource } from '../../shared/api/types'

export type SubscriptionBatchProgress = {
  kind: 'update' | 'delete' | 'move' | 'refresh-policy'
  total: number
  completed: number
  failed: number
  failures: Record<string, string>
  running: boolean
}

const selectionKey = 'tangentry-subscription-selection'
export const allSubscriptionsID = '__all__'
const message = (cause: unknown) => cause instanceof Error ? cause.message : '操作没有完成，请重试。'

export function useSubscriptions(active = false, contentActive = active) {
  const [sources, setSources] = useState<SubscriptionSource[]>([])
  const [selectedId, setSelectedId] = useState(() => { try { return sessionStorage.getItem(selectionKey) ?? allSubscriptionsID } catch { return allSubscriptionsID } })
  const [detail, setDetail] = useState<SubscriptionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState(false)
  const [detailVersion, setDetailVersion] = useState(0)
  const [allItems, setAllItems] = useState<SubscriptionInboxPage['entries'][number]['item'][]>([])
  const [allLoading, setAllLoading] = useState(false)
  const [allError, setAllError] = useState('')
  const [listError, setListError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [actionError, setActionError] = useState('')
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<{ kind: string; id: string } | null>(null)
  const [batch, setBatch] = useState<SubscriptionBatchProgress | null>(null)
  const listRequest = useRef<AbortController | null>(null)
  const detailRequest = useRef<AbortController | null>(null)
  const allRequest = useRef<AbortController | null>(null)
  const mutation = useRef<AbortController | null>(null)
  const batchRequest = useRef<AbortController | null>(null)
  const activeId = useRef(selectedId)
  const isActive = useRef(active)
  isActive.current = active
  const currentDetail = useRef(detail)
  currentDetail.current = detail
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources

  const select = useCallback((id: string) => {
    activeId.current = id
    setSelectedId(id)
    setNotice('')
    setActionError('')
    try { sessionStorage.setItem(selectionKey, id) } catch { /* Selection still works without storage. */ }
  }, [])

  const reload = useCallback(async (background = false, initial = false) => {
    // Automatic checks wait for the current read; explicit reloads replace it.
    if (mutation.current || background && (listRequest.current || batchRequest.current)) return
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    if (!background) { setLoading(true); setListError('') }
    try {
      const result = await request<{ sources: SubscriptionSource[] }>('/subscriptions', { signal: controller.signal })
      if (controller.signal.aborted || (background && !isActive.current)) return
      const unchanged = JSON.stringify(sourcesRef.current) === JSON.stringify(result.sources)
      if (!unchanged) setSources(result.sources)
      if (activeId.current !== allSubscriptionsID && !result.sources.some(source => source.id === activeId.current)) select(result.sources[0]?.id ?? '')
      if (!background) {
        // Restoring the selected source may already have started its first read.
        if (!initial) setDetailVersion(current => current + 1)
      }
      else {
        const selected = result.sources.find(source => source.id === activeId.current)
        const previous = currentDetail.current
        if (selected && previous?.source.id === selected.id) {
          if (previous.source.lastUpdatedAt !== selected.lastUpdatedAt || previous.source.itemCount !== selected.itemCount || previous.source.refresh.contentRevision !== selected.refresh.contentRevision) {
            if (!detailRequest.current) setDetailVersion(current => current + 1)
          }
          else if (!unchanged) setDetail(current => current?.source.id === selected.id ? { ...current, source: selected } : current)
        }
        else if (!unchanged && activeId.current === allSubscriptionsID && !allRequest.current) setDetailVersion(current => current + 1)
      }
    } catch (cause) {
      if (!controller.signal.aborted && !background) setListError(message(cause))
    } finally {
      if (listRequest.current === controller) listRequest.current = null
      if (!controller.signal.aborted && !background) setLoading(false)
    }
  }, [select])

  const loadDetail = useCallback(async (id: string) => {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setDetailError(''); setReading(Boolean(id))
    setDetail(current => current?.source.id === id ? current : null)
    if (!id) { setDetail(null); detailRequest.current = null; return }
    try {
      const result = await request<SubscriptionDetail>(`/subscriptions/${encodeURIComponent(id)}?cards=true`, { signal: controller.signal })
      if (!controller.signal.aborted && activeId.current === id) setDetail(result)
    } catch (cause) {
      if (!controller.signal.aborted && activeId.current === id) setDetailError(message(cause))
    } finally {
      if (detailRequest.current === controller) detailRequest.current = null
      if (!controller.signal.aborted && activeId.current === id) setReading(false)
    }
  }, [])

  const loadAll = useCallback(async () => {
    allRequest.current?.abort()
    const controller = new AbortController()
    allRequest.current = controller
    setAllLoading(true); setAllError('')
    try {
      const result = await request<{ page: SubscriptionInboxPage }>('/subscription-inbox?limit=50&cards=true', { signal: controller.signal })
      if (!controller.signal.aborted && activeId.current === allSubscriptionsID) setAllItems(result.page.entries.map(entry => entry.item))
    } catch (cause) {
      if (!controller.signal.aborted && activeId.current === allSubscriptionsID) setAllError(message(cause))
    } finally {
      if (allRequest.current === controller) allRequest.current = null
      if (!controller.signal.aborted && activeId.current === allSubscriptionsID) setAllLoading(false)
    }
  }, [])

  useEffect(() => {
    // The hook lives at App scope so reader navigation can retain the selected
    // source. Do not start network work or timers outside this view.
    if (!active) {
      listRequest.current?.abort()
      detailRequest.current?.abort()
      allRequest.current?.abort()
      mutation.current?.abort()
      batchRequest.current?.abort()
      setLoading(false)
      setReading(false)
      setAllLoading(false)
      return
    }
    void reload(false, true)
    return () => {
      listRequest.current?.abort()
      detailRequest.current?.abort()
      allRequest.current?.abort()
      mutation.current?.abort()
      batchRequest.current?.abort()
    }
  }, [active, reload])
  useEffect(() => {
    if (!active || !contentActive) {
      detailRequest.current?.abort()
      allRequest.current?.abort()
      setReading(false)
      setAllLoading(false)
      return
    }
    if (selectedId === allSubscriptionsID) {
      detailRequest.current?.abort()
      setDetail(null)
      void loadAll()
      return
    }
    allRequest.current?.abort()
    setAllLoading(false)
    void loadDetail(selectedId)
  }, [active, contentActive, selectedId, detailVersion, loadDetail, loadAll])

  useEffect(() => {
    const imported = () => { if (isActive.current && !mutation.current) void reload() }
    window.addEventListener('tangentry:subscriptions-changed', imported)
    if (!active) return () => window.removeEventListener('tangentry:subscriptions-changed', imported)
    const refresh = () => { if (document.visibilityState === 'visible' && !mutation.current) void reload(true) }
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('tangentry:subscriptions-changed', imported) }
  }, [active, reload])

  function replaceSource(source: SubscriptionSource) {
    setSources(current => current.some(item => item.id === source.id) ? current.map(item => item.id === source.id ? source : item) : [source, ...current])
    setDetail(current => current?.source.id === source.id ? { ...current, source } : current)
  }

  const setMembership = useCallback((id: string, groupId: string) => {
    listRequest.current?.abort(); detailRequest.current?.abort()
    setSources(current => current.map(source => source.id === id ? { ...source, groupId } : source))
    setDetail(current => current?.source.id === id ? { ...current, source: { ...current.source, groupId } } : current)
    setDetailVersion(current => current + 1)
  }, [])
  const dissolveGroup = useCallback((groupId: string) => {
    listRequest.current?.abort(); detailRequest.current?.abort()
    setSources(current => current.map(source => source.groupId === groupId ? { ...source, groupId: '' } : source))
    setDetail(current => current?.source.groupId === groupId ? { ...current, source: { ...current.source, groupId: '' } } : current)
    setDetailVersion(current => current + 1)
  }, [])

  async function mutate<T>(kind: string, id: string, run: (signal: AbortSignal) => Promise<T>, accept: (result: T) => void): Promise<boolean> {
    if (mutation.current || loading || listError) return false
    const controller = new AbortController()
    listRequest.current?.abort(); detailRequest.current?.abort(); setReading(false)
    mutation.current = controller
    setPending({ kind, id }); setActionError(''); setNotice('')
    if (kind === 'update') setUpdateErrors(current => ({ ...current, [id]: '' }))
    try {
      const result = await run(controller.signal)
      if (controller.signal.aborted) return false
      accept(result)
      return true
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (kind === 'update') {
          setUpdateErrors(current => ({ ...current, [id]: message(cause) }))
          try {
            const local = await request<SubscriptionDetail>(`/subscriptions/${encodeURIComponent(id)}?cards=true`, { signal: controller.signal })
            if (!controller.signal.aborted) replaceSource(local.source)
          } catch { /* Keep the platform error and cached content if local metadata cannot be read. */ }
        }
        else {
          setActionError(message(cause))
          if (kind === 'address' && cause instanceof APIError && cause.code === 'subscription_address_conflict') {
            try {
              const local = await request<SubscriptionDetail>(`/subscriptions/${encodeURIComponent(id)}?cards=true`, { signal: controller.signal })
              if (!controller.signal.aborted) replaceSource(local.source)
            } catch { /* Keep the user's draft and conflict message when local rereading fails. */ }
          }
        }
      }
      return false
    } finally {
      if (mutation.current === controller) { setPending(null); mutation.current = null }
    }
  }

  const create = (query: string, name: string, type = 'bilibili') => mutate('create', '', signal => request<{ source: SubscriptionSource; created: boolean }>('/subscriptions', { method: 'POST', body: JSON.stringify({ query, name, type }), signal }), result => {
    replaceSource(result.source)
    select(result.source.id)
    setNotice(result.created ? type === 'rss' || type === 'youtube' || result.source.id.startsWith('youtube:') ? '来源已保存，点击“更新内容”获取内容。' : '来源已保存，点击“更新投稿”获取内容。' : '这个来源已存在，已打开原有记录。')
  })
  const rename = (id: string, name: string) => mutate('rename', id, signal => request<SubscriptionSource>(`/subscriptions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }), signal }), source => { replaceSource(source); setNotice('来源名称已保存。') })
  const editAddress = (id: string, url: string, expectedUrl: string) => mutate('address', id, signal => request<SubscriptionSource>(`/subscriptions/${encodeURIComponent(id)}/address`, { method: 'PUT', body: JSON.stringify({ url, expectedUrl }), signal }), source => {
    replaceSource(source)
    setUpdateErrors(current => ({ ...current, [id]: '' }))
    setNotice('订阅地址已保存，已有内容和笔记保留。')
  })
  const update = (id: string) => {
    if (activeId.current === id) { detailRequest.current?.abort(); setReading(false) }
    return mutate('update', id, signal => request<SubscriptionDetail>(`/subscriptions/${encodeURIComponent(id)}/update?cards=true`, { method: 'POST', signal }), result => {
      replaceSource(result.source)
      if (activeId.current === id) { setDetail(result); setDetailError(''); setNotice(result.notModified ? '已检查，内容没有变化。' : `已更新最近一页，共 ${result.items.length} 条。`) }
    })
  }
  const configureRefresh = (id: string, enabled: boolean, intervalSeconds: number) => mutate('refresh-policy', id, signal => request<SubscriptionSource>(`/subscriptions/${encodeURIComponent(id)}/refresh-policy`, { method: 'PUT', body: JSON.stringify({ enabled, intervalSeconds }), signal }), source => { replaceSource(source); setNotice(source.refresh.enabled ? '自动刷新已开启，将按设置的间隔检查。' : '已改为手动刷新。') })
  const remove = (id: string) => mutate('delete', id, signal => request<void>(`/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE', signal }), () => {
    setSources(current => current.filter(source => source.id !== id))
    if (activeId.current === id) select(sources.find(source => source.id !== id)?.id ?? '')
    setUpdateErrors(current => { const next = { ...current }; delete next[id]; return next })
    setNotice('来源已移除，收藏、下载和笔记仍保留。')
  })

  async function runBatch<T>(kind: SubscriptionBatchProgress['kind'], ids: string[], run: (id: string, signal: AbortSignal) => Promise<T>, accept: (id: string, result: T) => void): Promise<Set<string>> {
    const unique = [...new Set(ids)].filter(Boolean)
    if (!unique.length || loading || listError || mutation.current || batchRequest.current || batch?.running) return new Set()
    const controller = new AbortController()
    batchRequest.current = controller
    const succeeded = new Set<string>()
    setBatch({ kind, total: unique.length, completed: 0, failed: 0, failures: {}, running: true })
    let cursor = 0
    const worker = async () => {
      while (!controller.signal.aborted) {
        const index = cursor++
        if (index >= unique.length) return
        const id = unique[index]
        try {
          const result = await run(id, controller.signal)
          if (controller.signal.aborted) return
          succeeded.add(id)
          accept(id, result)
          setBatch(current => current ? { ...current, completed: current.completed + 1 } : current)
        } catch (cause) {
          if (controller.signal.aborted) return
          const text = message(cause)
          setBatch(current => current ? { ...current, completed: current.completed + 1, failed: current.failed + 1, failures: { ...current.failures, [id]: text } } : current)
        }
      }
    }
    // Keep batch refreshes within the backend's two-source update gate so a
    // third concurrent request is not rejected as busy.
    await Promise.all(Array.from({ length: Math.min(2, unique.length) }, worker))
    setBatch(current => current ? { ...current, running: false } : current)
    if (batchRequest.current === controller) batchRequest.current = null
    return succeeded
  }

  const batchUpdate = async (ids: string[]) => {
    const succeeded = await runBatch('update', ids, (id, signal) => request<SubscriptionDetail>(`/subscriptions/${encodeURIComponent(id)}/update?cards=true`, { method: 'POST', signal }), (id, result) => {
      replaceSource(result.source)
      if (activeId.current === id) { setDetail(result); setDetailError('') }
    })
    if (succeeded.size) {
      // Refresh the combined stream once, not after each source or poll while
      // the batch is still writing. Inactive views defer the read until return.
      if (activeId.current === allSubscriptionsID) setDetailVersion(current => current + 1)
      setNotice(`已更新 ${succeeded.size} 个来源${succeeded.size < new Set(ids).size ? '，失败项已保留旧内容。' : '。'}`)
    }
    return succeeded.size > 0
  }
  const batchRemove = async (ids: string[]) => {
    const succeeded = await runBatch('delete', ids, (id, signal) => request<void>(`/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE', signal }), (_id, _result) => undefined)
    if (succeeded.size) {
      setSources(current => current.filter(source => !succeeded.has(source.id)))
      if (succeeded.has(activeId.current)) select(sources.find(source => !succeeded.has(source.id))?.id ?? '')
      setUpdateErrors(current => { const next = { ...current }; succeeded.forEach(id => delete next[id]); return next })
      setNotice(`已移除 ${succeeded.size} 个来源。`)
    }
    return succeeded.size > 0
  }
  const batchMove = async (ids: string[], groupId: string) => {
    const succeeded = await runBatch('move', ids, (id, signal) => request<{sourceId: string; groupId: string}>(`/subscriptions/${encodeURIComponent(id)}/group`, { method: 'PUT', body: JSON.stringify({ groupId, expectedGroupId: sources.find(source => source.id === id)?.groupId ?? '' }), signal }), (id, result) => {
      setSources(current => current.map(source => source.id === id ? { ...source, groupId: result.groupId } : source))
      setDetail(current => current?.source.id === id ? { ...current, source: { ...current.source, groupId: result.groupId } } : current)
    })
    if (succeeded.size) setNotice(`已移动 ${succeeded.size} 个来源。`)
    return succeeded.size > 0
  }
  const batchConfigureRefresh = async (ids: string[], enabled: boolean, intervalSeconds: number) => {
    const succeeded = await runBatch('refresh-policy', ids, (id, signal) => request<SubscriptionSource>(`/subscriptions/${encodeURIComponent(id)}/refresh-policy`, { method: 'PUT', body: JSON.stringify({ enabled, intervalSeconds }), signal }), (_id, result) => replaceSource(result))
    if (succeeded.size) setNotice(`已修改 ${succeeded.size} 个来源的自动更新设置。`)
    return succeeded.size > 0
  }
  const retryBatchFailed = () => {
    if (!batch || batch.running) return Promise.resolve(false)
    const ids = Object.keys(batch.failures)
    return batch.kind === 'update' ? batchUpdate(ids) : Promise.resolve(false)
  }

  return { sources, selectedId, allItems, allLoading, allError, detail: detail?.source.id === selectedId ? detail : null, loading, reading, pending, batch, listError, detailError, actionError, updateError: updateErrors[selectedId] ?? '', notice, select, reload, reloadDetail: () => selectedId === allSubscriptionsID ? loadAll() : loadDetail(selectedId), create, rename, editAddress, update, remove, configureRefresh, batchUpdate, batchRemove, batchMove, batchConfigureRefresh, retryBatchFailed, setMembership, dissolveGroup }
}
