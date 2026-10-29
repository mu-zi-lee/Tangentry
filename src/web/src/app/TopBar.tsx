import { Button, Input } from '../components/ui'
import { ArrowLeft, ArrowRight, Menu, Moon, Plus, Search, Sun, X } from 'lucide-react'
import type { View } from './navigation'
import { viewNames } from './navigation'
import { useThemeSwitch } from './useThemeSwitch'
import { useHistoryPosition } from './useHistoryGestures'
import { BrandMark } from '../shared/ui/BrandMark'

const groups = [
  { label: '浏览', items: [
    { view: 'discovery', label: '发现' },
    { view: 'subscriptions', label: '订阅管理' },
  ] },
  { label: '资料库', items: [
    { view: 'library', label: '收藏' },
    { view: 'history', label: '历史' },
    { view: 'notes', label: '笔记' },
    { view: 'downloads', label: '下载' },
  ] },
] as const

const groupOf = (view: View) =>
  view === 'tools' ? '应用' :
  view === 'reader' || view === 'search' ? '' :
  groups.find(group => group.items.some(item => item.view === view))?.label ??
  (view === 'bilibili' ? '浏览' : '')

export function TopBar({
  view,
  menuOpen,
  setMenuOpen,
  triggerRef,
  onAdd,
  discoveryQuery,
  onDiscoveryQuery,
  onSearchQuery
}: {
  view: View
  menuOpen: boolean
  setMenuOpen: (value: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  onAdd: () => void
  discoveryQuery: string
  onDiscoveryQuery: (query: string) => void
  onSearchQuery: (query: string) => void
}) {
  const { dark, switchTheme } = useThemeSwitch()
  const position = useHistoryPosition()
  const section = groupOf(view)

  return (
    <header className="experience-topbar top-navigation">
      <div className="experience-location">
        <Button variant="quiet" iconOnly
          ref={triggerRef}
          type="button"
          className="icon-button experience-menu"
          aria-label="菜单"
          title="打开导航"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <Menu size={20}/>
        </Button>
        <span className="experience-mobile-brand" aria-hidden="true"><BrandMark/></span>
        <span className="experience-history" role="group" aria-label="页面历史">
          <Button variant="quiet" iconOnly
            type="button"
            className="icon-button"
            aria-label="后退"
            title="后退（⌘[ 或向右轻扫）"
            disabled={!position.back}
            onClick={() => history.back()}
          >
            <ArrowLeft size={17}/>
          </Button>
          <Button variant="quiet" iconOnly
            type="button"
            className="icon-button"
            aria-label="前进"
            title="前进（⌘] 或向左轻扫）"
            disabled={!position.forward}
            onClick={() => history.forward()}
          >
            <ArrowRight size={17}/>
          </Button>
        </span>
        <span className="experience-location-title">
          {section && <span className="experience-location-section">{section}</span>}
          <strong>{viewNames[view]}</strong>
        </span>
      </div>

      {view === 'discovery' && (
        <div className="discovery-search" role="search">
          <Search size={16} aria-hidden="true"/>
          <Input
            type="search"
            aria-label="搜索发现内容"
            placeholder="搜索本机与各平台"
            value={discoveryQuery}
            onChange={event => onDiscoveryQuery(event.target.value)}
            onFocus={() => onSearchQuery(discoveryQuery)}
          />
          {discoveryQuery && (
            <Button variant="quiet" iconOnly
              type="button"
              className="icon-button"
              aria-label="清除发现搜索"
              title="清除搜索"
              onClick={() => onDiscoveryQuery('')}
            >
              <X size={15}/>
            </Button>
          )}
        </div>
      )}

      <div className="experience-header-actions">
        <Button variant="quiet"
          type="button"
          className="experience-add"
          aria-label="添加内容"
          title="粘贴链接或导入 PDF"
          onClick={onAdd}
        >
          <Plus size={17} aria-hidden="true"/>
          <span>添加内容</span>
        </Button>
        <Button variant="quiet" iconOnly
          type="button"
          className="icon-button theme-switch"
          aria-label={dark ? '切换浅色模式' : '切换深色模式'}
          title={dark ? '切换浅色模式' : '切换深色模式'}
          onClick={switchTheme}
        >
          {dark ? <Sun size={18}/> : <Moon size={18}/>}
        </Button>
      </div>
    </header>
  )
}
