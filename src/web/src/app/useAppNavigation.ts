import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { popped, pushPath, replacePath } from '../shared/browser/historyStack'
import { navigateBack, readerNoteFromURL, readerQueryFromURL, resolveViewportTarget, routeKey, viewFromURL, viewPaths, type View, type ViewportTarget, type ViewportSnapshot } from './navigation'

export type ReaderReturnView = Exclude<View, 'reader' | 'tools' | 'search'> | 'search' | 'tools'

export function selectedSavedViewFromURL() {
  return viewFromURL() === 'subscriptions' ? new URLSearchParams(location.search).get('view') ?? '' : ''
}

const initialScrollPositions = (): Record<View, number> => ({
  bilibili: 0,
  history: 0,
  discovery: 0,
  search: 0,
  library: 0,
  downloads: 0,
  tools: 0,
  reader: 0,
  subscriptions: 0,
  notes: 0,
})

function findSource(view: View, sourceID: string, focusID: string) {
  if (!sourceID && !focusID) return null
  const inView = (node: HTMLElement) => view === 'discovery'
    ? node.closest('[data-app-view="discovery"]')
    : !node.closest('[data-app-view="discovery"]')
  if (focusID) {
    const focused = document.getElementById(focusID)
    // A page-level control such as #main has no app-view marker; it is still a
    // valid keyboard restoration target when no content card was recorded.
    if (focused && (!sourceID || inView(focused))) return focused
  }
  if (!sourceID) return null
  return Array.from(document.querySelectorAll<HTMLElement>('[data-content-id]'))
    .find(node => node.dataset.contentId === sourceID && inView(node)) ?? null
}

export function RestoreViewport({ top, sourceID, focusID = '', routeKey: targetRoute = '', view }: ViewportTarget & { view: View }) {
  useLayoutEffect(() => {
    let frame = 0
    let attempts = 0
    let stableFrames = 0
    let lastHeight = 0
    let stopped = false
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => schedule())
    // Keep watching long enough for network-backed galleries/readers to mount.
    const maxAttempts = 180
    const focusFallback = () => {
      if (document.documentElement.dataset.input === 'keyboard') document.getElementById('main')?.focus({ preventScroll: true })
    }
    const restore = () => {
      if (stopped) return
      attempts++
      if (attempts > maxAttempts) {
        focusFallback()
        stop()
        return
      }
      // Re-apply after async lists render; an early scroll can otherwise be clamped by a short page.
      window.scrollTo({ top, behavior: 'instant' })
      const source = findSource(view, sourceID, focusID)
      if (source) {
        const targetReachable = document.documentElement.scrollHeight >= top + window.innerHeight
        const targetReached = Math.abs(window.scrollY - top) <= 1
        if (!targetReachable || !targetReached) {
          stableFrames = 0
          schedule()
          return
        }
        source.focus({ preventScroll: true })
        const height = document.documentElement.scrollHeight
        stableFrames = height === lastHeight ? stableFrames + 1 : 0
        lastHeight = height
        if (stableFrames >= 8) {
          stop()
          return
        }
        schedule()
        return
      }
      if ((!sourceID && !focusID) || attempts >= maxAttempts) {
        focusFallback()
        stop()
        return
      }
      schedule()
    }
    const schedule = () => {
      if (stopped || frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        restore()
      })
    }
    const stop = () => {
      stopped = true
      if (frame) window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('pointerdown', stop)
      window.removeEventListener('keydown', onKeyDown)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stop()
    }
    // A saved position belongs to navigation; user input takes over immediately.
    window.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('touchstart', stop, { passive: true })
    window.addEventListener('pointerdown', stop, { passive: true })
    window.addEventListener('keydown', onKeyDown)
    observer?.observe(document.body, { childList: true, subtree: true })
    schedule()
    return stop
  }, [focusID, sourceID, targetRoute, top, view])
  return null
}

export function useAppNavigation(input: RefObject<HTMLInputElement | null>) {
  const [view, setView] = useState<View>(viewFromURL)
  const [readerQuery, setReaderQuery] = useState(readerQueryFromURL)
  const [readerNoteId, setReaderNoteId] = useState(readerNoteFromURL)
  const [readingItem, setReadingItem] = useState<import('../shared/api/types').ContentItem | null>(null)
  const readerReturn = useRef<ReaderReturnView>(readerNoteId ? 'notes' : 'discovery')
  const readerReturnPath = useRef(readerNoteId ? `${viewPaths.notes}` : viewPaths.discovery)
  const readerSourceID = useRef(readerNoteId ? `note:${readerNoteId}` : '')
  const scrollPositions = useRef<Record<View, number>>(initialScrollPositions())
  const currentView = useRef(view)
  const currentRoute = useRef(routeKey())
  const routeSnapshots = useRef(new Map<string, ViewportSnapshot>())
  const viewportTarget = useRef<ViewportTarget>({ top: 0, sourceID: '', focusID: '', routeKey: currentRoute.current })
  const pendingViewportTarget = useRef<ViewportTarget | null>(null)
  const [viewportVersion, setViewportVersion] = useState(0)

  useEffect(() => {
    const previous = history.scrollRestoration
    history.scrollRestoration = 'manual'
    return () => { history.scrollRestoration = previous }
  }, [])

  function focusedTarget() {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const source = active?.closest<HTMLElement>('[data-content-id]')
    return { sourceID: source?.dataset.contentId ?? '', focusID: active?.id ?? '' }
  }

  function navigate(next: View, push = true, path = viewPaths[next], targetOverride?: ViewportTarget) {
    const returningFromReader = currentView.current === 'reader' && next === readerReturn.current
    const previousRoute = currentRoute.current
    const previousView = currentView.current
    const focused = focusedTarget()
    scrollPositions.current[previousView] = window.scrollY
    routeSnapshots.current.set(previousRoute, {
      view: previousView,
      top: window.scrollY,
      sourceID: focused.sourceID,
      focusID: focused.focusID,
      routeKey: previousRoute,
    })
    const nextRoute = routeKey(path)
    currentView.current = next
    const fallback: ViewportTarget = { top: scrollPositions.current[next], sourceID: returningFromReader ? readerSourceID.current : '', focusID: '', routeKey: nextRoute }
    viewportTarget.current = targetOverride ?? resolveViewportTarget(nextRoute, routeSnapshots.current, fallback)
    if (returningFromReader && !viewportTarget.current.sourceID) viewportTarget.current.sourceID = readerSourceID.current
    if (push) pushPath(path)
    else if (routeKey(path) !== routeKey()) replacePath(path)
    currentRoute.current = nextRoute
    setViewportVersion(version => version + 1)

    setReaderQuery(readerQueryFromURL())
    const noteId = readerNoteFromURL()
    setReaderNoteId(noteId)
    if (next === 'reader' && noteId) {
      readerReturn.current = 'notes'
      readerSourceID.current = `note:${noteId}`
    }
    setView(next)
  }

  function returnHome(animate: boolean) {
    if (currentView.current !== 'discovery') navigate('discovery')
    scrollPositions.current.discovery = 0
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: animate ? 'smooth' : 'instant' }))
  }

  function setReaderReturn(view: ReaderReturnView, path: string) {
    readerReturn.current = view
    readerReturnPath.current = routeKey(path)
  }

  function returnToPath(sourcePath: string | undefined, fallback: View = 'discovery') {
    const source = sourcePath ? { path: sourcePath } : null
    const decision = navigateBack({
      currentPath: currentRoute.current,
      source,
      // The source is eligible for pop only when this app session has a full
      // snapshot for that exact route. Without the path-bearing history state
      // API, a missing snapshot is treated conservatively as replace.
      hasMatchingHistoryEntry: Boolean(sourcePath && routeSnapshots.current.has(routeKey(sourcePath))),
      fallback: { path: viewPaths[fallback], top: scrollPositions.current[fallback] },
    })
    const restoreTarget: ViewportTarget = { ...decision.restore, routeKey: decision.path }
    if (decision.action === 'pop') {
      // Normally the destination has a route snapshot captured when leaving
      // the source. Keep the pure decision as a fallback for older/direct
      // entries whose snapshot is not present in this app session.
      pendingViewportTarget.current = restoreTarget
      history.back()
      return
    }
    pendingViewportTarget.current = null
    replacePath(decision.path)
    navigate(viewFromURL(), false, decision.path, restoreTarget)
  }

  function returnFromReader() {
    returnToPath(readerReturnPath.current, readerReturn.current)
  }

  useEffect(() => {
    const popstate = (event: PopStateEvent) => {
      popped(event.state)
      const targetRoute = routeKey()
      const target = routeSnapshots.current.has(targetRoute) ? undefined : pendingViewportTarget.current ?? undefined
      pendingViewportTarget.current = null
      navigate(viewFromURL(), false, targetRoute, target)
    }
    const cmdK = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        if (view !== 'search') navigate('search')
        window.setTimeout(() => (document.querySelector<HTMLInputElement>('.unified-search-form input') ?? input.current)?.focus(), 100)
      }
    }
    const openSettings = (event: MouseEvent) => {
      if (currentView.current === 'tools' || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || link.target && link.target !== '_self') return
      const url = new URL(link.href)
      if (url.origin !== location.origin || url.pathname !== viewPaths.tools) return
      event.preventDefault()
      navigate('tools', true, `${url.pathname}${url.search}${url.hash}`)
    }
    window.addEventListener('popstate', popstate)
    window.addEventListener('keydown', cmdK)
    document.addEventListener('click', openSettings)
    return () => {
      window.removeEventListener('popstate', popstate)
      window.removeEventListener('keydown', cmdK)
      document.removeEventListener('click', openSettings)
    }
  }, [view])

  return {
    view,
    navigate,
    returnHome,
    readerQuery,
    readerNoteId,
    readingItem,
    setReadingItem,
    readerReturn,
    readerReturnPath,
    setReaderReturn,
    returnFromReader,
    returnToPath,
    readerSourceID,
    scrollPositions,
    viewportTarget,
    viewportVersion,
  }
}
