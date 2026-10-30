import { useEffect, useState } from 'react'
import { request } from '../../shared/api/client'
import { listOrEmpty } from '../../shared/api/list'
import type { useDownloads } from '../downloads/useDownloads'
import type { SettingsRoute } from './registry'
import type { SettingsNavStatus } from './ui/SettingsShell'

type Cookie = { platform: string; configured: boolean; expiresAt?: number }
type HealthData = {
  cookies: Cookie[] | null
  ai: { ready: boolean; summaryReady?: boolean; baseUrl: string } | null
  transcription: { ready: boolean; missing?: string[] } | null
  backup: { targets: { id: string; enabled: boolean }[]; snapshots: { status: string; createdAt: string }[]; encryption: { configured: boolean } } | null
  agent: { settings: { enabled: boolean; scopes: string[] }; status: { running: boolean } } | null
}

const empty: HealthData = { cookies: null, ai: null, transcription: null, backup: null, agent: null }
export type SettingsAttention = { title: string; detail: string; action: string; route: SettingsRoute; tone: 'warning' | 'danger' }

export function useSettingsHealth(downloads: ReturnType<typeof useDownloads>, section: string) {
  const [data, setData] = useState(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void Promise.allSettled([
      request<{ platforms: Cookie[] }>('/settings/cookies', { signal: controller.signal }),
      request<NonNullable<HealthData['ai']>>('/ai/settings', { signal: controller.signal }),
      request<NonNullable<HealthData['transcription']>>('/transcription/settings', { signal: controller.signal }),
      Promise.all([
        request<NonNullable<HealthData['backup']>['targets']>('/backup/targets', { signal: controller.signal }),
        request<NonNullable<HealthData['backup']>['snapshots']>('/backup/snapshots', { signal: controller.signal }),
        request<{ configured: boolean }>('/backup/encryption', { signal: controller.signal }),
      ]).then(([targets, snapshots, encryption]) => ({ targets: listOrEmpty(targets), snapshots: listOrEmpty(snapshots), encryption })),
      request<NonNullable<HealthData['agent']>>('/settings/agent', { signal: controller.signal }),
    ]).then(([cookies, ai, transcription, backup, agent]) => {
      if (controller.signal.aborted) return
      const results = [cookies, ai, transcription, backup, agent]
      setData({
        cookies: cookies.status === 'fulfilled' ? listOrEmpty(cookies.value.platforms) : null,
        ai: ai.status === 'fulfilled' ? ai.value : null,
        transcription: transcription.status === 'fulfilled' ? transcription.value : null,
        backup: backup.status === 'fulfilled' ? backup.value : null,
        agent: agent.status === 'fulfilled' ? agent.value : null,
      })
      const failures = results.filter(result => result.status === 'rejected').length
      setError(failures ? `${failures} 项状态暂时无法读取。` : '')
      setLoading(false)
    })
    return () => controller.abort()
  }, [section, revision])

  const attention: SettingsAttention[] = []
  const expired = data.cookies?.filter(cookie => cookie.configured && cookie.expiresAt && cookie.expiresAt * 1000 < Date.now()) ?? []
  const labels: Record<string, string> = { youtube: 'YouTube', bilibili: '哔哩哔哩', xiaohongshu: '小红书', xiaoyuzhou: '小宇宙', linuxdo: 'Linux.do', douyin: '抖音' }
  for (const cookie of expired) attention.push({ title: `${labels[cookie.platform] ?? cookie.platform}登录已过期`, detail: '内容读取与相关推荐需要重新登录。', action: '重新登录', tone: 'warning', route: { section: 'accounts', platform: cookie.platform } })
  if (data.ai && !data.ai.ready && !data.ai.summaryReady) attention.push({ title: 'AI 服务尚未就绪', detail: '配置服务商与任务模型后即可使用翻译和摘要。', action: '配置 AI 服务', tone: 'warning', route: { section: 'ai', tab: 'provider' } })
  if (data.transcription && !data.transcription.ready) attention.push({ title: '字幕转录需要配置', detail: data.transcription.missing?.length ? `缺少：${data.transcription.missing.join('、')}` : '选择本机或云端转录引擎。', action: '配置转录', tone: 'warning', route: { section: 'ai', tab: 'asr' } })
  const latestBackup = data.backup?.snapshots[0]
  const backupFailed = Boolean(latestBackup && latestBackup.status !== 'succeeded')
  if (backupFailed) attention.push({ title: '最近一次备份未完成', detail: '检查备份目标的连接状态，并重试失败目标。', action: '查看备份', tone: 'danger', route: { section: 'data', tab: 'backup' } })
  else if (data.backup && (!data.backup.encryption.configured || !data.backup.targets.some(target => target.enabled))) attention.push({ title: '备份还没有准备好', detail: '添加备份目标并设置加密密码。', action: '设置备份', tone: 'warning', route: { section: 'data', tab: 'backup' } })
  if (downloads.tools && !downloads.tools.downloadReady) attention.push({ title: '下载组件未就绪', detail: '检查 yt-dlp 与 FFmpeg 的安装状态。', action: '检查组件', tone: 'warning', route: { section: 'system' } })
  const connected = data.cookies?.filter(cookie => cookie.configured && !expired.includes(cookie)).length
  const statuses: Partial<Record<string, SettingsNavStatus>> = {
    overview: { count: attention.length },
    accounts: data.cookies ? { label: expired.length ? `${expired.length} 项过期` : `${connected} 个已连接`, tone: expired.length ? 'warning' : undefined } : {},
    ai: data.ai ? { label: data.ai.ready || data.ai.summaryReady ? '已配置' : '待配置' } : {},
    agent: data.agent ? { label: data.agent.status.running ? '运行中' : '已停用' } : {},
    data: data.backup ? { label: backupFailed ? '备份失败' : latestBackup ? '已备份' : '待配置', tone: backupFailed ? 'danger' : undefined } : {},
    system: downloads.tools ? { label: downloads.tools.downloadReady ? '已就绪' : '待安装', tone: downloads.tools.downloadReady ? undefined : 'warning' } : {},
  }
  return { data, loading, error, attention, connected, expired, statuses, refresh: () => setRevision(value => value + 1) }
}

export type SettingsHealth = ReturnType<typeof useSettingsHealth>
