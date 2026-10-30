import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { SavedView } from '../shared/api/types'
import type { View } from './navigation'
import { useHistoryGestures } from './useHistoryGestures'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { MobileMenu } from './MobileMenu'
import { ResumePanel } from './ResumePanel'

export function AppShell({
  view,
  onNavigate,
  onNavigateSavedView,
  savedViews,
  onReorderSavedViews,
  onSearchQuery,
  onHome,
  activeDownloads,
  savedCount,
  onAdd,
  discoveryQuery,
  onDiscoveryQuery,
  resume,
  onResume,
  onDismissResume,
  toolbar,
  children
}: {
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
  const swipe = useHistoryGestures()
  const [menuOpen, setMenuOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('tangentry-sidebar-collapsed') !== 'false' } catch { return true }
  })
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const value = Number(localStorage.getItem('tangentry-sidebar-width'))
      return Number.isFinite(value) ? Math.min(360, Math.max(144, value)) : 236
    } catch { return 236 }
  })
  const menu = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    try { localStorage.setItem('tangentry-sidebar-collapsed', String(collapsed)) } catch { /* Navigation remains usable without storage. */ }
  }, [collapsed])

  useEffect(() => {
    try { localStorage.setItem('tangentry-sidebar-width', String(sidebarWidth)) } catch { /* Keep the current size when storage is unavailable. */ }
  }, [sidebarWidth])

  useEffect(() => {
    const keyboard = () => { document.documentElement.dataset.input = 'keyboard' }
    const pointer = () => { document.documentElement.dataset.input = 'pointer' }
    const resize = () => { if (!matchMedia('(max-width: 960px)').matches) setMenuOpen(false) }
    window.addEventListener('keydown', keyboard)
    window.addEventListener('pointerdown', pointer)
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('keydown', keyboard)
      window.removeEventListener('pointerdown', pointer)
      window.removeEventListener('resize', resize)
    }
  }, [])

  useEffect(() => {
    const node = menu.current
    if (!node || !menuOpen) return
    node.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      node.close()
      document.body.style.overflow = previous
      trigger.current?.focus({ preventScroll: true })
    }
  }, [menuOpen])

  return (
    <div className={`experience ${view === 'reader' ? 'experience-reading' : ''}`} data-view={view} data-sidebar-collapsed={collapsed} style={{ '--user-sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <a href="#main" className="skip-link">跳到内容</a>

      <Sidebar
        view={view}
        onNavigate={onNavigate}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        sidebarWidth={sidebarWidth}
        setSidebarWidth={setSidebarWidth}
        savedViews={savedViews}
        onNavigateSavedView={onNavigateSavedView}
        onReorderSavedViews={onReorderSavedViews}
        savedCount={savedCount}
        activeDownloads={activeDownloads}
        onHome={onHome}
      />

      <TopBar
        view={view}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        triggerRef={trigger}
        onAdd={onAdd}
        discoveryQuery={discoveryQuery}
        onDiscoveryQuery={onDiscoveryQuery}
        onSearchQuery={onSearchQuery}
        toolbar={toolbar}
      />

      <MobileMenu
        menuRef={menu}
        setMenuOpen={setMenuOpen}
        view={view}
        onNavigate={onNavigate}
        savedViews={savedViews}
        onNavigateSavedView={onNavigateSavedView}
        savedCount={savedCount}
        activeDownloads={activeDownloads}
      />

      <div className="experience-workspace">{children}</div>

      {resume && <ResumePanel resume={resume} onResume={onResume} onDismissResume={onDismissResume} />}

      {swipe !== 0 && <div className="experience-swipe-hint" data-direction={swipe < 0 ? 'back' : 'forward'} aria-hidden="true">
        {swipe < 0 ? '←' : '→'}
      </div>}
    </div>
  )
}
