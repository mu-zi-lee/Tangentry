import { Button } from '../../../components/ui'
import { Image as ImageIcon } from 'lucide-react'
import { GalleryCardFrame } from './GalleryCardFrame'
import { GalleryCardTitle } from './GalleryCardText'
import { SaveCardAction } from './GalleryCardActions'
import { useCardCover } from './useCardCover'
import { useImageCoverSize } from './useImageCoverSize'
import type { GalleryCardContentProps } from './types'
import { retryThroughProxy, sourceImageURL } from '../../media/sourceImage'
import { AuthorLink, AuthorPublication } from '../CardAuthor'

export function ImageGalleryCard({ item, origin, discoveryReason, discoveryType, saved, pending, onRead, onSave, onCreator, status, excerpt, discovery = false, onFeedback }: GalleryCardContentProps) {
  const { failed: coverFailed, setFailed: setCoverFailed } = useCardCover(item.thumbnailUrl)
  const { size, onLoad } = useImageCoverSize(item)
  return (
    <GalleryCardFrame item={item} origin={origin} discoveryReason={discoveryReason} className="card-image" onRead={onRead} status={status} onFeedback={discovery ? onFeedback : undefined}>
      <Button variant="quiet" className="modern-card-thumbnail" onClick={() => onRead(item)} aria-label={`查看图集 ${item.title}`}>
        {item.thumbnailUrl && !coverFailed ? (
          <img src={sourceImageURL(item, item.thumbnailUrl)} width={size?.width} height={size?.height} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={onLoad} onError={event => retryThroughProxy(event, item, item.thumbnailUrl) || setCoverFailed(true)} />
        ) : (
          <div className="thumbnail-placeholder"><ImageIcon size={48} /></div>
        )}
        {item.images && item.images.length > 1 && <span className="card-image-count"><ImageIcon size={14} />{item.images.length} 张</span>}
      </Button>
      <div className="modern-card-content">
        <GalleryCardTitle item={item} onRead={onRead} />
        {excerpt}
        <div className="modern-card-author">
          <AuthorLink item={item} onCreator={onCreator} discoveryType={discovery ? discoveryType : undefined} discoveryReason={discoveryReason}><AuthorPublication item={item} /></AuthorLink>
          <div className="modern-card-actions"><SaveCardAction item={item} saved={saved} pending={pending} onSave={onSave} /></div>
        </div>
      </div>
    </GalleryCardFrame>
  )
}
