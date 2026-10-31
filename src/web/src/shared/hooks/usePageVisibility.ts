import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
const visible = () => document.visibilityState !== 'hidden'
const update = () => { for (const listener of listeners) listener() }
function subscribe(listener: () => void) {
  if (!listeners.size) document.addEventListener('visibilitychange', update)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) document.removeEventListener('visibilitychange', update)
  }
}

export function usePageVisibility() {
  return useSyncExternalStore(subscribe, visible, () => true)
}
