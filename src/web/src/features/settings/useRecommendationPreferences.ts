import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from '../../shared/api/client'

export const recommendationPlatforms = ['bilibili', 'youtube', 'xiaohongshu', 'linuxdo', 'xiaoyuzhou', 'douyin', 'huggingface'] as const
export type RecommendationPlatform = typeof recommendationPlatforms[number]
type Preferences = Record<RecommendationPlatform, boolean>
type Response = { sources: { source: RecommendationPlatform; enabled: boolean }[] }
const changed = 'tangentry-recommendation-preferences'
function preferences(response: Response): Preferences {
  if (!Array.isArray(response.sources) || recommendationPlatforms.some(source => !response.sources.some(value => value.source === source && typeof value.enabled === 'boolean'))) throw new Error('推荐设置读取失败，请重试。')
  return Object.fromEntries(response.sources.map(value => [value.source, value.enabled])) as Preferences
}

export function useRecommendationPreferences(active = true) {
  const [values, setValues] = useState<Preferences | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState('')
  const read = useRef<AbortController | null>(null)
  const write = useRef<AbortController | null>(null)
  const reload = useCallback(async () => {
    read.current?.abort()
    const controller = new AbortController(); read.current = controller
    try {
      const result = preferences(await request<Response>('/settings/recommendations', { signal: controller.signal }))
      if (!controller.signal.aborted) { setValues(result); setError('') }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '推荐设置读取失败。')
    }
  }, [])
  useEffect(() => {
    if (active) void reload()
    const update = (event: Event) => {
      read.current?.abort()
      setValues((event as CustomEvent<Preferences>).detail); setError('')
    }
    window.addEventListener(changed, update)
    return () => { read.current?.abort(); write.current?.abort(); window.removeEventListener(changed, update) }
  }, [active, reload])
  async function save(source: RecommendationPlatform, enabled: boolean) {
    if (write.current || !values) return
    const previous = values
    read.current?.abort()
    const controller = new AbortController(); write.current = controller
    setPending(source); setError(''); setValues({ ...previous, [source]: enabled })
    try {
      const result = preferences(await request<Response>(`/settings/recommendations/${source}`, { method: 'PUT', body: JSON.stringify({ enabled }), signal: controller.signal }))
      if (!controller.signal.aborted) window.dispatchEvent(new CustomEvent(changed, { detail: result }))
    } catch (cause) {
      if (!controller.signal.aborted) { setValues(previous); setError(cause instanceof Error ? cause.message : '推荐设置保存失败。') }
    } finally {
      if (write.current === controller) write.current = null
      if (!controller.signal.aborted) setPending('')
    }
  }
  return { values, error, pending, reload, save }
}
