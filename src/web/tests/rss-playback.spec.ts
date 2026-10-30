import { expect, test } from './e2e'
import { createServer } from 'vite'

for (const development of [false, true]) {
  test(`RSS audio decodes, seeks and stops on navigation (${development ? 'StrictMode development' : 'production'})`, async ({ page, request, baseURL }) => {
    test.setTimeout(90_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const added = await request.post('/api/subscriptions', {
      data: { type: 'rss', query: 'https://rss-fixture.example/feed.xml' },
    })
    expect(added.ok()).toBe(true)
    const { source } = await added.json()
    expect((await request.post(`/api/subscriptions/${encodeURIComponent(source.id)}/update`)).ok()).toBe(true)
    const server = development ? await createServer({
      server: {
        host: '127.0.0.1', port: 0, strictPort: false,
        proxy: { '/api': { target: baseURL } },
      },
    }) : undefined
    try {
      await server?.listen()
      const origin = server?.resolvedUrls?.local[0] ?? baseURL!
      await page.goto(origin)
      const cardAudio = page.getByLabel('卡片音频播放器 RSS 测试播客', { exact: true })
      expect(await cardAudio.getAttribute('src')).toContain('/api/media/audio?')
      await page.getByRole('button', { name: '播放音频 RSS 测试播客', exact: true }).click()
      await expect.poll(() => cardAudio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0.3)
      await expect(page.getByRole('slider', { name: '音频播放进度 RSS 测试播客', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: '暂停音频 RSS 测试播客', exact: true }).click()
      const cardHandle = await cardAudio.elementHandle()
      await page.getByRole('button', { name: /RSS 测试播客/ }).first().click()
      expect(await cardHandle!.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true)
      const audio = page.getByLabel('播客播放器', { exact: true })
      await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(2)
      expect(await audio.getAttribute('src')).toContain('/api/media/audio?')
      await page.getByRole('button', { name: '播放播客', exact: true }).click()
      await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0.3)
      await page.getByRole('button', { name: '暂停播客', exact: true }).click()
      expect(errors).toEqual([])
      await audio.evaluate((node: HTMLAudioElement) => { node.currentTime = 5 })
      await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeCloseTo(5, 1)
      const old = await audio.elementHandle()
      await page.getByRole('button', { name: '播放播客', exact: true }).click()
      await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(5.3)
      await page.getByRole('button', { name: '返回列表', exact: true }).click()
      expect(await old!.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true)
      // The second entry uses cached content and mounts audio immediately.
      await page.getByRole('button', { name: /RSS 测试播客/ }).first().click()
      await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(2)
      expect(await audio.getAttribute('src')).toContain('/api/media/audio?')
      await page.getByRole('button', { name: '播放播客', exact: true }).click()
      await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0.3)
      await page.getByRole('button', { name: '暂停播客', exact: true }).click()
    } finally {
      await server?.close()
    }
  })
}
