import { expect, test } from 'vitest'
import { imageCoverSize } from './useImageCoverSize'
import type { ContentItem } from '../../api/types'

const item = (fields: Partial<ContentItem>) => ({ thumbnailUrl: 'cover', ...fields }) as ContentItem

test('uses recommendation cover dimensions or the matching gallery image', () => {
  expect(imageCoverSize(item({ thumbnailWidth: 900, thumbnailHeight: 1200 }))).toEqual({ width: 900, height: 1200 })
  expect(imageCoverSize(item({ images: [{ url: 'other', width: 1, height: 1 }, { url: 'cover', width: 1200, height: 800 }] }))).toEqual({ width: 1200, height: 800 })
  expect(imageCoverSize(item({ images: [{ url: 'other', width: 1, height: 1 }] }))).toBeUndefined()
  expect(imageCoverSize(item({ thumbnailWidth: -1, thumbnailHeight: 0 }))).toBeUndefined()
})
