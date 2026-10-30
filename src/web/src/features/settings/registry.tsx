import type { ReactNode } from 'react'
import { Bot, Compass, Database, Eye, LayoutGrid, RefreshCw, Sparkles, UserRound } from 'lucide-react'
import { SettingsOverview } from './pages/SettingsOverview'
import { DisplaySettingsPage } from './pages/DisplaySettingsPage'
import { DiscoverySettingsPage } from './pages/DiscoverySettingsPage'
import { AccountsSettingsPage } from './pages/AccountsSettingsPage'
import { AIServiceSettingsPage, type AIServiceTab } from './pages/AIServiceSettingsPage'
import { AgentSettingsPage } from './pages/AgentSettingsPage'
import { DataSettingsPage, type DataTab } from './pages/DataSettingsPage'
import { ComponentsUpdatesSettingsPage } from './pages/ComponentsUpdatesSettingsPage'
import type { useDownloads } from '../downloads/useDownloads'
import type { Feed } from '../../shared/api/types'
import type { SettingsHealth } from './useSettingsHealth'

export type SettingsSection = 'overview' | 'appearance' | 'discovery' | 'accounts' | 'ai' | 'agent' | 'data' | 'system'
export type SettingsTab = AIServiceTab | DataTab
export type SettingsRoute = { section: SettingsSection; tab?: SettingsTab; platform?: string; target?: string; hasHash?: boolean }
export type SettingsPageContext = {
  route: SettingsRoute
  health: SettingsHealth
  downloads: ReturnType<typeof useDownloads>
  onCookieChanged: (platform: string) => void
  onYouTubeFeed: (feed: Feed) => void
  onDiscover: () => void
  onNavigate: (route: SettingsRoute) => void
  onTabChange: (tab: SettingsTab) => void
}

export type SettingsRegistryItem = {
  id: SettingsSection
  group: '' | '偏好' | '连接' | '系统'
  label: string
  icon: ReactNode
  keywords: string[]
  tabs?: readonly { id: SettingsTab; label: string }[]
  status?: 'good' | 'attention' | 'neutral'
  render: (context: SettingsPageContext) => ReactNode
}

export const settingsRegistry: readonly SettingsRegistryItem[] = [
  {
    id: 'overview', group: '', label: '概览', icon: <LayoutGrid size={16} aria-hidden="true" />, keywords: ['状态', '连接', '服务', '待处理'],
    render: ({ health, onNavigate }) => <SettingsOverview health={health} onNavigate={onNavigate} />,
  },
  {
    id: 'appearance', group: '偏好', label: '外观', icon: <Eye size={16} aria-hidden="true" />, keywords: ['卡片', '字体', '字号', '圆角', '布局', '阅读'],
    render: () => <DisplaySettingsPage />,
  },
  {
    id: 'discovery', group: '偏好', label: '发现与推荐', icon: <Compass size={16} aria-hidden="true" />, keywords: ['youtube', '推荐', '屏蔽', '反馈'],
    render: ({ downloads, onYouTubeFeed, onDiscover, route }) => <DiscoverySettingsPage active downloads={downloads} onFeed={onYouTubeFeed} onDiscover={onDiscover} platform={route.platform} />,
  },
  {
    id: 'accounts', group: '连接', label: '平台账号', icon: <UserRound size={16} aria-hidden="true" />, keywords: ['cookie', '登录', 'bilibili', 'youtube', '小红书', '抖音'],
    render: ({ onCookieChanged, route }) => <AccountsSettingsPage active platform={route.platform} onChanged={onCookieChanged} />,
  },
  {
    id: 'ai', group: '连接', label: 'AI 服务', icon: <Sparkles size={16} aria-hidden="true" />, keywords: ['服务商', '翻译', '摘要', '字幕', '转录', '模型', '密钥', '提示词', 'whisper'],
    tabs: [{ id: 'provider', label: '服务商' }, { id: 'text', label: '翻译与摘要' }, { id: 'asr', label: '字幕转录' }],
    render: ({ route, onTabChange }) => <AIServiceSettingsPage active value={(route.tab as AIServiceTab) || 'provider'} onChange={onTabChange} />,
  },
  {
    id: 'agent', group: '连接', label: 'Agent 与 MCP', icon: <Bot size={16} aria-hidden="true" />, keywords: ['gateway', '令牌', '客户端', '权限', 'mcp'],
    render: () => <AgentSettingsPage active />,
  },
  {
    id: 'data', group: '系统', label: '数据与备份', icon: <Database size={16} aria-hidden="true" />, keywords: ['下载', '存储', '目录', '缓存', '快照', '恢复', 'webdav'],
    render: ({ downloads, route }) => <DataSettingsPage active value={(route.tab as DataTab) || 'storage'} downloads={downloads} />,
  },
  {
    id: 'system', group: '系统', label: '组件与更新', icon: <RefreshCw size={16} aria-hidden="true" />, keywords: ['版本', '更新', 'yt-dlp', 'ffmpeg', 'whisper'],
    render: ({ downloads }) => <ComponentsUpdatesSettingsPage active downloads={downloads} />,
  },
]

export const settingsById = new Map(settingsRegistry.map(item => [item.id, item]))
