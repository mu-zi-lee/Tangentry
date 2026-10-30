import { useState, type SyntheticEvent } from 'react'
import type { ContentItem } from '../../api/types'

type CoverSize = { width: number; height: number }
const sizes = new Map<string, CoverSize>()

function validSize(width?: number, height?: number): CoverSize | undefined {
  return width && height && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : undefined
}

export function imageCoverSize(item: ContentItem) {
  const cover = item.images?.find(image => image.url === item.thumbnailUrl)
  return validSize(item.thumbnailWidth, item.thumbnailHeight) ?? validSize(cover?.width, cover?.height)
}

export function useImageCoverSize(item: ContentItem) {
  const [loaded, setLoaded] = useState<{ url: string; size: CoverSize }>()
  const size = (loaded?.url === item.thumbnailUrl ? loaded.size : undefined) ?? sizes.get(item.thumbnailUrl) ?? imageCoverSize(item)
  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    const actual = validSize(image.naturalWidth, image.naturalHeight)
    if (!actual) return
    if (sizes.size >= 512) sizes.delete(sizes.keys().next().value!)
    sizes.set(item.thumbnailUrl, actual)
    if (size?.width !== actual.width || size?.height !== actual.height) setLoaded({ url: item.thumbnailUrl, size: actual })
  }
  return { size, onLoad }
}
