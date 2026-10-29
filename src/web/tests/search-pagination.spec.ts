import { expect, test } from './e2e'

test('top-level add action opens the guided add-content entry', async ({ page }) => {
  await page.goto('/')
  await page.locator('.experience-add').click()
  await expect(page).toHaveURL(/\/search\?entry=add$/)
  await expect(page.getByRole('heading', { name: '添加内容', exact: true })).toBeVisible()
  const input = page.getByLabel('UP 主 UID 或视频地址')
  await input.fill('https://www.youtube.com/watch?v=abcdefghijk')
  await expect(page.getByRole('button', { name: 'YouTube', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('search pagination retains its result source after switching inputs and deduplicates every batch', async ({ page }) => {
  const item = (index: number) => ({ id: `bilibili:BVsearch${index}`, platform: 'bilibili', platformId: `BVsearch${index}`, kind: 'video', title: `分页视频 ${index}`, author: '测试作者', authorId: '', url: `https://www.bilibili.com/video/BVsearch${index}`, thumbnailUrl: '', description: '', durationSeconds: 10, publishedAt: 0 })
  const calls: string[] = []
  await page.route('**/api/discovery/*?*', route => {
    const url = new URL(route.request().url())
    calls.push(url.pathname + '?' + url.searchParams.toString())
    const number = Number(url.searchParams.get('page'))
    return route.fulfill({ json: { source: 'bilibili', items: number === 1 ? [item(1), item(1)] : [item(1), item(2), item(2)], page: number, total: 2, hasMore: number === 1, query: url.searchParams.get('q'), sourceTitle: '分页测试' } })
  })
  await page.goto('/search')
  await page.getByLabel('UP 主 UID 或视频地址').fill('12345')
  await page.getByRole('button', { name: '获取内容', exact: true }).click()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(1)
  await page.getByRole('button', { name: 'YouTube', exact: true }).click()
  await page.getByRole('button', { name: '继续浏览', exact: true }).click()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(2)
  expect(calls).toEqual(['/api/discovery/bilibili?q=12345&page=1', '/api/discovery/bilibili?q=12345&page=2'])
  await expect(page.getByRole('button', { name: '继续浏览', exact: true })).toHaveCount(0)
})
