import { Button, Dialog } from '../components/ui'
import { Compass, Rss, Bookmark, Clock3, StickyNote, Download, Settings, FileText, Play, Headphones, Image, Filter, Newspaper, Circle, X } from 'lucide-react'
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

export function MobileMenu({
  menuRef,
  setMenuOpen,
  view,
  onNavigate,
  savedViews,
  onNavigateSavedView,
  savedCount,
  activeDownloads
}: {
  menuRef: React.RefObject<HTMLDialogElement | null>
  setMenuOpen: (value: boolean) => void
  view: View
  onNavigate: (view: View) => void
  savedViews: SavedView[]
  onNavigateSavedView: (id: string) => void
  savedCount: number
  activeDownloads: number
}) {
  const badge = (next: View) => next === 'library' && savedCount > 0 ? savedCount : next === 'downloads' && activeDownloads > 0 ? activeDownloads : 0
  const customSavedViews = savedViews.filter(savedView => !savedView.builtin)

  const go = (next: View) => {
    setMenuOpen(false)
    onNavigate(next)
  }

  const handleOverlayClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        setMenuOpen(false)
      }
    }
  }

  return (
    <Dialog
      ref={menuRef}
      className="experience-drawer"
      aria-label="导航菜单"
      onCancel={() => setMenuOpen(false)}
      onClose={() => setMenuOpen(false)}
      onClick={handleOverlayClick}
    >
      <div className="experience-drawer-heading">
        <span className="experience-drawer-brand">
          <BrandMark/>
          <strong>Tangentry</strong>
        </span>
        <Button variant="quiet" iconOnly
          type="button"
          className="icon-button"
          aria-label="关闭菜单"
          onClick={() => setMenuOpen(false)}
        >
          <X size={20}/>
        </Button>
      </div>

      <nav className="experience-mobile-links" aria-label="移动导航">
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
                onClick={() => go(next)}
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
                {customSavedViews.map((savedView) => {
                  const ViewIcon = savedViewIcons[savedView.icon as keyof typeof savedViewIcons] ?? Filter
                  return (
                    <div className="saved-view-nav-row" key={savedView.id}>
                      <Button variant="quiet"
                        type="button"
                        className={view === 'subscriptions' && new URLSearchParams(location.search).get('view') === savedView.id ? 'active' : ''}
                        aria-label={`${savedView.name}，${savedView.count} 条`}
                        title={savedView.name}
                        onClick={() => {
                          setMenuOpen(false)
                          onNavigateSavedView(savedView.id)
                        }}
                      >
                        <span className={`saved-view-mark ${savedView.color}`}>
                          <ViewIcon size={13}/>
                        </span>
                        <span>{savedView.name}</span>
                        <small>{savedView.count}</small>
                      </Button>
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
            onClick={() => go('tools')}
          >
            <Settings size={18} strokeWidth={1.8} aria-hidden="true"/>
            <span>设置</span>
          </Button>
        </div>
      </nav>
    </Dialog>
  )
}
