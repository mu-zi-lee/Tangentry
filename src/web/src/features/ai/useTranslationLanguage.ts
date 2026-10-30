import { useEffect, useState } from 'react'
import { translationTargets } from '../subtitles/subtitleLanguageMatch'

const storageKey = 'tangentry-translation-language'
const changedEvent = 'tangentry-translation-language-changed'

export function readTranslationLanguage() {
  try {
    const value = localStorage.getItem(storageKey)
    return translationTargets.some(([code]) => code === value) ? value! : 'zh-Hans'
  } catch { return 'zh-Hans' }
}

export function useTranslationLanguage() {
  const [language, setLanguage] = useState(readTranslationLanguage)
  useEffect(() => {
    const update = (event: Event) => setLanguage((event as CustomEvent<string>).detail ?? readTranslationLanguage())
    const storage = (event: StorageEvent) => { if (event.key === storageKey || !event.key) setLanguage(readTranslationLanguage()) }
    window.addEventListener(changedEvent, update)
    window.addEventListener('storage', storage)
    return () => { window.removeEventListener(changedEvent, update); window.removeEventListener('storage', storage) }
  }, [])
  function change(value: string) {
    if (!translationTargets.some(([code]) => code === value)) return
    try { localStorage.setItem(storageKey, value) } catch { /* Apply for this session. */ }
    setLanguage(value)
    window.dispatchEvent(new CustomEvent(changedEvent, { detail: value }))
  }
  return { language, change }
}
