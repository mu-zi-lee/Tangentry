import { Compass, Eye, Languages, Mic, HardDrive, RotateCcw, UserRound, ShieldCheck, Bot } from 'lucide-react'
import { replacePath } from '../../shared/browser/historyStack'
import { useEffect, useState } from 'react'
import { SettingsShell, type SettingsNavItem } from './ui/SettingsShell'
import './settings-system.css'
import type { useDownloads } from '../downloads/useDownloads'
import type { GalleryColumns } from './useGalleryLayout'
import type { Feed } from '../../shared/api/types'
import { DisplaySettingsPage } from './pages/DisplaySettingsPage'
import { AccountsSettingsPage } from './pages/AccountsSettingsPage'
import { TranslationSettingsPage } from './pages/TranslationSettingsPage'
import { TranscriptionSettingsPage } from './pages/TranscriptionSettingsPage'
import { StorageSettingsPage } from './pages/StorageSettingsPage'
import { BackupSettingsPage } from './pages/BackupSettingsPage'
import { AboutSettingsPage } from './pages/AboutSettingsPage'
import { AgentSettingsPage } from './pages/AgentSettingsPage'
import { DiscoverySettingsPage } from './pages/DiscoverySettingsPage'

type SettingsSection = 'display' | 'accounts' | 'discovery' | 'translation' | 'transcription' | 'storage' | 'backup' | 'agent' | 'about'
function sectionFromURL(): SettingsSection {
  const hash = window.location.hash.slice(1)
  return ['display', 'accounts', 'discovery', 'translation', 'transcription', 'storage', 'backup', 'agent', 'about'].includes(hash) ? hash as SettingsSection : 'display'
}

export function ToolsPage({ downloads, columns, onColumns, onCookieChanged, onYouTubeFeed, onDiscover }: {
  downloads: ReturnType<typeof useDownloads>
  columns: GalleryColumns
  onColumns: (columns: GalleryColumns) => void
  onCookieChanged: (platform: string) => void
  onYouTubeFeed: (feed: Feed) => void
  onDiscover: () => void
}) {
  void columns
  void onColumns
  const [section, setSection] = useState<SettingsSection>(sectionFromURL)
  const [visited, setVisited] = useState(() => new Set<SettingsSection>([sectionFromURL()]))
  const [youtubeCookieRevision, setYouTubeCookieRevision] = useState(0)
  const [modelRevision, setModelRevision] = useState(0)

  function selectSection(next: SettingsSection) {
    setSection(next)
    setVisited(current => new Set([...current, next]))
    replacePath('/tools#' + next)
  }
  useEffect(() => {
    const update = () => {
      const next = sectionFromURL()
      setSection(next)
      setVisited(current => new Set([...current, next]))
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  function cookiesChanged(platform: string) {
    if (platform === 'youtube') setYouTubeCookieRevision(revision => revision + 1)
    onCookieChanged(platform)
    void downloads.reload()
  }
  const sections: SettingsNavItem[] = [
    { id: 'display', group: '体验', label: '外观', hint: '调整阅读方式', icon: <Eye size={16} /> },
    { id: 'accounts', group: '连接', label: '账号', hint: '连接内容来源', icon: <UserRound size={16} /> },
    { id: 'discovery', group: '体验', label: '发现', hint: '管理推荐与反馈', icon: <Compass size={16} /> },
    { id: 'translation', group: '连接', label: '翻译与摘要', hint: '配置模型服务', icon: <Languages size={16} /> },
    { id: 'transcription', group: '连接', label: '字幕转录', hint: '选择识别方式', icon: <Mic size={16} /> },
    { id: 'storage', group: '本地数据', label: '下载与存储', hint: '选择文件位置', icon: <HardDrive size={16} /> },
    { id: 'backup', group: '本地数据', label: '备份与恢复', hint: '执行数据操作', icon: <ShieldCheck size={16} /> },
    { id: 'agent', group: '系统', label: 'Agent 接入', hint: '配置本机 MCP', icon: <Bot size={16} /> },
    { id: 'about', group: '系统', label: '关于与更新', hint: '检查应用更新', icon: <RotateCcw size={16} /> },
  ]
  let content = <DisplaySettingsPage />
  if (section === 'accounts') content = <AccountsSettingsPage onChanged={cookiesChanged} />
  if (section === 'discovery') content = <DiscoverySettingsPage downloads={downloads} cookieRevision={youtubeCookieRevision} onFeed={onYouTubeFeed} onDiscover={onDiscover} />
  if (section === 'translation') content = <TranslationSettingsPage />
  if (section === 'transcription') content = <TranscriptionSettingsPage revision={modelRevision} />
  if (section === 'storage') content = <StorageSettingsPage downloads={downloads} onModelDirectoryChanged={() => setModelRevision(value => value + 1)} />
  if (section === 'backup') content = <BackupSettingsPage />
  if (section === 'agent') content = <AgentSettingsPage />
  if (section === 'about') content = <AboutSettingsPage />

  return <SettingsShell items={sections} activeId={section} onSelect={next => selectSection(next as SettingsSection)}>{visited.has(section) ? content : null}</SettingsShell>
}
