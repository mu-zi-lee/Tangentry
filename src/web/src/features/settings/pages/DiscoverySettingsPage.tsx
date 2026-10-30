import { DiscoveryFeedback } from '../DiscoveryFeedback'
import { YouTubeRecommendations } from '../YouTubeRecommendations'
import { useRecommendationPreferences, recommendationPlatforms, type RecommendationPlatform } from '../useRecommendationPreferences'
import type { useDownloads } from '../../downloads/useDownloads'
import type { Feed } from '../../../shared/api/types'
import { request } from '../../../shared/api/client'
import { listOrEmpty } from '../../../shared/api/list'
import { SettingsActionPage, SettingsTask } from '../ui/SettingsActionPage'
import '../accounts-settings.css'
import { useEffect, useRef, useState } from 'react'

type CookieState = { platform: string; configured: boolean }

export function DiscoverySettingsPage({ downloads, onFeed, onDiscover, active = true, platform }: {
  downloads: ReturnType<typeof useDownloads>
  onFeed: (feed: Feed) => void
  onDiscover: () => void
  active?: boolean
  platform?: string
}) {
  const recommendations = useRecommendationPreferences(active)
  const platformLabels: Record<RecommendationPlatform, string> = { youtube: 'YouTube', bilibili: '哔哩哔哩', xiaohongshu: '小红书', xiaoyuzhou: '小宇宙', linuxdo: 'Linux.do', douyin: '抖音', huggingface: 'Hugging Face' }
  const [cookies, setCookies] = useState<CookieState[] | null>(null)
  const [cookieError, setCookieError] = useState('')
  const platformRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const selectedPlatform = platform && recommendationPlatforms.includes(platform as RecommendationPlatform) ? platform : ''

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setCookieError('')
    void request<{ platforms: CookieState[] }>('/settings/cookies', { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setCookies(listOrEmpty(result.platforms))
    }).catch(cause => {
      if (!controller.signal.aborted) setCookieError(cause instanceof Error ? cause.message : '登录状态暂时无法读取。')
    })
    return () => controller.abort()
  }, [active])

  useEffect(() => {
    if (!active || !selectedPlatform) return
    const target = platformRefs.current[selectedPlatform]
    if (target) window.requestAnimationFrame(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }, [active, selectedPlatform])

  const accountConfigured = (id: RecommendationPlatform) => id === 'huggingface' || Boolean(cookies?.some(value => value.platform === id && value.configured))
  const youtubeToolReady = Boolean(downloads.tools?.youtubeRecommendation?.available)
  const platformStatus = (id: RecommendationPlatform) => {
    if (!cookies && id !== 'huggingface') return '正在读取登录状态…'
    if (id === 'youtube' && !youtubeToolReady) return '推荐工具未就绪'
    if (!accountConfigured(id)) return '未登录，暂不能参与推荐'
    return recommendations.values?.[id] ? '参与发现流' : '不参与发现流'
  }

  return <SettingsActionPage title="发现与推荐" description="决定哪些来源进入发现流，以及你不想再看到的内容。">
    <div className="discovery-settings-workspace">
      <YouTubeRecommendations tools={downloads.tools} onFeed={onFeed} onDiscover={onDiscover}/>
      <SettingsTask title="参与推荐的平台" description="需要先登录对应平台；关闭后，发现流不会再请求该来源。">
        {cookieError && <p className="settings-feedback" role="alert">{cookieError}</p>}
        <div className="settings-list-card">{recommendationPlatforms.map(id => {
          const enabled = recommendations.values?.[id] ?? false
          const available = accountConfigured(id) && (id !== 'youtube' || youtubeToolReady)
          const needsLogin = id !== 'huggingface' && !accountConfigured(id)
          return <div className={`settings-list-row discovery-platform-row${selectedPlatform === id ? ' is-focused' : ''}`} data-setting={`discovery-${id}`} data-platform={id} ref={node => { platformRefs.current[id] = node }} key={id}><div className="discovery-platform-lead"><span className={`discovery-platform-mark discovery-platform-${id}`}>{id === 'youtube' ? 'YT' : id === 'bilibili' ? 'B' : platformLabels[id].slice(0, 1)}</span><div><strong>{platformLabels[id]}</strong><p>{platformStatus(id)}</p></div></div><div className="discovery-platform-actions">{needsLogin && <a className="text-button" href={`/tools#accounts/${id}`}>去登录</a>}<input className="settings-switch" type="checkbox" role="switch" aria-label={`${platformLabels[id]}参与推荐`} checked={enabled} disabled={!available || !recommendations.values || Boolean(recommendations.pending)} onChange={event => void recommendations.save(id, event.target.checked)} /></div></div>
        })}</div>
      </SettingsTask>
      <SettingsTask title="已屏蔽" description="来自发现流里的不感兴趣反馈。">
        <DiscoveryFeedback active={active} embedded />
      </SettingsTask>
    </div>
  </SettingsActionPage>
}
