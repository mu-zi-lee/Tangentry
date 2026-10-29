import type { ContentItem } from '../shared/api/types'

export type View = 'discovery' | 'bilibili' | 'search' | 'library' | 'subscriptions' | 'downloads' | 'tools' | 'reader' | 'notes' | 'history'
export type ViewportTarget = { top: number; sourceID: string; focusID: string; routeKey: string }
export type ViewportSnapshot = ViewportTarget & { view: View }
export const viewPaths: Record<View, string> = { bilibili: '/bilibili', history: '/history', discovery: '/', search:'/search', library: '/library', subscriptions: '/subscriptions', downloads: '/downloads', tools: '/tools', reader: '/reader', notes: '/notes' }
export const viewNames: Record<View, string> = { bilibili: 'B站', history: '历史', discovery: '发现', search:'统一搜索', library: '收藏', subscriptions: '订阅管理', downloads: '下载', tools: '设置', reader: '阅读与播放', notes: '笔记' }
export const viewFromURL = (): View => Object.entries(viewPaths).find(([, path]) => path === location.pathname)?.[0] as View ?? 'discovery'

/** Keep query and hash as part of a page identity so same-view history can restore itself. */
export function routeKey(path?: string) {
  const raw = path ?? (typeof window === 'undefined' ? '/' : window.location.href)
  try {
    const url = new URL(raw, 'http://tangentry.local')
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    // Keep malformed input comparable without allowing a return action to throw.
    return raw
  }
}

/** Resolve a viewport snapshot without touching browser or DOM state. */
export function resolveViewportTarget(targetRoute: string, snapshots: ReadonlyMap<string, ViewportSnapshot>, fallback: ViewportTarget): ViewportTarget {
  const canonicalRoute = routeKey(targetRoute)
  const snapshot = snapshots.get(canonicalRoute) ?? snapshots.get(targetRoute)
  if (!snapshot) return { ...normalizeRestoreTarget(fallback), routeKey: canonicalRoute }
  return {
    ...normalizeRestoreTarget(snapshot),
    routeKey: canonicalRoute,
  }
}

export type NavigationAction = 'pop' | 'replace' | 'push'

/** The app-owned state needed to return to a page without losing its URL or viewport. */
export type NavigationSnapshot = {
  path: string
  view?: View
  top?: number
  sourceID?: string
  focusID?: string
}

export type NavigationReturnInput = {
  currentPath: string
  source?: NavigationSnapshot | null
  hasMatchingHistoryEntry: boolean
  fallback: NavigationSnapshot
  /** Use push only when the caller deliberately wants a new fallback entry. */
  fallbackAction?: Exclude<NavigationAction, 'pop'>
}

export type NavigationReturnDecision = {
  action: NavigationAction
  path: string
  restore: {
    top: number
    sourceID: string
    focusID: string
  }
}

export type CreatorReturn = { path: string; view: View; label: string }

/** Resolve the creator view's contextual return target and Chinese label. */
export function creatorReturnFromPath(path?: string): CreatorReturn {
  const fallback: CreatorReturn = { path: viewPaths.search, view: 'search', label: '返回搜索' }
  if (!path || !isAppPath(path)) return fallback
  const target = routeKey(path)
  const pathname = new URL(target, 'http://tangentry.local').pathname
  const view = Object.entries(viewPaths).find(([, value]) => value === pathname)?.[0] as View | undefined
  if (!view) return fallback
  const label = view === 'reader' ? '返回阅读' : view === 'discovery' ? '返回发现' : view === 'search' ? '返回搜索' : '返回'
  return { path: target, view, label }
}

const normalizeRestoreTarget = (snapshot: NavigationSnapshot | ViewportTarget | null | undefined) => ({
  top: Number.isFinite(snapshot?.top) ? Math.max(0, snapshot?.top ?? 0) : 0,
  sourceID: typeof snapshot?.sourceID === 'string' ? snapshot.sourceID : '',
  focusID: typeof snapshot?.focusID === 'string' ? snapshot.focusID : '',
})

const isAppPath = (path: string) => {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return false
  try {
    // Parsing catches malformed escapes while retaining query strings and hashes.
    const parsed = new URL(path, 'http://tangentry.local')
    return parsed.origin === 'http://tangentry.local' && Object.values(viewPaths).includes(parsed.pathname)
  } catch {
    return false
  }
}

const restoreTarget = (snapshot: NavigationSnapshot | null | undefined) => ({
  ...normalizeRestoreTarget(snapshot),
})

/**
 * Resolve an in-app return without trusting an arbitrary browser history entry.
 *
 * A matching app-owned history entry can be popped. Otherwise the complete source
 * URL is replaced so query/hash state (search filters, saved views, or tabs) survives
 * without adding a duplicate entry. Direct links and malformed/external snapshots use
 * the caller-provided fallback and never call the browser's unguarded back operation.
 */
export function navigateBack({ currentPath, source, hasMatchingHistoryEntry, fallback, fallbackAction = 'replace' }: NavigationReturnInput): NavigationReturnDecision {
  const currentRoute = routeKey(currentPath)
  const sourceRoute = source && isAppPath(source.path) ? routeKey(source.path) : ''
  const sourcePath = sourceRoute && sourceRoute !== currentRoute ? sourceRoute : ''
  const validFallback = isAppPath(fallback.path)
  const fallbackPath = validFallback ? routeKey(fallback.path) : viewPaths.discovery
  const path = sourcePath || fallbackPath
  const useSourceHistory = Boolean(sourcePath && hasMatchingHistoryEntry && sourcePath !== currentRoute)
  const restore = sourcePath ? source : validFallback ? fallback : null
  return {
    action: useSourceHistory ? 'pop' : sourcePath ? 'replace' : fallbackAction,
    path,
    restore: restoreTarget(restore),
  }
}

/** Backwards-compatible name for callers that describe the result as a decision. */
export const decideNavigationReturn = navigateBack

export const readerQueryFromURL = () => new URLSearchParams(location.search).get('video') ?? new URLSearchParams(location.search).get('contentId') ?? ''
export const readerNoteFromURL = () => {
  const id = new URLSearchParams(location.search).get('note') ?? ''
  return /^[a-f0-9]{32}$/.test(id) ? id : ''
}
export function readerPath(contentId: string, noteId = '') {
  const params = /^bilibili:BV[0-9A-Za-z]{10}$/.test(contentId)
    ? new URLSearchParams({ video: contentId.slice('bilibili:'.length) })
    : new URLSearchParams({ contentId })
  if (/^[a-f0-9]{32}$/.test(noteId)) params.set('note', noteId)
  return `${viewPaths.reader}?${params}`
}

/** Build the reader URL for a feed item without treating non-video B站 IDs as BV IDs. */
export function readerPathForItem(item: Pick<ContentItem, 'id' | 'platform' | 'platformId' | 'kind'>) {
  const params = item.platform === 'bilibili' && item.kind === 'video' && /^BV[0-9A-Za-z]{10}$/.test(item.platformId)
    ? new URLSearchParams({ video: item.platformId })
    : new URLSearchParams({ contentId: item.id })
  return `${viewPaths.reader}?${params}`
}
