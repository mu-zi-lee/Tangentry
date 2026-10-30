import { useMemo, useState } from 'react'
import type { ContentItem } from '../shared/api/types'
import type { View } from './navigation'

export type ContentView = 'search' | 'library'
export type Layout = 'grid' | 'list'
export type CollectionSort = 'default' | 'oldest'
type CollectionFilters = Record<ContentView, string>
type CollectionLayouts = Record<ContentView, Layout>
type CollectionSorts = Record<ContentView, CollectionSort>

interface CollectionViewOptions {
  view: View
  libraryItems: ContentItem[]
  discoveryItems: ContentItem[]
}

export function useCollectionView({ view, libraryItems, discoveryItems }: CollectionViewOptions) {
  const [filters, setFilters] = useState<CollectionFilters>({ search: '', library: '' })
  const [layouts, setLayouts] = useState<CollectionLayouts>({ search: 'grid', library: 'grid' })
  const [sorts, setSorts] = useState<CollectionSorts>({ search: 'default', library: 'default' })
  const contentView: ContentView = view === 'library' ? 'library' : 'search'
  const sourceItems = contentView === 'library' ? libraryItems : discoveryItems
  const items = useMemo(() => {
    const filter = filters[contentView].trim().toLocaleLowerCase()
    const result = sourceItems.filter(item => !filter || `${item.title} ${item.author}`.toLocaleLowerCase().includes(filter))
    return contentView === 'search' && sorts.search === 'oldest' ? [...result].reverse() : result
  }, [sourceItems, filters, sorts, contentView])

  return {
    contentView,
    filters,
    setFilters,
    layouts,
    setLayouts,
    sorts,
    setSorts,
    sourceItems,
    items,
  }
}
