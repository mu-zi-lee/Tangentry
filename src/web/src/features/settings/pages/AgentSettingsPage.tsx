import { Copy, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from '../../../shared/api/client'
import { SettingsActionPage, SettingsTask } from '../ui/SettingsActionPage'
import { SettingsRow, SettingsStatus } from '../ui/SettingsRow'
import '../agent-settings.css'

type Scope = { id: string; label: string; hint: string; recommended?: boolean }
const scopes: Scope[] = [
  { id: 'content_read', label: '内容读取', hint: '搜索、详情、字幕、收件箱和社交素材', recommended: true },
  { id: 'network_fetch', label: '联网抓取', hint: '按请求访问平台接口，每次调用都会记入审计' },
  { id: 'image_read', label: '图片与抽帧', hint: '读取已下载媒体中的视频帧' },
  { id: 'private_notes_read', label: '私人笔记', hint: '读取本地笔记和字幕引用' },
  { id: 'derived_processing', label: '派生处理', hint: '调用摘要、翻译和转录' },
  { id: 'agent_write', label: 'Agent 记录写入', hint: '判重、日报、归档和 Agent 草稿', recommended: true },
]

type ActivityData = { runs: { id: string; client: string; trigger: string; state: string; startedAt: number; error?: string }[]; audit: { runId?: string; action: string; networkFetch: boolean; externalProcessing: boolean; outcome: string; createdAt: number }[] }
type Payload = { settings: { enabled: boolean; scopes: string[] }; status: { running: boolean; protocolVersion: string; endpoint?: string; connectionFile?: string; scopes: string[] }; activity: ActivityData }

function runStateLabel(state: string) { return state === 'completed' ? '已完成' : state === 'failed' ? '失败' : state === 'cancelled' ? '已取消' : '进行中' }
function outcomeLabel(outcome: string) { return outcome === 'ok' ? '成功' : '失败' }
function formatActivityTime(value: number) { return new Date(value * 1000).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }

export function AgentSettingsPage({ active = true }: { active?: boolean }) {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const [pending, setPending] = useState(false)
  const scopeTimer = useRef<number | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await request<Payload>('/settings/agent', { signal })
      setPayload(next); setEnabled(next.settings.enabled); setSelected(next.settings.scopes)
    } catch (error) { if (!signal?.aborted) setMessage(error instanceof Error ? error.message : '无法读取 Agent 设置。') }
  }, [])

  const refreshActivity = useCallback(async (signal: AbortSignal) => {
    try {
      const next = await request<Payload>('/settings/agent', { signal })
      setPayload(current => current ? { ...next, settings: current.settings } : next)
    } catch {
      // Background refresh should not replace a useful page with a transient error.
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    void load(controller.signal)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible' && !controller.signal.aborted) void refreshActivity(controller.signal)
    }
    const timer = window.setInterval(refreshWhenVisible, 10_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [active, load, refreshActivity])

  const save = async (nextEnabled = enabled, nextScopes = selected) => {
    setPending(true); setMessage('')
    try {
      const next = await request<Payload>('/settings/agent', { method: 'PUT', body: JSON.stringify({ enabled: nextEnabled, scopes: nextScopes }) })
      setPayload(next); setEnabled(next.settings.enabled); setSelected(next.settings.scopes); setMessage(nextEnabled ? 'Agent Gateway 已启用。' : 'Agent Gateway 已停用。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存 Agent 设置失败。'); await load() } finally { setPending(false) }
  }
  useEffect(() => () => { if (scopeTimer.current) window.clearTimeout(scopeTimer.current) }, [])
  const copy = async (text: string, success: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyMessage(success)
    } catch { setCopyMessage('无法复制，请手动选择后复制。') }
  }
  const copyPath = async () => { if (payload?.status.connectionFile) await copy(payload.status.connectionFile, '连接文件路径已复制。') }
  const copyConfig = async () => {
    if (!payload?.status.connectionFile) return
    const config = { mcpServers: { tangentry: { command: 'tangentry-mcp', args: ['--connection-file', payload.status.connectionFile] } } }
    await copy(JSON.stringify(config, null, 2), 'MCP 配置已复制。')
  }
  const rotateToken = async () => {
    if (!payload) return
    if (!window.confirm('轮换令牌后，已经连接的 MCP 客户端需要重新连接。继续吗？')) return
    setPending(true); setMessage('')
    try {
      // Reconfiguring restarts the gateway and generates a new connection token.
      const next = await request<Payload>('/settings/agent', { method: 'PUT', body: JSON.stringify({ enabled: payload.settings.enabled, scopes: payload.settings.scopes }) })
      setPayload(next); setMessage('令牌已轮换，旧连接已失效。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '令牌轮换失败。'); await load() } finally { setPending(false) }
  }
  const running = Boolean(payload?.status.running)

  return <SettingsActionPage className="settings-action-agent" title="Agent 与 MCP" description="让 Claude、Cursor 等外部 Agent 在本机通过 MCP 使用 Tangentry 的研究能力。" status={<SettingsStatus tone={running ? 'positive' : 'neutral'}>{running ? '本机服务运行中' : '服务未启动'}</SettingsStatus>}>
    <SettingsTask>
      <div className="settings-list-card"><SettingsRow setting="agent-enabled" title="启用 Agent Gateway" description="只监听 127.0.0.1，开关立即生效，无需另外保存。">
        <input className="settings-switch" role="switch" aria-label="启用 Agent Gateway" type="checkbox" checked={enabled} disabled={!payload || pending} onChange={event => { const next = event.target.checked; setEnabled(next); void save(next, selected) }}/>
      </SettingsRow></div>
      {message && <p role="status" className="settings-feedback">{message}</p>}
    </SettingsTask>
    <SettingsTask title="授权范围" description={`${selected.length} / ${scopes.length} 项已开启 · Agent 无法自行扩大范围`}>
      <div className="settings-list-card" data-setting="agent-scopes">{scopes.map(scope => <SettingsRow key={scope.id} title={<>{scope.label}{scope.recommended && <small className="agent-recommended">建议开启</small>}</>} description={scope.hint}>
        <input className="settings-switch" role="switch" aria-label={scope.label} type="checkbox" checked={selected.includes(scope.id)} disabled={pending || !enabled} onChange={event => {
          const nextScopes = event.target.checked ? [...selected, scope.id] : selected.filter(value => value !== scope.id)
          setSelected(nextScopes)
          if (scopeTimer.current) window.clearTimeout(scopeTimer.current)
          scopeTimer.current = window.setTimeout(() => void save(enabled, nextScopes), 300)
        }}/>
      </SettingsRow>)}</div>
    </SettingsTask>
    <SettingsTask title="连接 MCP 客户端" description="把配置粘贴到客户端的 MCP 设置中">
      <div className="settings-list-card" data-setting="agent-connection">
        {payload?.status.connectionFile ? <div className="agent-config">
          <pre>{JSON.stringify({ mcpServers: { tangentry: { command: 'tangentry-mcp', args: ['--connection-file', payload.status.connectionFile] } } }, null, 2)}</pre>
          <button type="button" className="button button-secondary" onClick={() => void copyConfig()}><Copy size={14}/>复制配置</button>
        </div> : <p className="settings-empty">启用 Agent 后，这里会显示 MCP 客户端配置。</p>}
        <SettingsRow title="连接文件" description={<span className="settings-mono">{payload?.status.connectionFile || '尚未生成连接文件'}</span>}>
          <button type="button" className="button button-secondary" disabled={!payload?.status.connectionFile} onClick={() => void copyPath()}><Copy size={14}/>复制路径</button>
        </SettingsRow>
        <SettingsRow setting="agent-token" title="轮换令牌" description="旧令牌立即失效，已连接的客户端需要重新连接。">
          <button type="button" className="button button-secondary" disabled={pending || !running} onClick={() => void rotateToken()}><RotateCw size={14}/>轮换</button>
        </SettingsRow>
      </div>
      {copyMessage && <p className="settings-feedback" role="status">{copyMessage}</p>}
    </SettingsTask>
    <SettingsTask title="最近活动" description="仅显示脱敏记录 · 页面可见时每 10 秒刷新">
      <div className="settings-list-card">
        {payload?.activity.audit.map((event, index) => <SettingsRow key={`audit-${index}`} title={<code>{event.action}</code>} description={`${[event.networkFetch && '联网', event.externalProcessing && '外部处理'].filter(Boolean).join(' · ') || '本地'} · ${formatActivityTime(event.createdAt)}`}>
          <SettingsStatus tone={event.outcome === 'ok' ? 'positive' : 'danger'}>{outcomeLabel(event.outcome)}</SettingsStatus>
        </SettingsRow>)}
        {payload?.activity.runs.map(run => <SettingsRow key={run.id} title={run.client || '外部 Agent'} description={<>{run.trigger || '本地'} · {formatActivityTime(run.startedAt)}{run.error && <span className="agent-run-error"> · {run.error}</span>}</>}>
          <SettingsStatus tone={run.state === 'completed' ? 'positive' : run.state === 'failed' ? 'danger' : 'neutral'}>{runStateLabel(run.state)}</SettingsStatus>
        </SettingsRow>)}
        {!payload?.activity.audit.length && !payload?.activity.runs.length && <p className="settings-empty">{payload ? '暂无活动记录。' : '正在读取…'}</p>}
      </div>
    </SettingsTask>
  </SettingsActionPage>
}
