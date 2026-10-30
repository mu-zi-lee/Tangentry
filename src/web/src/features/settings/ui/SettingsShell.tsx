import { ArrowLeft, ChevronRight, Search, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from '../../../components/ui'
import type { SettingsRegistryItem } from '../registry'
export type SettingsNavStatus = { label?: string; tone?: 'warning' | 'danger'; count?: number }

export function SettingsShell({ items, activeId, query, onQueryChange, onSelect, onBack, mobileDetail, statuses = {}, children }: {
  items: readonly SettingsRegistryItem[]
  activeId: string
  query: string
  onQueryChange: (value: string) => void
  onSelect: (id: string) => void
  onBack: () => void
  mobileDetail: boolean
  statuses?: Partial<Record<string, SettingsNavStatus>>
  children: ReactNode
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLElement && target.isContentEditable) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])
  const groups = [...new Set(items.map(item => item.group).filter(Boolean))]
  function renderItem(item: SettingsRegistryItem) {
    const active = !query.trim() && item.id === activeId
    const status = statuses[item.id]
    return <Button variant="quiet" type="button" key={item.id} className={active ? 'active' : ''} aria-label={item.label} aria-current={active ? 'page' : undefined} onClick={() => onSelect(item.id)}><span className="settings-system-nav-icon">{item.icon}</span><span className="settings-system-nav-label-text">{item.label}</span>{status?.count ? <span className="settings-nav-badge" aria-label={`${status.count} 项需要处理`}>{status.count}</span> : status?.label ? <span className="settings-nav-meta" data-tone={status.tone}>{status.label}</span> : null}<span className="settings-system-nav-chevron"><ChevronRight size={15} aria-hidden="true" /></span></Button>
  }
  function renderSearch() {
    return <label className="settings-system-search"><Search size={15} aria-hidden="true" /><input ref={searchRef} type="search" aria-label="搜索设置" placeholder="搜索设置" value={query} onChange={event => onQueryChange(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { onQueryChange(''); event.currentTarget.blur() } }} /><kbd>/</kbd>{query && <Button variant="quiet" iconOnly type="button" className="settings-system-search-clear" aria-label="清除搜索" title="清除搜索" onClick={() => onQueryChange('')}><X size={14} /></Button>}</label>
  }
  const nav = <nav className="settings-system-nav" aria-label="设置目录"><div className="settings-system-nav-pinned">{items.filter(item => !item.group).map(renderItem)}</div>{groups.map(group => <div className="settings-system-nav-group" key={group}><span className="settings-system-nav-label">{group}</span><div>{items.filter(item => item.group === group).map(renderItem)}</div></div>)}</nav>
  return <div className={`settings-system${mobileDetail || query.trim() ? ' is-mobile-detail' : ' is-mobile-list'}${query.trim() ? ' is-searching' : ''}`}>
    <aside className="settings-system-sidebar" aria-label="设置目录"><div className="settings-system-sidebar-heading" role="heading" aria-level={2}>设置</div>{renderSearch()}{nav}</aside>
    <div className="settings-system-main" id="settings-main" role="region" aria-label="设置内容" tabIndex={-1}>{mobileDetail && !query.trim() && <button type="button" className="settings-mobile-back" aria-label="返回设置列表" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />设置</button>}{children}</div>
  </div>
}
