import { Button, Input } from '../../components/ui'
import { AlertCircle, Bookmark, ChevronDown, ChevronRight, Circle, FileText, Filter, Headphones, Image, Inbox, Layers, LoaderCircle, Newspaper, Play, RefreshCw, Search, Settings2, X } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { SavedView, SubscriptionSource } from '../../shared/api/types'
import { sourceLabel } from './sourcePresentation'
import { SubscriptionSourceIcon } from './SubscriptionSourceIcon'
import { needsAttention } from './sourceHealth'
import { sourceSections } from './sourceSections'
import { useCollapsedGroups } from './useCollapsedGroups'
import { allSubscriptionsID, type useSubscriptions } from './useSubscriptions'
import type { useSubscriptionGroups } from './useSubscriptionGroups'

const viewIcons = { 'file-text': FileText, play: Play, headphones: Headphones, image: Image, bookmark: Bookmark, filter: Filter, newspaper: Newspaper, circle: Circle } as const

type Place = { mode: 'latest' | 'history'; viewID: string }

/** Arrow keys walk the rail like a list; Tab still leaves it in one step per section. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const target = event.target as HTMLElement
  if (!target.matches('[data-nav-item]')) return
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-nav-item]')].filter(node => node.getClientRects().length > 0)
  const index = items.indexOf(target)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1)
  if (next < 0 || next >= items.length) return
  event.preventDefault()
  items[next].focus()
}

function NavItem({ icon, label, detail, trail, current, onClick, title }: { icon: ReactNode; label: string; detail?: string; trail?: ReactNode; current: boolean; onClick: () => void; title?: string }) {
  return <Button variant="quiet" data-nav-item className="subscription-nav-item" aria-current={current ? 'true' : undefined} title={title} onClick={onClick}>
    {icon}
    <span className="subscription-nav-copy"><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
    {trail !== undefined && <span className="subscription-nav-trail">{trail}</span>}
  </Button>
}

export function SubscriptionNavigator({ state, groups, place, views, onSelectSource, onHistory, onSelectView, onManage, onReload }: {
  state: ReturnType<typeof useSubscriptions>
  groups: ReturnType<typeof useSubscriptionGroups>
  place: Place
  views: SavedView[]
  onSelectSource: (id: string) => void
  onHistory: () => void
  onSelectView: (id: string) => void
  onManage: () => void
  onReload: () => void
}) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const selectedSource = place.mode === 'latest' ? state.sources.find(source => source.id === state.selectedId) : undefined
  const { collapsed, toggle } = useCollapsedGroups(selectedSource?.groupId ?? '')
  const sections = useMemo(() => sourceSections(state.sources, groups.groups, keyword), [state.sources, groups.groups, keyword])
  const builtIn = views.filter(view => view.builtin)
  const custom = views.filter(view => !view.builtin)
  const activeView = views.find(view => view.id === place.viewID)
  const currentLabel = place.mode === 'history' ? activeView?.name ?? '历史收件箱' : state.selectedId === allSubscriptionsID ? '全部订阅' : selectedSource?.name ?? '选择来源'
  const matches = sections.reduce((total, section) => total + section.visible.length, 0)
  const go = (run: () => void) => () => {
    run()
    setOpen(false)
    // On narrow screens the rail collapses above the stream; continue reading from the stream.
    if (window.matchMedia('(max-width: 760px)').matches) requestAnimationFrame(() => document.getElementById('subscription-stream')?.focus({ preventScroll: true }))
  }
  const sourceItem = (source: SubscriptionSource) => {
    const attention = needsAttention(source)
    return <li key={source.id}><NavItem
      icon={<SubscriptionSourceIcon source={source} size={15}/>}
      label={source.name}
      detail={sourceLabel(source)}
      title={attention && source.refresh.message ? `${source.name}：${source.refresh.message}` : source.name}
      current={place.mode === 'latest' && source.id === state.selectedId}
      onClick={go(() => onSelectSource(source.id))}
      trail={source.active ? <span className="subscription-nav-state" data-state="active"><LoaderCircle size={12} className="spin" aria-hidden="true"/>更新中</span>
        : attention ? <span className="subscription-nav-state" data-state="attention"><AlertCircle size={12} aria-hidden="true"/>需处理</span>
        : <span className="subscription-nav-count">{source.lastUpdatedAt ? source.itemCount : '未更新'}</span>}
    /></li>
  }

  return <div className="subscription-directory" data-open={open}>
    <Button variant="secondary" className="button button-secondary subscription-directory-toggle" aria-expanded={open} aria-controls="subscription-source-directory" onClick={() => setOpen(value => !value)}>
      <Layers size={16} aria-hidden="true"/><span>{currentLabel}</span><small>{state.sources.length} 个来源</small><ChevronDown size={16} aria-hidden="true"/>
    </Button>
    <div id="subscription-source-directory">
      <aside className="subscription-navigator" aria-label="订阅导航" onKeyDown={moveFocus}>
        <nav aria-label="订阅内容" className="subscription-nav-section">
          <ul role="list">
            <li><NavItem icon={<Layers size={16} aria-hidden="true"/>} label="全部订阅" title="所有来源最新获取的内容" current={place.mode === 'latest' && state.selectedId === allSubscriptionsID} onClick={go(() => onSelectSource(allSubscriptionsID))} trail={<span className="subscription-nav-count">{state.sources.length}</span>}/></li>
            <li><NavItem icon={<Inbox size={16} aria-hidden="true"/>} label="历史收件箱" title="获取过的全部条目，包括已移除来源" current={place.mode === 'history' && !place.viewID} onClick={go(onHistory)}/></li>
          </ul>
        </nav>
        {views.length > 0 && <nav aria-label="常用订阅筛选" className="subscription-nav-section">
          <h2 className="subscription-nav-heading">视图</h2>
          <ul role="list">{builtIn.map(view => <li key={view.id}><NavItem icon={<Filter size={15} aria-hidden="true"/>} label={view.name} current={place.mode === 'history' && place.viewID === view.id} onClick={go(() => onSelectView(view.id))} trail={<span className="subscription-nav-count">{view.count}</span>}/></li>)}</ul>
          {custom.length > 0 && <ul role="list" aria-label="我的视图" className="subscription-nav-custom-views">{custom.map(view => {
            const Icon = viewIcons[view.icon as keyof typeof viewIcons] ?? Filter
            return <li key={view.id}><NavItem icon={<span className={`subscription-view-mark ${view.color}`} aria-hidden="true"><Icon size={11}/></span>} label={view.name} current={place.mode === 'history' && place.viewID === view.id} onClick={go(() => onSelectView(view.id))} trail={<span className="subscription-nav-count">{view.count}</span>}/></li>
          })}</ul>}
        </nav>}
        <nav aria-label="选择订阅来源" className="subscription-nav-section subscription-nav-sources">
          <div className="subscription-nav-heading-row">
            <h2 className="subscription-nav-heading">来源 <span className="count">{state.sources.length}</span></h2>
            <Button variant="quiet" iconOnly className="icon-button" disabled={state.loading || Boolean(state.pending) || Boolean(groups.pending)} aria-label="重新加载来源" title="重新加载来源" onClick={onReload}><RefreshCw size={14} aria-hidden="true" className={state.loading ? 'spin' : undefined}/></Button>
          </div>
          {state.sources.length > 5 && <label className="subscription-nav-search">
            <Search size={14} aria-hidden="true"/><span className="visually-hidden">筛选订阅来源</span>
            <Input type="search" aria-label="筛选订阅来源" placeholder="找来源或分组" value={keyword} onChange={event => setKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && keyword) { event.stopPropagation(); setKeyword('') } }}/>
            {keyword && <Button variant="quiet" iconOnly className="icon-button" aria-label="清除来源筛选" onClick={() => setKeyword('')}><X size={13} aria-hidden="true"/></Button>}
          </label>}
          {state.loading && !state.sources.length && <p role="status" className="field-hint">正在加载来源…</p>}
          {groups.listError && <p className="subscription-nav-hint" role="alert">{groups.listError}</p>}
          {sections.map(section => {
            if (section.kind === 'group' && keyword && !section.visible.length) return null
            const expanded = Boolean(keyword) || !collapsed.has(section.id || '__ungrouped')
            const listID = `subscription-nav-group-${section.id || 'ungrouped'}`
            const attention = section.members.filter(needsAttention).length
            return <div className="subscription-nav-group" key={section.id || '__ungrouped'}>
              <Button variant="quiet" data-nav-item className="subscription-nav-group-toggle" aria-expanded={expanded} aria-controls={listID} aria-label={`分组 ${section.name}，${section.members.length} 个来源${attention ? `，${attention} 个需处理` : ''}`} onClick={() => { if (!keyword) toggle(section.id || '__ungrouped') }}>
                {expanded ? <ChevronDown size={13} aria-hidden="true"/> : <ChevronRight size={13} aria-hidden="true"/>}
                <span>{section.name}</span>
                {attention > 0 && <span className="subscription-nav-group-alert" aria-hidden="true"/>}
                <span className="count">{section.members.length}</span>
              </Button>
              {expanded && <ul role="list" id={listID}>{section.visible.map(sourceItem)}{section.kind === 'group' && !section.members.length && <li className="subscription-nav-hint">空分组，可在“管理来源”中移入来源。</li>}</ul>}
            </div>
          })}
          {keyword && !matches && <p className="subscription-nav-hint" role="status">没有匹配“{keyword}”的来源</p>}
          {!state.loading && !state.listError && !state.sources.length && <p className="subscription-nav-hint">还没有来源。添加后会按分组出现在这里。</p>}
        </nav>
        <Button variant="quiet" className="subscription-nav-manage" onClick={onManage}><Settings2 size={15} aria-hidden="true"/>管理来源与分组</Button>
      </aside>
    </div>
  </div>
}
