import { renderToString } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { useDownloads } from '../../downloads/useDownloads'
import { DiscoverySettingsPage } from './DiscoverySettingsPage'

test('discovery settings expose one modern three-section workspace', () => {
  const html = renderToString(<DiscoverySettingsPage
    downloads={{ tools: { youtubeRecommendation: { available: true } } } as unknown as ReturnType<typeof useDownloads>}
    onFeed={() => undefined}
    onDiscover={() => undefined}
  />)

  expect(html).toContain('推荐来源')
  expect(html).toContain('参与推荐的平台')
  expect(html).toContain('已屏蔽')
  expect(html).not.toContain('选择发现设置')
})
