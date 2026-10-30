import { Button } from '../components/ui'
import { Compass, Bookmark, Clock3, Download, Rss, StickyNote } from 'lucide-react'
import { type ReactNode } from 'react'
import type { SavedView } from '../shared/api/types'
import type { View } from './navigation'
import { AppShell } from './AppShell'

// Bottom navigation quick links
const destinations = [
  { view: 'discovery', label: '发现', Icon: Compass },
  { view: 'subscriptions', label: '订阅管理', Icon: Rss },
  { view: 'library', label: '收藏', Icon: Bookmark },
  { view: 'history', label: '历史', Icon: Clock3 },
  { view: 'notes', label: '笔记', Icon: StickyNote },
  { view: 'downloads', label: '下载', Icon: Download },
] as const
const quick = ['discovery', 'subscriptions', 'library', 'downloads'] as const

export function ExperienceShell({ view, onNavigate, onNavigateSavedView, savedViews, onReorderSavedViews, onSearchQuery, onHome, activeDownloads, savedCount, onAdd, discoveryQuery, onDiscoveryQuery, resume, onResume, onDismissResume, toolbar, children }: {
  view: View
  onNavigate: (view: View) => void
  onSearchQuery: (query: string) => void
  onNavigateSavedView: (id: string) => void
  savedViews: SavedView[]
  onReorderSavedViews: (ids: string[]) => void
  onHome: (animate: boolean) => void
  activeDownloads: number
  savedCount: number
  onAdd: () => void
  discoveryQuery: string
  onDiscoveryQuery: (query: string) => void
  resume: { title: string } | null
  onResume: () => void
  onDismissResume: () => void
  toolbar?: ReactNode
  children: ReactNode
}) {
  const go = (next: View) => onNavigate(next)

  return (
    <>
      <AppShell
        view={view}
        onNavigate={onNavigate}
        onNavigateSavedView={onNavigateSavedView}
        savedViews={savedViews}
        onReorderSavedViews={onReorderSavedViews}
        onSearchQuery={onSearchQuery}
        onHome={onHome}
        activeDownloads={activeDownloads}
        savedCount={savedCount}
        onAdd={onAdd}
        discoveryQuery={discoveryQuery}
        onDiscoveryQuery={onDiscoveryQuery}
        resume={resume}
        onResume={onResume}
        onDismissResume={onDismissResume}
        toolbar={toolbar}
      >
        {children}
      </AppShell>

      <nav className="bottom-navigation" aria-label="快捷导航">
        {quick.map(next => {
          const { label, Icon } = destinations.find(item => item.view === next)!
          return (
            <Button variant="quiet"
              key={next}
              type="button"
              className={view === next ? 'active' : ''}
              aria-current={view === next ? 'page' : undefined}
              onClick={() => go(next)}
            >
              <Icon size={20} strokeWidth={1.8}/>
              <span>{label}</span>
              {next === 'downloads' && activeDownloads > 0 && <small>{activeDownloads}</small>}
            </Button>
          )
        })}
      </nav>
    </>
  )
}
