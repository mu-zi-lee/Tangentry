import { Button, Input } from '../../components/ui'
import { ArrowRight, Clock3, Search, Trash2 } from 'lucide-react'
import type { ContentItem } from '../../shared/api/types'
import { CardCollection } from '../../shared/ui/CardCollection'
import { ModernGalleryCard } from '../../shared/ui/ModernGalleryCard'
import { useProgressOverview } from '../progress/useProgressOverview'
import type { useViewingHistory } from './useViewingHistory'

export function ViewingHistoryToolbar({ history, query, onQuery, onClear }: {
  history: ReturnType<typeof useViewingHistory>; query: string; onQuery: (value: string) => void; onClear: () => void
}) {
  const count = history.entries.filter(({ item }) => `${item.title} ${item.author}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).length
  return <div className="history-toolbar">
    <span className="history-count" role="status">{query ? `${count} / ` : ''}{history.entries.length} 条记录</span>
    <label className="library-search"><Search size={15} aria-hidden="true"/><Input type="search" aria-label="搜索历史" placeholder="搜索标题或作者" value={query} onChange={event => onQuery(event.target.value)}/></label>
    {history.entries.length > 0 && <Button variant="quiet" iconOnly type="button" className="icon-button history-clear" aria-label="清空历史" title="清空历史" onClick={onClear}><Trash2 size={16}/></Button>}
  </div>
}

function visitDay(openedAt: number) {
  const date = new Date(openedAt)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  const label = date.toDateString() === today.toDateString() ? '今天'
    : date.toDateString() === yesterday.toDateString() ? '昨天'
    : date.toLocaleDateString('zh-CN', { ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}), month: 'long', day: 'numeric' })
  return { key, label }
}

export function ViewingHistoryPage({ history, onRead, onSave, savedIDs, pending, unavailable, query, onQuery, confirmClear, onCancelClear }: {
  history: ReturnType<typeof useViewingHistory>; onRead: (item: ContentItem) => void; onSave: (item: ContentItem) => void
  savedIDs: Set<string>; pending: Set<string>; unavailable: boolean
  query: string; onQuery: (value: string) => void; confirmClear: boolean; onCancelClear: () => void
}) {
  const overview = useProgressOverview(history.entries.filter(entry => entry.item.kind === 'video' || entry.item.kind === 'audio').map(entry => entry.item.id), true)
  const entries = history.entries.filter(({ item }) => `${item.title} ${item.author}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const days = new Map<string, { label: string; entries: typeof entries }>()
  for (const entry of entries) {
    const { key, label } = visitDay(entry.openedAt)
    const day = days.get(key) ?? { label, entries: [] }
    day.entries.push(entry)
    days.set(key, day)
  }
  return <section className="history-workspace" aria-label="观看与阅读历史">
    {confirmClear && <div className="inline-feedback history-confirm" role="alert"><p>清空历史？收藏、笔记和进度不会删除。</p><Button variant="secondary" className="button button-secondary" onClick={onCancelClear}>取消</Button><Button variant="primary" className="button button-primary" onClick={() => { history.clear(); onCancelClear() }}>确认清空</Button></div>}
    {history.error && <p role="alert">{history.error}</p>}
    {entries.length ? [...days].map(([key, day]) => <section className="history-day" key={key} aria-label={`${day.label}的历史`}><h2><Clock3 size={15} aria-hidden="true"/>{day.label}<span className="count">{day.entries.length}</span></h2><CardCollection className="mixed-gallery" data-media="all" masonry aria-label="历史内容">{day.entries.map(({ item, openedAt }) => <ModernGalleryCard key={item.id} item={item} saved={savedIDs.has(item.id)} pending={unavailable || pending.has(item.id)} onRead={onRead} onSave={onSave} progress={overview.get(item.id)} status={<div className="history-card-footer"><time dateTime={new Date(openedAt).toISOString()}>{new Date(openedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 访问</time><Button variant="quiet" iconOnly className="icon-button" aria-label={`删除历史 ${item.title}`} title="删除记录" onClick={event => { event.stopPropagation(); history.remove(item.id) }}><Trash2 size={14}/></Button></div>}/>)}</CardCollection></section>) : <section className="empty-state"><div className="empty-art" aria-hidden="true"><Clock3 size={28} strokeWidth={1.3}/></div><h2>{query ? '没有匹配的历史' : '暂无观看与阅读记录'}</h2><p>{query ? '换个关键词，找回读过的内容。' : '打开过的视频、文章和播客都会留在这里。'}</p>{query ? <Button variant="secondary" className="button button-secondary" onClick={() => onQuery('')}>查看全部历史</Button> : <a className="empty-link" href="/">去发现内容<ArrowRight size={15}/></a>}</section>}
  </section>
}
