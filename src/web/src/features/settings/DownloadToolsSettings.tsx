import { Download, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { request } from '../../shared/api/client'
import { listOrEmpty } from '../../shared/api/list'
import type { ToolStatus } from '../../shared/api/types'
import type { useDownloads } from '../downloads/useDownloads'
import { SettingsTask } from './ui/SettingsActionPage'
import { SettingsRow, SettingsStatus } from './ui/SettingsRow'

function toolProgress(tool: ToolStatus) {
  return tool.total ? `正在下载 ${Math.floor((tool.received ?? 0) * 100 / tool.total)}%` : '正在下载…'
}

export function DownloadToolsSettings({ downloads, active = true }: { downloads: ReturnType<typeof useDownloads>; active?: boolean }) {
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const tools = listOrEmpty(downloads.tools?.tools)
  const toolDownloading = tools.some(tool => tool.downloading)
  const { reload } = downloads
  const initialReloadAttempted = useRef(false)

  useEffect(() => {
    if (!active) {
      initialReloadAttempted.current = false
      return
    }
    // `useDownloads` loads its shared report when the app mounts. Only retry
    // here when that initial read finished without producing a report.
    if (!downloads.loading && !downloads.tools && !initialReloadAttempted.current) {
      initialReloadAttempted.current = true
      void reload()
    }
    if (!toolDownloading) return
    const timer = window.setInterval(() => { if (!document.hidden) void reload() }, 1000)
    return () => window.clearInterval(timer)
  }, [active, toolDownloading, downloads.loading, downloads.tools, reload])

  async function update() {
    setUpdating(true)
    setUpdateError('')
    try {
      await request('/tools/yt-dlp/update', { method: 'POST' })
      await reload()
    } catch (cause) {
      setUpdateError(cause instanceof Error ? cause.message : '无法开始更新。')
    } finally {
      setUpdating(false)
    }
  }

  return <SettingsTask title="下载组件" description="平台接口变化时，请保持组件为最新" actions={<button type="button" className="icon-button" aria-label="刷新组件状态" title="刷新组件状态" disabled={downloads.loading} onClick={() => void reload()}><RefreshCw size={16} className={downloads.loading ? 'spin' : undefined}/></button>}>
    {downloads.loading && <p className="field-hint" role="status">正在检查组件…</p>}
    {downloads.error && <p className="subtitle-error" role="alert">{downloads.error}</p>}
    {!tools.length && !downloads.loading && <p className="field-hint" role="status">暂时没有可显示的组件。</p>}
    <div className="settings-list-card" data-setting="download-tools">{tools.map(tool => <SettingsRow key={tool.name} title={<code>{tool.name}</code>} description={<>{tool.name === 'yt-dlp' ? '视频与音频下载' : tool.name.includes('whisper') ? '本机字幕转录' : '合并音视频、抽帧与转码'}{tool.version && <> · {tool.version.replace(/^ffmpeg version /, '').split(' Copyright')[0]}</>}{tool.managed && !tool.installed && !tool.downloading && !tool.error && ' · 首次使用时自动下载并校验'}{tool.error && <span className="backup-target-failure"> · {tool.error}</span>}</>}>
        {tool.downloading ? <span className="settings-state" role="status"><RefreshCw size={14} className="spin"/>{toolProgress(tool)}</span> : <SettingsStatus tone={tool.available ? 'positive' : 'warning'}>{tool.available ? '已就绪' : '未检测到'}</SettingsStatus>}
        {tool.managed && <button type="button" className="button button-secondary" disabled={tool.downloading || updating} onClick={() => void update()}><Download size={14}/>{tool.installed ? '更新 yt-dlp' : '下载 yt-dlp'}</button>}
    </SettingsRow>)}</div>
    {updateError && <p className="subtitle-error" role="alert">{updateError}</p>}
  </SettingsTask>
}
