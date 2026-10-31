import { Button } from '../../components/ui'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ContentItem } from '../api/types'
import { publicationText } from './ContentCard'
import { cachedNote } from '../data/noteDetails'
import { cachedPublication, readPublication } from '../data/publicationDetails'
import { retryThroughProxy, sourceImageURL } from '../media/sourceImage'
import { creatorViewSupported, platformColorToken, platformLabel } from './cardHelpers'

export function AuthorAvatar({ item, resolveMissing = true }: { item: ContentItem; resolveMissing?: boolean }) {
  const node = useRef<HTMLDivElement>(null)
  const [resolved, setResolved] = useState(() => cachedPublication(item.id))
  const note = item.platform === 'xiaohongshu' ? cachedNote(item.id) : undefined
  const cachedAvatar = item.authorAvatarUrl || note?.authorAvatarUrl || resolved?.authorAvatarUrl
  useEffect(() => {
    setResolved(cachedPublication(item.id))
    const cachedNoteValue = item.platform === 'xiaohongshu' ? cachedNote(item.id) : undefined
    if (!resolveMissing || item.authorAvatarUrl || cachedNoteValue?.authorAvatarUrl || (item.platform !== 'youtube' && item.platform !== 'xiaohongshu')) return
    let active = true
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void readPublication(item, true).then(value => { if (active) setResolved(value) })
    })
    if (node.current) observer.observe(node.current)
    return () => { active = false; observer.disconnect() }
  }, [item.id, item.url, item.authorAvatarUrl, item.platform, resolveMissing])
  const avatar = cachedAvatar
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [avatar])
  return <div ref={node} className="author-avatar">{avatar && !failed
    ? <img src={sourceImageURL(item,avatar)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => retryThroughProxy(event, item, avatar) || setFailed(true)}/>
    : <div className="author-avatar-placeholder">{item.author ? item.author[0].toUpperCase() : '?'}</div>}</div>
}

export function AuthorName({ item, showPlatform = true, discoveryType, discoveryReason }: { item: ContentItem; showPlatform?: boolean; discoveryType?: '订阅' | '推荐' | '探索'; discoveryReason?: string }) {
  const platformStyle = { '--platform-color': `var(${platformColorToken(item.platform)})` } as CSSProperties
  return <span className="card-source-line"><span className="author-name">{item.author || (item.platform === 'rss' ? '订阅来源' : '未知作者')}</span>{showPlatform && <span className="card-platform" data-platform={item.platform} style={platformStyle}>{platformLabel(item.platform)}</span>}{discoveryType && <span className="discovery-reason-badge" title={discoveryReason || undefined}>{discoveryType}</span>}</span>
}

export function AuthorLink({ item, onCreator, showAvatar = true, showPlatform = true, resolveMissing = true, discoveryType, discoveryReason, children }: { item: ContentItem; onCreator?: (item: ContentItem) => void; showAvatar?: boolean; showPlatform?: boolean; resolveMissing?: boolean; discoveryType?: '订阅' | '推荐' | '探索'; discoveryReason?: string; children?: ReactNode }) {
  const author = item.author || (item.platform === 'rss' ? '订阅来源' : '未知作者')
  const interactive = Boolean(onCreator && item.authorId && creatorViewSupported(item.platform))
  const content = <>{showAvatar && <AuthorAvatar item={item} resolveMissing={resolveMissing} />}<div className="author-info"><AuthorName item={item} showPlatform={showPlatform} discoveryType={discoveryType} discoveryReason={discoveryReason} />{children}</div></>
  if (!interactive) return content
  return <Button variant="quiet" type="button" className="author-link" aria-label={`查看 ${author} 的最近内容`} title={`查看 ${author} 的最近内容`} onClick={() => onCreator?.(item)}>{content}</Button>
}

export function AuthorPublication({ item, resolveMissing = true }: { item: ContentItem; resolveMissing?: boolean }) {
  const node = useRef<HTMLSpanElement>(null)
  const [resolved, setResolved] = useState(() => cachedPublication(item.id))
  const [checked, setChecked] = useState(false)
  const detail = item.platform === 'xiaohongshu' && !item.publishedAt ? cachedNote(item.id) : undefined
  useEffect(() => {
    setResolved(cachedPublication(item.id))
    setChecked(false)
    if (!resolveMissing || publicationText(item) || (item.platform === 'xiaohongshu' && detail) || !['youtube', 'xiaohongshu'].includes(item.platform)) return
    let disposed = false
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void readPublication(item).then(value => { if (!disposed) { setResolved(value); setChecked(true) } })
    })
    if (node.current) observer.observe(node.current)
    return () => { disposed = true; observer.disconnect() }
  }, [item.id, item.url, item.publishedAt, item.publishedText, item.platform, detail?.publishedAt, resolveMissing])
  const label = publicationText(detail?.publishedAt ? detail : resolved?.publishedAt || resolved?.publishedText ? resolved : item)
  return <span ref={node} className="author-meta">{label || (resolveMissing && ['youtube', 'xiaohongshu'].includes(item.platform) ? checked ? '发布时间未知' : '日期待获取' : '')}</span>
}
