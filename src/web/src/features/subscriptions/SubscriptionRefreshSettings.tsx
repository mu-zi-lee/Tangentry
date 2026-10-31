import { Button, Checkbox, Select } from '../../components/ui'
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { isYouTubeSource } from './sourcePresentation'
import type { SubscriptionSource } from '../../shared/api/types'

const date = (seconds: number) => seconds ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(seconds * 1000)) : '尚未检查'
const intervals = [900, 1800, 3600, 21600, 86400, 604800]
const labels = ['15 分钟', '30 分钟', '1 小时', '6 小时', '1 天', '7 天']

export function SubscriptionRefreshSettings({ source, busy, onSave }: {
  source: SubscriptionSource
  busy: boolean
  onSave: (enabled: boolean, intervalSeconds: number) => Promise<boolean>
}) {
  const youtube = isYouTubeSource(source)
  const bilibili = source.id.startsWith('bilibili:creator:')
  const policy = source.refresh
  const [enabled, setEnabled] = useState(policy.enabled)
  const [interval, setInterval] = useState(policy.intervalSeconds)
  const [baseline, setBaseline] = useState({ enabled: policy.enabled, interval: policy.intervalSeconds })
  const dirty = enabled !== baseline.enabled || interval !== baseline.interval
  useEffect(() => {
    if (dirty) return
    setEnabled(policy.enabled); setInterval(policy.intervalSeconds)
    setBaseline({ enabled: policy.enabled, interval: policy.intervalSeconds })
  }, [policy.enabled, policy.intervalSeconds, dirty])

  return <div className="subscription-refresh" title={`最近成功检查：${date(policy.lastCheckedAt)}${policy.enabled ? `；下次检查：${date(policy.nextCheckAt)}` : ''}`}>
    <form className="subscription-setting-row subscription-refresh-form" onSubmit={event => { event.preventDefault(); void onSave(enabled, interval).then(ok => { if (ok) setBaseline({ enabled, interval }) }) }}>
      <label className="subscription-refresh-toggle"><Checkbox aria-label={youtube ? '自动刷新这个 YouTube 频道' : bilibili ? '自动刷新这个 B 站来源' : '自动刷新这个 RSS 来源'} type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)} />自动更新</label>
      <label className="subscription-field"><span>检查间隔</span><Select disabled={busy || !enabled} data-enabled={enabled} aria-label={youtube ? "YouTube 频道检查间隔" : bilibili ? "B 站来源检查间隔" : "RSS 检查间隔"} value={interval} onChange={event => setInterval(Number(event.target.value))}>{!intervals.includes(interval) && <option value={interval}>{Math.round(interval / 60)} 分钟</option>}{intervals.map((value, index) => <option key={value} value={value}>{labels[index]}</option>)}</Select></label>
      <Button className="button button-secondary" variant="secondary" aria-label="保存更新设置" title="保存更新设置" disabled={busy || !dirty}><Check size={14} aria-hidden="true"/>保存</Button>
    </form>
    <span className="visually-hidden">最近成功检查 {date(policy.lastCheckedAt)}{policy.enabled && ` 下次计划检查 ${date(policy.nextCheckAt)}`}</span>
    {policy.message && <p className="subscription-refresh-error" role="status">{policy.message}{policy.enabled && ' 将按延后的计划重试。'}</p>}
  </div>
}
