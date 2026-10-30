import { Play } from 'lucide-react'
import { useState } from 'react'
import type { GalleryCardContentProps } from './types'
import { GalleryCardFrame } from './GalleryCardFrame'
import { GalleryCardTitle } from './GalleryCardText'
import { VideoCardActions } from './GalleryCardActions'
import { useCardCover } from './useCardCover'
import { formatDuration } from '../ContentCard'
import { HoverVideoPreview } from '../../media/HoverVideoPreview'
import { retryThroughProxy, sourceImageURL } from '../../media/sourceImage'
import { AuthorLink, AuthorPublication } from '../CardAuthor'

export function VideoGalleryCard({ item, origin, discoveryReason, discoveryType, saved, pending, onRead, onSave, onCreator, onDownload, progress, status, discovery = false, excerpt, onFeedback }: GalleryCardContentProps) {
  const { failed: coverFailed, setFailed: setCoverFailed } = useCardCover(item.thumbnailUrl)
  const [hoverPreview, setHoverPreview] = useState(false)
  const [previewVisit, setPreviewVisit] = useState(0)
  const progressPercent = progress && progress.durationSeconds > 0
    ? Math.max(0, Math.min(100, (progress.positionSeconds / progress.durationSeconds) * 100))
    : 0
  const actions = <VideoCardActions item={item} saved={saved} pending={pending} onSave={onSave} onDownload={onDownload} />

  return (
    <GalleryCardFrame item={item} origin={origin} discoveryReason={discoveryReason} className="card-video" onRead={onRead} status={status} dataPlatform onFeedback={discovery ? onFeedback : undefined}>
      <div
        className="modern-card-thumbnail"
        onPointerEnter={event => {
          if (event.pointerType === 'mouse' && window.matchMedia('(hover: hover)').matches) {
            setPreviewVisit(value => value + 1)
            setHoverPreview(true)
          }
        }}
        onPointerLeave={() => setHoverPreview(false)}
        onClick={event => {
          const target = event.target as Element
          if (target.closest('button, iframe')) return
          const preview = target.closest('video')
          if (preview && event.clientY >= preview.getBoundingClientRect().bottom - 40) return
          onRead(item)
        }}
        role="group"
        tabIndex={0}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          event.stopPropagation()
          onRead(item)
        }}
        aria-label={`预览视频 ${item.title}`}
      >
        <HoverVideoPreview key={previewVisit} item={item} active={hoverPreview} />
        {item.thumbnailUrl && !coverFailed ? (
          <img src={sourceImageURL(item, item.thumbnailUrl)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => retryThroughProxy(event, item, item.thumbnailUrl) || setCoverFailed(true)} />
        ) : (
          <div className="thumbnail-placeholder" aria-hidden="true">
            <Play size={48} />
          </div>
        )}
        <div className="card-play-overlay">
          <div className="card-play-button">
            <Play size={28} fill="currentColor" />
          </div>
        </div>
        {item.durationSeconds > 0 && <span className="card-duration">{formatDuration(item.durationSeconds)}</span>}
        {progress && progressPercent > 0 && progressPercent < 99 && (
          <div className="card-progress-bar">
            <div className="card-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        )}
      </div>
      <div className="modern-card-content">
        <GalleryCardTitle item={item} onRead={onRead} />
        {excerpt}
        {item.likeCount ? <div className="discovery-card-stats">{item.likeCount} 赞</div> : null}
        <div className="modern-card-author">
          <AuthorLink item={item} onCreator={onCreator} discoveryType={discovery ? discoveryType : undefined} discoveryReason={discoveryReason}><AuthorPublication item={item} /></AuthorLink>
          {actions}
        </div>
      </div>
    </GalleryCardFrame>
  )
}
