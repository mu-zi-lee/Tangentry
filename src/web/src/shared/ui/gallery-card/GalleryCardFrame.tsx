import { Button } from '../../../components/ui'
import { MoreVertical } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { ContentItem } from '../../api/types'

interface Props {
  item: ContentItem
  origin?: string
  discoveryReason?: string
  className: string
  onRead: (item: ContentItem) => void
  children: ReactNode
  status?: ReactNode
  dataPlatform?: boolean
  onFeedback?: GalleryFeedbackHandler
}

export type GalleryFeedbackHandler = (type: 'more' | 'less' | 'hide' | 'block_creator', target: 'item' | 'source' | 'creator' | 'topic', value: string) => void

export function GalleryCardFrame({ item, origin, discoveryReason, className, onRead, children, status, dataPlatform = false, onFeedback }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const reposition = () => {
      const button = trigger.current, panel = menu.current
      if (!button || !panel) return
      const rect = button.getBoundingClientRect()
      panel.style.left = `${Math.max(8, Math.min(innerWidth - panel.offsetWidth - 8, rect.right - panel.offsetWidth))}px`
      panel.style.top = `${Math.max(8, Math.min(innerHeight - panel.offsetHeight - 8, rect.bottom + panel.offsetHeight + 6 > innerHeight ? rect.top - panel.offsetHeight - 6 : rect.bottom + 6))}px`
    }
    reposition()
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true) }
  }, [menuOpen])
  const creator = item.authorId || item.author
  const feedback = (type: 'more' | 'less' | 'hide' | 'block_creator', target: 'item' | 'source' | 'creator' | 'topic', value: string) => {
    onFeedback?.(type, target, value)
    menu.current?.hidePopover()
  }
  const openCard = (event: MouseEvent<HTMLElement>) => {
    if (item.kind === 'video' && !(event.target as Element).closest('.modern-card-content')) return
    if ((event.target as Element).closest('button, a, input, select, textarea, summary, [role="button"]') || window.getSelection()?.toString()) return
    onRead(item)
  }

  const openCardFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    if (event.repeat) return
    onRead(item)
  }

  return (
    <article
      tabIndex={0}
      onKeyDown={openCardFromKeyboard}
      className={`modern-card ${className}`}
      onClick={openCard}
      data-testid="content-card"
      aria-label={`阅读 ${item.title}`}
      {...(dataPlatform ? { 'data-platform': item.platform } : {})}
      title={discoveryReason || origin}
    >
      {onFeedback && <div className="discovery-feedback-menu" onClick={event => event.stopPropagation()}>
        <Button ref={trigger} variant="quiet" type="button" className="card-action-button" aria-label="调整发现偏好" title="调整发现偏好" aria-expanded={menuOpen} aria-controls={menuId} popoverTarget={menuId}><MoreVertical size={17} /></Button>
        <div ref={menu} id={menuId} popover="auto" className="discovery-feedback-popover" role="group" aria-label="调整发现偏好" onToggle={event => setMenuOpen(event.newState === 'open')}>
          {menuOpen && <><strong>调整发现偏好</strong>
          <div className="discovery-feedback-section" role="group" aria-label="想多看看"><span>想多看看</span>
            <Button variant="quiet" type="button" onClick={() => feedback('more', 'source', item.platform)}>同来源</Button>
            <Button variant="quiet" type="button" onClick={() => feedback('more', 'creator', creator)}>同创作者</Button>
            {item.category && <Button variant="quiet" type="button" onClick={() => feedback('more', 'topic', item.category!)}>同主题</Button>}
          </div>
          <div className="discovery-feedback-section" role="group" aria-label="暂时少些（7 天）"><span>暂时少些（7 天）</span>
            <Button variant="quiet" type="button" onClick={() => feedback('less', 'source', item.platform)}>同来源</Button>
            <Button variant="quiet" type="button" onClick={() => feedback('less', 'creator', creator)}>同创作者</Button>
            {item.category && <Button variant="quiet" type="button" onClick={() => feedback('less', 'topic', item.category!)}>同主题</Button>}
          </div>
          <div className="discovery-feedback-dismiss">
            <Button variant="quiet" type="button" onClick={() => feedback('hide', 'item', item.id)}>不感兴趣</Button>
            <Button variant="quiet" type="button" onClick={() => feedback('block_creator', 'creator', creator)}>屏蔽此创作者</Button>
          </div></>}
        </div>
      </div>}
      {children}
      {status}
    </article>
  )
}
