import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from '../../shared/api/client'
import type { SavedSubtitle, SubtitleDocument, SubtitleTrack } from '../../shared/api/types'
import { cachedSubtitles, cacheSubtitles, clearSubtitleCache } from './platformCache'

export function subtitlePriority(track: { language: string; automatic?: boolean; source?: string }) {
  const rawLanguage = track.language.toLowerCase().replaceAll('_', '-')
  const language = rawLanguage.replace(/^ai-/, '').replace(/-orig$/, '')
  const simplifiedChinese = ['zh-hans', 'zh-cn', 'zh-sg'].some(code => language === code || language.startsWith(`${code}-`))
  if (simplifiedChinese && track.source !== 'ai' && !track.automatic) return 0
  if (simplifiedChinese && (track.source === 'ai' || track.automatic)) return 1
  if (/^ai-(?:zh|cmn|zho|chi)$/.test(rawLanguage) && (track.source === 'ai' || track.automatic)) return 1
  return 2
}

export function useSubtitles(videoId: string, source: 'bilibili' | 'youtube' | 'podcast' | 'local' = 'bilibili') {
  const [platform, setPlatform] = useState<SubtitleDocument | null>(null)
  const [saved, setSaved] = useState<SavedSubtitle[]>([])
  const [origin, setOrigin] = useState<'platform' | 'saved'>('platform')
  const [loading, setLoading] = useState(false)
  const [localLoading, setLocalLoading] = useState(true)
  const [localKnown, setLocalKnown] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [localError, setLocalError] = useState('')
  const [writeError, setWriteError] = useState('')
  const [notice, setNotice] = useState('')
  const [languageRead, setLanguageRead] = useState<{ language: string; status: 'loading' | 'loaded' | 'error'; error?: string } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const localReader = useRef<AbortController | null>(null)
  const mutation = useRef<AbortController | null>(null)
  const contentId = source === 'podcast' || source === 'local' ? videoId : `${source}:${videoId}`

  const read = useCallback(async (language?: string, reuse = false, keepSaved = false) => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setLoading(true)
    setError('')
    if (language) setLanguageRead({ language, status: 'loading' })
    else setLanguageRead(null)
    try {
      const query = source === 'youtube' ? 'https://www.youtube.com/watch?v=' + videoId : videoId
      const endpoint = source === 'local' ? `/subtitles/local-media?contentId=${encodeURIComponent(contentId)}` : source === 'podcast' ? `/subtitles/podcast?contentId=${encodeURIComponent(contentId)}` : `/subtitles/${source}?q=${encodeURIComponent(query)}` + (language ? '&language=' + encodeURIComponent(language) : '')
      if (!reuse) clearSubtitleCache(videoId)
      const cached = reuse ? cachedSubtitles(endpoint, videoId) : undefined
      // Persistent browser entries intentionally contain metadata only. They
      // can answer a confirmed empty result, but never replace a body read.
      const cachedEmpty = cached?.status === 'none' && !cached.languages?.length && !cached.tracks.length && !cached.parts?.some(part => part.languages.length || part.tracks.length)
      const data = cachedEmpty ? cached : await request<SubtitleDocument>(endpoint, { signal: current.signal })
      if (!current.signal.aborted) {
        if (!cached) cacheSubtitles(endpoint, data)
        setPlatform(previous => language && previous?.videoId === data.videoId ? {
          ...previous,
          ...data,
          languages: data.languages?.length ? data.languages : previous.languages,
          tracks: data.tracks.length ? [...previous.tracks.filter(track => track.language !== language), ...data.tracks] : previous.tracks,
          parts: previous.parts?.map((part, index) => index === 0 ? {
            ...part,
            languages: data.languages?.length ? data.languages : part.languages,
            tracks: data.tracks.length ? [...part.tracks.filter(track => track.language !== language), ...data.tracks] : part.tracks,
          } : part),
        } : data)
        setOrigin(keepSaved ? 'saved' : 'platform'); setNotice('')
        if (language) {
          const loaded = data.tracks.some(track => track.language === language)
          setLanguageRead({ language, status: loaded ? 'loaded' : 'error', ...(loaded ? {} : { error: data.errorMessage || '这条字幕正文暂时无法读取。' }) })
        }
        if (!cached && data.tracks.length > 0) {
          const local = await request<{ tracks: SavedSubtitle[] }>(`/saved-subtitles?contentId=${encodeURIComponent(contentId)}`, { signal: current.signal })
          if (!current.signal.aborted) { setSaved(local.tracks); setLocalKnown(true) }
        }
      }
    } catch (cause) {
      if (!current.signal.aborted) {
        const message = cause instanceof Error ? cause.message : '暂时无法获取字幕，请重试。'
        setError(message)
        if (language) setLanguageRead({ language, status: 'error', error: message })
      }
    } finally {
      if (!current.signal.aborted) setLoading(false)
    }
  }, [videoId, source, contentId])

  const readSaved = useCallback(async (): Promise<SavedSubtitle[] | null | undefined> => {
    localReader.current?.abort()
    const current = new AbortController()
    localReader.current = current
    setLocalLoading(true)
    setLocalKnown(false)
    setLocalError('')
    try {
      const result = await request<{ tracks: SavedSubtitle[] }>(`/saved-subtitles?contentId=${encodeURIComponent(contentId)}`, { signal: current.signal })
      if (current.signal.aborted) return undefined
      setSaved(result.tracks)
      setLocalKnown(true)
      setWriteError('')
      return result.tracks
    } catch (cause) {
      if (current.signal.aborted) return undefined
      setLocalError(cause instanceof Error ? cause.message : '本机字幕暂时无法读取。')
      return null
    } finally {
      if (!current.signal.aborted) setLocalLoading(false)
    }
  }, [contentId])

  useEffect(() => {
    let active = true
    void readSaved().then(values => {
      if (!active || values === undefined) return
      void read(undefined, true, Boolean(values?.length))
    })
    return () => { active = false; controller.current?.abort(); localReader.current?.abort(); mutation.current?.abort() }
  }, [read, readSaved])

  const useSaved = () => { controller.current?.abort(); setLoading(false); setOrigin('saved'); setError(''); setNotice('') }
  const reloadSaved = async () => { if (mutation.current) return; const values = await readSaved(); if (values?.length) useSaved() }
  const cancel = () => { controller.current?.abort(); localReader.current?.abort(); setLoading(false); setLocalLoading(false) }

  async function save(track: SubtitleTrack, selected = false) {
    if (!localKnown || localLoading || mutation.current) return
    const current = new AbortController()
    mutation.current = current
    setPending(true); setWriteError(''); setNotice('')
    const revision = saved.find(value => value.track.language === track.language)?.revision ?? 0
    try {
      const result = await request<SavedSubtitle>(`/saved-subtitles/${encodeURIComponent(contentId)}/${encodeURIComponent(track.language)}`, {
        method: 'PUT', body: JSON.stringify({ track, revision, selected }), signal: current.signal,
      })
      if (!current.signal.aborted) {
        setSaved(previous => [...previous.filter(value => value.track.language !== track.language).map(value => selected ? { ...value, selected: false } : value), result].sort((a, b) => a.track.language.localeCompare(b.track.language)))
        setNotice('这份字幕已保存到本机。')
      }
    } catch (cause) {
      if (!current.signal.aborted) { setWriteError(cause instanceof Error ? cause.message : '字幕未保存。'); setLocalKnown(false) }
    } finally { if (!current.signal.aborted) setPending(false); mutation.current = null }
  }

  async function remove(language: string): Promise<boolean> {
    const value = saved.find(candidate => candidate.track.language === language)
    if (!localKnown || localLoading || !value || mutation.current) return false
    const current = new AbortController()
    mutation.current = current
    setPending(true); setWriteError(''); setNotice('')
    try {
      await request(`/saved-subtitles/${encodeURIComponent(contentId)}/${encodeURIComponent(language)}?revision=${value.revision}`, { method: 'DELETE', signal: current.signal })
      if (current.signal.aborted) return false
      setSaved(previous => previous.filter(candidate => candidate.track.language !== language))
      setNotice('已移除这份本机字幕。')
      return true
    } catch (cause) {
      if (!current.signal.aborted) { setWriteError(cause instanceof Error ? cause.message : '字幕未移除。'); setLocalKnown(false) }
      return false
    } finally { if (!current.signal.aborted) setPending(false); mutation.current = null }
  }

  const document: SubtitleDocument | null = origin === 'platform' ? platform : saved.length ? {
    ...(platform ?? {}), videoId, part: 1, status: platform?.status ?? 'available', tracks: saved.map(value => value.track),
  } : null
  return { document, platformDocument: platform, saved, origin, loading: loading || localLoading, localLoading, localKnown, pending, error, localError, writeError, notice, languageRead, read, cancel, save, remove, useSaved, reloadSaved }
}
