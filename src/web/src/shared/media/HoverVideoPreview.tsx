import type { ContentItem } from '../api/types'

export function HoverVideoPreview({ item, active }: { item: ContentItem; active: boolean }) {
  // Kept as a compatibility no-op for callers outside discovery cards. Hover
  // previews are intentionally disabled to avoid background media sessions.
  void item
  void active
  return null
}
