import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { useDownloads } from '../downloads/useDownloads'
import type { Feed } from '../../shared/api/types'
import { replacePath } from '../../shared/browser/historyStack'
import { SettingsShell } from './ui/SettingsShell'
import { settingsById, settingsRegistry, type SettingsRoute, type SettingsSection, type SettingsTab } from './registry'
import './settings-system.css'
import { settingsSearch } from './settingsSearch'
import { useSettingsHealth } from './useSettingsHealth'

const legacyRoutes: Record<string, string> = {
  display: 'appearance', translation: 'ai/text', transcription: 'ai/asr', 'ai/prompts': 'ai/text', storage: 'data/storage', 'data-storage': 'data/storage', backup: 'data/backup', 'data-backup': 'data/backup', about: 'system',
}

function routeFromURL(): SettingsRoute {
  let raw = window.location.hash.slice(1)
  try { raw = decodeURIComponent(raw) } catch { /* An incomplete escaped hash opens the overview. */ }
  const migrated = legacyRoutes[raw] ?? raw
  if (migrated !== raw) replacePath(`/tools#${migrated}`)
  const [head, tail] = migrated.split('/')
  const section = head === 'ai' ? 'ai' : head === 'data' ? 'data' : head
  const valid = settingsById.has(section as SettingsSection)
  const tab = section === 'ai' && ['provider', 'text', 'asr'].includes(tail) ? tail as SettingsTab
    : section === 'data' && ['storage', 'backup'].includes(tail) ? tail as SettingsTab : undefined
  const platform = (section === 'accounts' || section === 'discovery') && tail ? tail : undefined
  return { section: valid ? section as SettingsSection : 'overview', tab, platform, hasHash: Boolean(raw) }
}

function routeHash(route: SettingsRoute) {
  if (route.section === 'ai' && route.tab) return `ai/${route.tab}`
  if (route.section === 'data' && route.tab) return `data/${route.tab}`
  if (route.section === 'accounts' && route.platform) return `accounts/${route.platform}`
  if (route.section === 'discovery' && route.platform) return `discovery/${route.platform}`
  return route.section
}

export function ToolsPage({ downloads, onCookieChanged, onYouTubeFeed, onDiscover }: {
  downloads: ReturnType<typeof useDownloads>
  onCookieChanged: (platform: string) => void
  onYouTubeFeed: (feed: Feed) => void
  onDiscover: () => void
}) {
  const [route, setRoute] = useState<SettingsRoute>(routeFromURL)
  const [query, setQuery] = useState('')
  const health = useSettingsHealth(downloads, route.section)
  const item = settingsById.get(route.section) ?? settingsRegistry[0]

  useEffect(() => {
    const update = () => setRoute(routeFromURL())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => {
    document.title = `${query.trim() ? '搜索结果' : item.label} · 设置 · Tangentry`
    if (!route.target || query.trim()) return
    let done = false
    const focus = () => {
      const row = document.querySelector<HTMLElement>(`[data-setting="${CSS.escape(route.target!)}"]`) ?? document.getElementById(route.target!)
      if (!row || done) return
      done = true
      row.scrollIntoView({ block: 'center', behavior: 'instant' })
      row.querySelector<HTMLElement>('input, select, button, a, textarea')?.focus({ preventScroll: true })
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) row.animate([{ backgroundColor: 'var(--accent-soft)' }, { backgroundColor: 'transparent' }], { duration: 1200 })
    }
    const observer = new MutationObserver(focus)
    observer.observe(document.getElementById('settings-main')!, { childList: true, subtree: true })
    const frame = window.requestAnimationFrame(focus)
    const timeout = window.setTimeout(() => observer.disconnect(), 8000)
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); window.clearTimeout(timeout) }
  }, [route, query, item.label])

  function selectRoute(next: SettingsRoute) {
    const normalized = { ...next, hasHash: true }
    setRoute(normalized)
    setQuery('')
    replacePath(`/tools#${routeHash(normalized)}`)
    if (!next.target) window.scrollTo({ top: 0, behavior: 'instant' })
    window.requestAnimationFrame(() => document.getElementById('settings-main')?.focus({ preventScroll: true }))
  }

  function onTabChange(tab: SettingsTab) {
    selectRoute({ section: route.section, tab, platform: route.platform })
  }

  const searchResults = query.trim() ? settingsSearch.filter(result => `${result.label} ${result.group} ${result.keywords ?? ''}`.toLocaleLowerCase('zh-CN').includes(query.trim().toLocaleLowerCase('zh-CN'))) : []
  const context = { route, health, downloads, onCookieChanged, onYouTubeFeed, onDiscover, onNavigate: selectRoute, onTabChange }

  return <SettingsShell items={settingsRegistry} statuses={health.statuses} activeId={route.section} query={query} onQueryChange={setQuery} onSelect={id => selectRoute({ section: id as SettingsSection })} mobileDetail={Boolean(route.hasHash)} onBack={() => { setQuery(''); replacePath('/tools'); setRoute({ section: 'overview', hasHash: false }); window.scrollTo(0, 0) }}>
    {query.trim() ? <section className="settings-search-results settings-action-page" aria-labelledby="settings-search-title"><header className="settings-action-head"><div><h1 id="settings-search-title">搜索结果</h1><p>与“{query.trim()}”相关的 {searchResults.length} 项设置，选择一项直接跳转。</p></div></header><div className="settings-result-list settings-list-card">{searchResults.map((result, index) => <button type="button" className="settings-result-row" key={index} onClick={() => selectRoute(result.route)}><span><strong>{result.label}</strong><small>{result.group}</small></span><ChevronRight size={16} aria-hidden="true"/></button>)}{!searchResults.length && <p className="settings-empty">没有找到匹配的设置。试试“备份”“Cookie”“字体”或“模型”。</p>}</div></section> : item.render(context)}
  </SettingsShell>
}

export { routeFromURL }
