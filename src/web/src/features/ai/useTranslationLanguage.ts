import { useSyncExternalStore } from 'react'
import { translationTargets } from '../subtitles/subtitleLanguageMatch'

const storageKey = 'tangentry-translation-language'
const changedEvent = 'tangentry-translation-language-changed'
const listeners = new Set<() => void>()
let current: string | undefined

export function readTranslationLanguage() {
  try {
    const value = localStorage.getItem(storageKey)
    return translationTargets.some(([code]) => code === value) ? value! : 'zh-Hans'
  } catch { return 'zh-Hans' }
}

const snapshot = () => current ??= readTranslationLanguage()
const update = (event: Event) => {
  const value = (event as CustomEvent<string>).detail
  current = translationTargets.some(([code]) => code === value) ? value : readTranslationLanguage()
  for (const listener of listeners) listener()
}
const storage = (event: StorageEvent) => { if (event.key === storageKey || !event.key) update(event) }
function subscribe(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener(changedEvent, update)
    window.addEventListener('storage', storage)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) { window.removeEventListener(changedEvent, update); window.removeEventListener('storage', storage) }
  }
}

export function useTranslationLanguage() {
  const language = useSyncExternalStore(subscribe, snapshot, () => 'zh-Hans')
  function change(value: string) {
    if (!translationTargets.some(([code]) => code === value)) return
    try { localStorage.setItem(storageKey, value) } catch { /* Apply for this session. */ }
    window.dispatchEvent(new CustomEvent(changedEvent, { detail: value }))
  }
  return { language, change }
}
