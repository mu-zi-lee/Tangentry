import type { ContentItem, UnifiedSearchResponse } from '../../shared/api/types'
import { creatorViewSupported } from '../../shared/ui/cardHelpers'

export type SearchGroup = { key: string; title: string; items: ContentItem[]; error?: string }
export type SearchMode = 'grouped' | 'mixed'

const creatorSubscriptionPlatforms = ['bilibili', 'youtube'] as const

export type CreatorPlatformSupport = {
  view: boolean
  subscribe: boolean
}

export type SearchFilters = {
  platform?: string
  kind?: string
  from?: number
  to?: number
  cursor?: string
}

export function creatorPlatformSupport(platform: string): CreatorPlatformSupport {
  return {
    view: creatorViewSupported(platform),
    subscribe: (creatorSubscriptionPlatforms as readonly string[]).includes(platform),
  }
}

export function buildSearchParams(query: string, filters: SearchFilters = {}): URLSearchParams {
  const params = new URLSearchParams({ q: query })
  if (filters.platform) params.set('platform', filters.platform)
  if (filters.kind) params.set('kind', filters.kind)
  if (filters.from) params.set('from', String(filters.from))
  if (filters.to) params.set('to', String(filters.to))
  if (filters.cursor) params.set('cursor', filters.cursor)
  return params
}

export function groupSearchResults(result: UnifiedSearchResponse, labels: Record<string, string>): SearchGroup[] {
  const groups: SearchGroup[] = []
  if (result.local.items.length) groups.push({ key: 'local', title: '本机资料库与订阅', items: result.local.items })
  for (const [key, source] of Object.entries(result.sources)) {
    if (!source.page.items.length && !source.error) continue
    groups.push({ key, title: labels[key] ?? key, items: source.page.items, error: source.error })
  }
  return groups
}

export function mergeSearchItems(groups: SearchGroup[]): ContentItem[] {
  const seen = new Set<string>()
  const items = groups.flatMap(group => group.items.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  }))
  return items.sort((a, b) => b.publishedAt - a.publishedAt)
}

export function appendSearchItems(existing: ContentItem[], next: ContentItem[]): ContentItem[] {
  const seen = new Set(existing.map(item => item.id))
  return [...existing, ...next.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })]
}
