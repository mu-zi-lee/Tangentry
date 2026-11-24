// Persisted workbench preferences. Parsing is pure and defensive: a corrupt or
// partial localStorage value falls back to the labelled defaults instead of
// throwing or silently producing an invalid request.

import { normalizeOptions, type WorkbenchOptions } from './workbench'

export const PREFS_KEY = 'tangentry-retrieval-workbench'

/** How many passage cards to render at once; the server can return up to topK. */
export const PAGE_SIZES = [10, 20, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 10

export interface WorkbenchPrefs {
  options: WorkbenchOptions
  /** Onboarding panel expanded. Open on first visit, remembered afterwards. */
  guideOpen: boolean
  /** Advanced per-run knobs expanded. */
  advancedOpen: boolean
  /** Retrieval (embedding/rerank) settings panel expanded, kept on this page. */
  settingsOpen: boolean
  /** Highlight the query terms inside the returned passage text. */
  highlight: boolean
  /** Passage cards rendered per page; the rest are one click away. */
  pageSize: number
}

export function defaultPrefs(): WorkbenchPrefs {
  return { options: normalizeOptions(undefined), guideOpen: true, advancedOpen: false, settingsOpen: false, highlight: true, pageSize: DEFAULT_PAGE_SIZE }
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Parses a stored value; unknown keys are ignored and bad values fall back. */
export function parsePrefs(raw: string | null): WorkbenchPrefs {
  const base = defaultPrefs()
  if (!raw) return base
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return base
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
  const value = parsed as Record<string, unknown>
  const pageSize = PAGE_SIZES.includes(value.pageSize as typeof PAGE_SIZES[number])
    ? value.pageSize as number : base.pageSize
  return {
    options: normalizeOptions(value.options as Partial<WorkbenchOptions> | undefined),
    guideOpen: bool(value.guideOpen, base.guideOpen),
    advancedOpen: bool(value.advancedOpen, base.advancedOpen),
    settingsOpen: bool(value.settingsOpen, base.settingsOpen),
    highlight: bool(value.highlight, base.highlight),
    pageSize,
  }
}

export function serializePrefs(prefs: WorkbenchPrefs): string {
  return JSON.stringify(prefs)
}

/**
 * Slices the server's passages for display. Nothing is discarded: the remaining
 * count is always reported so a truncated list is never mistaken for the result.
 */
export function paginate<T>(passages: readonly T[], shown: number): { visible: T[]; remaining: number } {
  const size = Number.isFinite(shown) && shown > 0 ? Math.trunc(shown) : DEFAULT_PAGE_SIZE
  return { visible: passages.slice(0, size), remaining: Math.max(0, passages.length - size) }
}
