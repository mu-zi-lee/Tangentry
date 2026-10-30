import { Button } from '../../components/ui'
import { ArrowUpRight, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { request } from '../../shared/api/client'
import { listOrEmpty } from '../../shared/api/list'
import type { Feed, ToolReport } from '../../shared/api/types'
import { SettingsTask } from './ui/SettingsActionPage'
import { SettingsRow, SettingsStatus } from './ui/SettingsRow'

export function YouTubeRecommendations({ tools, onFeed, onDiscover }: {
  tools: ToolReport | null
  onFeed: (feed: Feed) => void
  onDiscover: () => void
}) {
  const runtime = tools?.youtubeRecommendation
  const [pending, setPending] = useState(false), [result, setResult] = useState(''), [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  function cancel() {
    controller.current?.abort()
    controller.current = null
    setPending(false)
  }
  async function check() {
    if (controller.current) return
    const active = new AbortController()
    controller.current = active
    setPending(true); setError(''); setResult('')
    try {
      const feed = await request<Feed>('/recommendations/youtube', { signal: active.signal })
      if (active.signal.aborted) return
      const items = listOrEmpty(feed.items)
      setResult(`已读取 ${items.length} 条${feed.sourceTitle === 'YouTube 账号订阅动态' ? '账号订阅动态' : '首页推荐'}。`)
      onFeed({ ...feed, items })
    } catch (cause) {
      if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : '推荐暂不可用。')
    } finally {
      if (controller.current === active) {
        controller.current = null
        setPending(false)
      }
    }
  }
  return <SettingsTask title="推荐来源">
    <div className="settings-list-card"><SettingsRow setting="recommendation-source" title="YouTube 推荐" description={runtime?.version ? `通过 ${runtime.version} 读取已登录账号的首页推荐` : '使用已保存的 YouTube 账号读取首页推荐'}>
      <SettingsStatus tone={runtime?.available ? 'positive' : 'warning'}>{runtime?.available ? '工具已就绪' : '工具未就绪'}</SettingsStatus>
      <Button variant="secondary" aria-label="检测推荐连接" className="button button-secondary" disabled={pending || !runtime?.available} onClick={() => void check()}>{pending ? <LoaderCircle size={14} className="spin"/> : <RefreshCw size={14}/>}测试推荐</Button>
      {pending && <Button variant="quiet" iconOnly className="icon-button" aria-label="取消检测" title="取消检测" onClick={cancel}><X size={16}/></Button>}
    </SettingsRow></div>
    {result && <p className="settings-feedback" role="status">{result}</p>}
    {result && <Button variant="quiet" className="text-button" onClick={onDiscover}>查看内容<ArrowUpRight size={14} aria-hidden="true"/></Button>}
    {error && <p className="settings-feedback" role="alert">{error}</p>}
  </SettingsTask>
}
