import { Button } from '../components/ui'
import { Compass, Rss, Bookmark, Clock3, StickyNote, Download, Settings, PanelLeftClose, PanelLeftOpen, ChevronUp, ChevronDown, FileText, Play, Headphones, Image, Filter, Newspaper, Circle } from 'lucide-react'
import type { SavedView } from '../shared/api/types'
import type { View } from './navigation'
import { BrandMark } from '../shared/ui/BrandMark'

const groups = [
  { label: '浏览', items: [
    { view: 'discovery', label: '发现', Icon: Compass },
    { view: 'subscriptions', label: '订阅管理', Icon: Rss },
  ] },
  { label: '资料库', items: [
    { view: 'library', label: '收藏', Icon: Bookmark },
    { view: 'history', label: '历史', Icon: Clock3 },
    { view: 'notes', label: '笔记', Icon: StickyNote },
    { view: 'downloads', label: '下载', Icon: Download },
  ] },
] as const

const savedViewIcons = {
  'file-text': FileText,
  play: Play,
  headphones: Headphones,
  image: Image,
  bookmark: Bookmark,
  filter: Filter,
  newspaper: Newspaper,
  circle: Circle
} as const

export function Sidebar({
  view,
  onNavigate,
  collapsed,
  setCollapsed,
  savedViews,
  onNavigateSavedView,
  onReorderSavedViews,
  savedCount,
  activeDownloads,
  onHome
}: {
  view: View
  onNavigate: (view: View) => void
  collapsed: boolean
  setCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void
  savedViews: SavedView[]
  onNavigateSavedView: (id: string) => void
  onReorderSavedViews: (ids: string[]) => void
  savedCount: number
  activeDownloads: number
  onHome: (animate: boolean) => void
}) {
  const badge = (next: View) => next === 'library' && savedCount > 0 ? savedCount : next === 'downloads' && activeDownloads > 0 ? activeDownloads : 0
  const customSavedViews = savedViews.filter(savedView => !savedView.builtin)

  const reorderCustomSavedViews = (ids: string[]) => {
    let index = 0
    onReorderSavedViews(savedViews.map(savedView => savedView.builtin ? savedView.id : ids[index++]))
  }

  return (
    <aside id="desktop-sidebar" className="experience-sidebar" aria-label="个人内容空间">
      <div className="experience-sidebar-head">
        <Button variant="quiet"
          type="button"
          className="brand-button"
          aria-label="返回首页"
          title="返回发现页顶部"
          onClick={event => onHome(event.detail !== 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches)}
        >
          <BrandMark/><span className="brand-name">Tangentry</span>
        </Button>
      </div>

      <nav className="desktop-nav experience-links" aria-label="主导航">
        {groups.map(group => (
          <div className="experience-nav-group" key={group.label}>
            <span className="experience-nav-label" aria-hidden="true">{group.label}</span>
            {group.items.map(({ view: next, label, Icon }) => (
              <Button variant="quiet"
                key={next}
                type="button"
                className={view === next ? 'active' : ''}
                aria-label={label}
                title={label}
                aria-current={view === next ? 'page' : undefined}
                onClick={() => onNavigate(next)}
              >
                <Icon size={18} strokeWidth={1.8} aria-hidden="true"/>
                <span>{label}</span>
                {badge(next) > 0 && (
                  <small className={next === 'downloads' ? 'is-live' : undefined} aria-hidden="true">
                    {badge(next)}
                  </small>
                )}
              </Button>
            ))}

            {group.label === '资料库' && customSavedViews.length > 0 && (
              <div className="saved-view-nav-list" role="group" aria-label="自定义订阅视图">
                {customSavedViews.map((savedView, index) => {
                  const ViewIcon = savedViewIcons[savedView.icon as keyof typeof savedViewIcons] ?? Filter
                  return (
                    <div className="saved-view-nav-row" key={savedView.id}>
                      <Button variant="quiet"
                        type="button"
                        className={view === 'subscriptions' && new URLSearchParams(location.search).get('view') === savedView.id ? 'active' : ''}
                        aria-label={`${savedView.name}，${savedView.count} 条`}
                        title={savedView.name}
                        onClick={() => onNavigateSavedView(savedView.id)}
                      >
                        <span className={`saved-view-mark ${savedView.color}`}>
                          <ViewIcon size={13}/>
                        </span>
                        <span>{savedView.name}</span>
                        <small>{savedView.count}</small>
                      </Button>
                      {!collapsed && (
                        <span className="saved-view-order">
                          <Button variant="quiet"
                            type="button"
                            aria-label={`上移 ${savedView.name}`}
                            title="上移"
                            disabled={index === 0}
                            onClick={() => {
                              const ids = customSavedViews.map(item => item.id);
                              [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                              reorderCustomSavedViews(ids)
                            }}
                          >
                            <ChevronUp size={12}/>
                          </Button>
                          <Button variant="quiet"
                            type="button"
                            aria-label={`下移 ${savedView.name}`}
                            title="下移"
                            disabled={index === customSavedViews.length - 1}
                            onClick={() => {
                              const ids = customSavedViews.map(item => item.id);
                              [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
                              reorderCustomSavedViews(ids)
                            }}
                          >
                            <ChevronDown size={12}/>
                          </Button>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}

        <div className="experience-nav-group experience-nav-utility">
          <Button variant="quiet"
            type="button"
            className={`experience-settings-link ${view === 'tools' ? 'active' : ''}`}
            aria-label="工具设置"
            title="设置"
            aria-current={view === 'tools' ? 'page' : undefined}
            onClick={() => onNavigate('tools')}
          >
            <Settings size={18} strokeWidth={1.8} aria-hidden="true"/>
            <span>设置</span>
          </Button>
        </div>
      </nav>

      <div className="experience-sidebar-footer">
        <span className="experience-local" title="内容与笔记保存在本机">
          <span className="local-dot" aria-hidden="true"/>
          <span>本机资料库</span>
        </span>
        <Button variant="quiet"
          type="button"
          className="experience-sidebar-toggle"
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-controls="desktop-sidebar"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(value => !value)}
        >
          {collapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}
        </Button>
      </div>
    </aside>
  )
}
