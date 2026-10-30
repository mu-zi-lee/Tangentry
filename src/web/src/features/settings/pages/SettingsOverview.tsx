import { AlertCircle, Check, RefreshCw } from 'lucide-react'
import type { SettingsRoute } from '../registry'
import type { SettingsHealth } from '../useSettingsHealth'
import { SettingsActionPage } from '../ui/SettingsActionPage'

export function SettingsOverview({ health, onNavigate }: { health: SettingsHealth; onNavigate: (route: SettingsRoute) => void }) {
  const { data, loading, error, attention, connected, expired } = health
  const aiReady = Boolean(data.ai?.ready || data.ai?.summaryReady)
  const latestBackup = data.backup?.snapshots[0]
  const backupDate = latestBackup ? new Date(latestBackup.createdAt) : null
  const tiles: { title: string; value: string; detail: string; tone?: string; route: SettingsRoute }[] = [
    { title: '平台账号', value: connected === undefined ? '正在读取…' : `${connected} / ${Math.max(6, data.cookies?.length ?? 0)} 已连接`, detail: expired.length ? `${expired.length} 个需要重新登录` : '管理内容来源的登录状态', tone: expired.length ? 'warning' : undefined, route: { section: 'accounts' } },
    { title: 'AI 服务', value: data.ai ? aiReady ? '1 个服务商' : '尚未配置' : '状态未知', detail: [data.ai?.ready && '翻译', data.ai?.summaryReady && '摘要', data.transcription?.ready && '字幕转录'].filter(Boolean).join('、') || '配置模型服务后即可使用', route: { section: 'ai' } },
    { title: 'Agent Gateway', value: data.agent ? data.agent.status.running ? '运行中' : '已停用' : '状态未知', detail: data.agent?.settings.enabled ? `${data.agent.settings.scopes?.length ?? 0} 项权限已授权` : '外部 Agent 无法连接', route: { section: 'agent' } },
    { title: '备份', value: backupDate && Number.isFinite(backupDate.getTime()) ? backupDate.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : data.backup ? '尚无快照' : '状态未知', detail: latestBackup ? latestBackup.status === 'succeeded' ? '最近一次备份成功' : '部分备份目标未完成' : '设置自动备份与存储目标', tone: latestBackup && latestBackup.status !== 'succeeded' ? 'danger' : undefined, route: { section: 'data', tab: 'backup' } },
  ]
  return <SettingsActionPage title="概览" description="需要你处理的事项，以及各项服务当前的状态。">
    {error && <p className="settings-feedback" role="alert">{error}<button type="button" className="text-button" onClick={health.refresh}><RefreshCw size={14}/>重新读取</button></p>}
    <section className="settings-overview-section">
      <div className="settings-section-heading"><h2>需要处理</h2><span>{loading ? '正在检查…' : `${attention.length} 项`}</span></div>
      <div className="settings-list-card">{attention.length ? attention.map(item => <div className="settings-overview-attention-row" key={item.title}><span className="settings-overview-attention-icon" data-tone={item.tone}><AlertCircle size={16}/></span><div><strong>{item.title}</strong><p>{item.detail}</p></div><button type="button" className="button button-secondary" onClick={() => onNavigate(item.route)}>{item.action}</button></div>) : <div className="settings-overview-attention-row"><span className="settings-overview-attention-icon"><Check size={16}/></span><div><strong>{loading ? '正在检查服务状态…' : error ? '部分服务状态待确认' : '目前没有待处理事项'}</strong></div></div>}</div>
    </section>
    <section className="settings-overview-section">
      <div className="settings-section-heading"><h2>服务状态</h2><span>点击进入对应设置</span></div>
      <div className="settings-overview-grid">{tiles.map(tile => <button type="button" className="settings-overview-card" key={tile.title} onClick={() => onNavigate(tile.route)}><small>{tile.title}</small><strong>{tile.value}</strong><span data-tone={tile.tone}>{tile.detail}</span></button>)}</div>
    </section>
  </SettingsActionPage>
}
