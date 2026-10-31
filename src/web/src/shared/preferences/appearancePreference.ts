import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { getInterfacePreference, setInterfacePreference, type InterfacePreferenceKey } from './interfacePreferences'

type AppearanceKey = Extract<InterfacePreferenceKey, 'card_appearance' | 'font_settings'>

export function createAppearancePreference<T extends object>(options: {
  key: AppearanceKey
  storageKey: string
  validate: (value: unknown) => T
  apply: (value: T) => void
}) {
  let current: T | undefined
  let revision = 0
  let hydrated: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const parse = (value: unknown): T | undefined => {
    try {
      const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : undefined
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? options.validate(parsed) : undefined
    } catch { return undefined }
  }
  const local = () => {
    try { return parse(localStorage.getItem(options.storageKey)) } catch { return undefined }
  }
  const injected = () => {
    const state = (typeof window === 'undefined' ? {} : window) as { __TANGENTRY_APPEARANCE__?: Partial<Record<AppearanceKey, string>> }
    return parse(state.__TANGENTRY_APPEARANCE__?.[options.key])
  }
  const read = () => current ??= injected() ?? local() ?? options.validate(null)
  const publish = (value: T) => {
    current = value
    try { localStorage.setItem(options.storageKey, JSON.stringify(value)) } catch { /* Stable application storage still works. */ }
    options.apply(value)
    for (const listener of listeners) listener()
  }
  const persist = (value: T) => setInterfacePreference(options.key, JSON.stringify(value)).then(() => {}, () => {})
  const change = (patch: Partial<T>) => {
    revision++
    publish(options.validate({ ...read(), ...patch }))
    void persist(read())
  }
  const hydrate = () => hydrated ??= (async () => {
    if (injected()) return
    const started = revision
    try {
      const result = await getInterfacePreference(options.key)
      // A slow startup response must never undo a newer user selection.
      if (revision !== started) return
      if (result.saved) {
        const value = parse(result.value)
        if (value) publish(value)
      } else {
        const legacy = local()
        if (legacy) await persist(legacy)
      }
    } catch { /* Keep the local preference when the backend is unavailable. */ }
  })()
  const storage = (event: StorageEvent) => {
    if (event.key === options.storageKey || event.key === null) {
      revision++
      publish(local() ?? options.validate(null))
    }
  }
  const subscribe = (listener: () => void) => {
    if (!listeners.size) window.addEventListener('storage', storage)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) window.removeEventListener('storage', storage)
    }
  }
  const usePreference = () => {
    const value = useSyncExternalStore(subscribe, read, read)
    useLayoutEffect(() => options.apply(value), [value])
    useEffect(() => { void hydrate() }, [])
    return { value, change }
  }
  return { read, change, hydrate, usePreference }
}
