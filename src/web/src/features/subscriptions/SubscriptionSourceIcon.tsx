import { CirclePlay, GraduationCap, Rss, Sparkles, TvMinimal } from 'lucide-react'
import type { SubscriptionSource } from '../../shared/api/types'
import { isYouTubeSource } from './sourcePresentation'

export const sourcePlatform = (source: Pick<SubscriptionSource, 'id'>) => source.id.startsWith('youtube:channel:') ? 'youtube' : source.id.startsWith('rss:') ? 'rss' : source.id.startsWith('arxiv:') ? 'arxiv' : source.id.startsWith('huggingface:') ? 'huggingface' : 'bilibili'

export function SubscriptionSourceIcon({ source, size = 17 }: { source: SubscriptionSource; size?: number }) {
  const platform = isYouTubeSource(source) ? 'youtube' : sourcePlatform(source)
  const Icon = platform === 'youtube' ? CirclePlay : platform === 'rss' ? Rss : platform === 'arxiv' ? GraduationCap : platform === 'huggingface' ? Sparkles : TvMinimal
  return <span className="subscription-source-avatar" data-platform={platform} aria-hidden="true"><Icon size={size} strokeWidth={1.7}/></span>
}
