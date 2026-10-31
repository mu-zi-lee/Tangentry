import { useCallback, useEffect, useState } from 'react'

const collapseKey = 'tangentry-subscription-collapsed-groups'

function readCollapsed() {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(collapseKey) ?? '[]')
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
  } catch { return new Set<string>() }
}

/** Collapsed groups are shared by the reading navigator and the manager, and survive reader round trips. */
export function useCollapsedGroups(expandedGroup = '') {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed)
  useEffect(() => { try { sessionStorage.setItem(collapseKey, JSON.stringify([...collapsed])) } catch { /* Navigation works without session storage. */ } }, [collapsed])
  // Keep the selected source reachable: its group always opens.
  useEffect(() => {
    if (!expandedGroup) return
    setCollapsed(current => { if (!current.has(expandedGroup)) return current; const next = new Set(current); next.delete(expandedGroup); return next })
  }, [expandedGroup])
  const toggle = useCallback((id: string, open?: boolean) => setCollapsed(current => {
    const shouldOpen = open ?? current.has(id)
    if (current.has(id) === !shouldOpen) return current
    const next = new Set(current)
    if (shouldOpen) next.delete(id)
    else next.add(id)
    return next
  }), [])
  return { collapsed, toggle }
}
