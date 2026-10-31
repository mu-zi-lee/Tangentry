import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ContentItem } from '../../api/types'
import { VideoGalleryCard } from './VideoGalleryCard'
import { HoverVideoPreview } from '../../media/HoverVideoPreview'
import { YouTubeHoverPreview } from '../../media/YouTubeHoverPreview'

describe('cover-only video cards', () => {
  it.each(['bilibili', 'youtube', 'douyin'] as const)('renders no media nodes for %s', platform => {
    const item: ContentItem = { id: `${platform}:fixture`, platform, platformId: 'fixture', kind: 'video', title: '封面测试', author: '', authorId: '', url: 'https://example.com/video', thumbnailUrl: '', mediaUrl: 'https://example.com/video.mp4', description: '', durationSeconds: 60, publishedAt: 0 }
    const html = renderToStaticMarkup(<VideoGalleryCard item={item} saved={false} pending={false} excerpt={null} onRead={() => {}} onSave={() => {}} />)
    expect(html).not.toMatch(/<(video|audio|iframe)\b/)
    expect(html).toContain('打开视频 封面测试')
    expect(renderToStaticMarkup(<HoverVideoPreview item={item} active />)).toBe('')
    expect(renderToStaticMarkup(<YouTubeHoverPreview id="dQw4w9WgXcQ" />)).toBe('')
  })
})
