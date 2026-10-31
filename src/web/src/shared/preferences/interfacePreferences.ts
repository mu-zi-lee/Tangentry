import { request } from '../api/client'

export type InterfacePreferenceKey = 'theme' | 'automatic_subtitles' | 'card_appearance' | 'font_settings'

let revision = Date.now()
let latest: Partial<Record<InterfacePreferenceKey, { value: string; revision: number }>> = {}

function nextRevision() {
  revision = Math.max(revision + 1, Date.now())
  return revision
}

export async function getInterfacePreference(key: InterfacePreferenceKey) {
  return request<{ key: InterfacePreferenceKey; value: string; saved?: boolean }>(`/preferences/${encodeURIComponent(key)}`)
}

export function setInterfacePreference(key: InterfacePreferenceKey, value: string) {
  const write = { value, revision: nextRevision() }
  latest[key] = write
  return request<{ key: InterfacePreferenceKey; value: string; saved: boolean; revision: number }>(`/preferences/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, revision: write.revision }),
    keepalive: true,
  }).then(result => {
    if (latest[key]?.revision === write.revision) delete latest[key]
    return result
  }).catch(error => { throw error })
}

export function flushInterfacePreferences() {
  for (const [key, write] of Object.entries(latest) as [InterfacePreferenceKey, { value: string; revision: number }][]) {
    void request(`/preferences/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(write), keepalive: true }).then(() => {
      if (latest[key]?.revision === write.revision) delete latest[key]
    }).catch(() => {})
  }
}

type LifecycleTarget = {
  addEventListener: (event: string, callback: EventListenerOrEventListenerObject) => void
  removeEventListener: (event: string, callback: EventListenerOrEventListenerObject) => void
}

export function bindInterfacePreferenceLifecycle(target: LifecycleTarget, visibility: () => DocumentVisibilityState = () => {
  return typeof document === 'undefined' ? 'visible' : document.visibilityState
}, visibilityTarget: LifecycleTarget = target) {
  const flush = () => flushInterfacePreferences()
  const onVisibilityChange = () => { if (visibility() === 'hidden') flush() }
  target.addEventListener('pagehide', flush)
  target.addEventListener('beforeunload', flush)
  visibilityTarget.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    target.removeEventListener('pagehide', flush)
    target.removeEventListener('beforeunload', flush)
    visibilityTarget.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

if (typeof window !== 'undefined') bindInterfacePreferenceLifecycle(window, undefined, document)

export function resetInterfacePreferenceQueue() {
  latest = {}
}
