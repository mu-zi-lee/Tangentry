import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from '../../shared/api/client'
import type { DownloadJob, DownloadMediaInfo, DownloadOptions, ToolReport } from '../../shared/api/types'

export function useDownloads() {
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [tools, setTools] = useState<ToolReport | null>(null)
  const [readError, setReadError] = useState('')
  const [writeError, setWriteError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState('')
  const controller = useRef<AbortController | null>(null)
  const starting = useRef(false)
  const revision = useRef(0)
  const [info, setInfo] = useState<DownloadMediaInfo | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [infoError, setInfoError] = useState('')
  const inspectController = useRef<AbortController | null>(null)

  const reload = useCallback(async () => {
    controller.current?.abort()
    const active = new AbortController()
    const version = revision.current
    controller.current = active
    try {
      const [result, report] = await Promise.all([
        request<{ jobs: DownloadJob[] }>('/downloads', { signal: active.signal }),
        request<ToolReport>('/tools', { signal: active.signal }),
      ])
      if (active.signal.aborted) return
      if (version === revision.current) setJobs(result.jobs)
      setTools(report)
      setReadError('')
    } catch (error) {
      if (!active.signal.aborted) setReadError(error instanceof Error ? error.message : '无法读取下载任务。')
    } finally {
      if (!active.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => { void reload(); return () => { controller.current?.abort(); inspectController.current?.abort() } }, [reload])
  const active = jobs.some(job => job.state === 'queued' || job.state === 'running')
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => { if (!document.hidden) void reload() }, 2000)
    return () => window.clearInterval(timer)
  }, [active, reload])
  useEffect(() => {
    const visible = () => { if (!document.hidden) void reload() }
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [reload])

  function clearInfo() {
    inspectController.current?.abort()
    inspectController.current = null
    setInfo(null)
    setInfoError('')
    setInspecting(false)
  }

  async function inspect(url: string) {
    inspectController.current?.abort()
    const active = new AbortController()
    inspectController.current = active
    setInfo(null)
    setInfoError('')
    setInspecting(true)
    try {
      const result = await request<DownloadMediaInfo>('/downloads/info', { method: 'POST', body: JSON.stringify({ url }), signal: active.signal })
      if (active.signal.aborted) return null
      setInfo(result)
      return result
    } catch (error) {
      if (!active.signal.aborted) setInfoError(error instanceof Error ? error.message : '无法获取媒体信息。')
      return null
    } finally {
      if (!active.signal.aborted) setInspecting(false)
    }
  }

  async function start(url: string, title = '', maxHeight = 1080, options: DownloadOptions = {}, location: { subdirectory?: string; outputDirectory?: string; thumbnailUrl?: string } = {}) {
    if (starting.current) return false
    starting.current = true
    setSubmitting(true)
    setNotice('')
    try {
      const job = await request<DownloadJob>('/downloads', { method: 'POST', body: JSON.stringify({ url, title, maxHeight, ...options, ...location }) })
      ++revision.current
      setJobs(current => [job, ...current.filter(existing => existing.id !== job.id)])
      setNotice('已加入下载队列。')
      setWriteError('')
      void reload()
      return true
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : '无法开始下载。')
      return false
    } finally { starting.current = false; setSubmitting(false) }
  }

  async function cancel(id: string) {
    try {
      await request<void>(`/downloads/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
      ++revision.current
      setJobs(current => current.map(job => job.id === id ? { ...job, state: 'cancelled', message: '已取消下载。' } : job))
      setWriteError('')
      void reload()
    } catch (error) { setWriteError(error instanceof Error ? error.message : '无法取消下载。') }
  }

  async function remove(id: string, deleteFiles = false) {
    try {
      await request<void>(`/downloads/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ deleteFiles }) })
      ++revision.current
      setJobs(current => current.filter(job => job.id !== id))
      setWriteError('')
      return true
    } catch (error) { setWriteError(error instanceof Error ? error.message : '无法删除下载记录。'); return false }
  }

  async function clear(deleteFiles = false) {
    try {
      await request<void>('/downloads', { method: 'DELETE', body: JSON.stringify({ deleteFiles }) })
      ++revision.current
      setJobs(current => current.filter(job => job.state === 'queued' || job.state === 'running'))
      setWriteError('')
      return true
    } catch (error) { setWriteError(error instanceof Error ? error.message : '无法清空下载历史。'); return false }
  }

  return { jobs, tools, error: writeError || readError, loading, submitting, notice, reload, start, cancel, remove, clear, info, inspecting, infoError, inspect, clearInfo }
}
