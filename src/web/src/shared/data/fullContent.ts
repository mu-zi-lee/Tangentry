import { APIError, request } from '../api/client'
import type { ContentItem } from '../api/types'

function requireFullContent(item: ContentItem, full: ContentItem): ContentItem {
  if (full.id !== item.id || full.partial) throw new Error('本机完整内容暂不可用，请返回来源重新获取。')
  return full
}

/** Read a projected card's full local copy without fetching the platform page. */
export async function readFullContent(item: ContentItem, signal?: AbortSignal): Promise<ContentItem> {
  if (!item.partial) return item
  try {
    return requireFullContent(item, await request<ContentItem>(`/library/${encodeURIComponent(item.id)}`, { signal }))
  } catch (cause) {
    if (!(cause instanceof APIError && cause.status === 404)) throw cause
  }
  let full: ContentItem
  if (['bilibili', 'youtube', 'linuxdo', 'xiaohongshu', 'xiaoyuzhou', 'douyin', 'huggingface'].includes(item.platform)) {
    try {
      full = await request<ContentItem>(`/recommendations/${encodeURIComponent(item.platform)}/items/${encodeURIComponent(item.id)}`, { signal })
    } catch (cause) {
      if (!(cause instanceof APIError && cause.status === 404)) throw cause
      full = await request<ContentItem>(`/subscription-inbox/${encodeURIComponent(item.id)}`, { signal })
    }
  } else {
    full = await request<ContentItem>(`/subscription-inbox/${encodeURIComponent(item.id)}`, { signal })
  }
  return requireFullContent(item, full)
}
