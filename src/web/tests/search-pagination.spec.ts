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

test('switching away from a creator view clears its temporary route state', async ({ page }) => {
  await page.route('**/api/search/creator/bilibili/12345', route => route.fulfill({ json: { platform: 'bilibili', items: [], hasMore: false } }))
  await page.goto('/search?entry=search&creatorPlatform=bilibili&creator=12345')
  await expect(page.getByText('B站 创作者最近内容', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '添加内容', exact: true }).first().click()
  await expect(page).toHaveURL(/\/search\?entry=add$/)
  await expect(page.getByRole('heading', { name: '添加内容', exact: true })).toBeVisible()
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

test('search submits once and applies the route filters before the first request', async ({ page }) => {
  const calls: string[] = []
  await page.route('**/api/search?*', route => {
    const url = new URL(route.request().url())
    calls.push(url.pathname + '?' + url.searchParams.toString())
    return route.fulfill({ json: { query: url.searchParams.get('q'), local: { items: [], total: 0, counts: {} }, sources: {} } })
  })
  await page.goto('/search?entry=search&platform=youtube')
  await expect(page.getByRole('combobox', { name: '平台' })).toHaveValue('youtube')
  await page.getByLabel('搜索本机资料库与各平台').fill('测试检索')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect.poll(() => calls.length).toBeGreaterThan(0)
  expect(calls).toEqual(['/api/search?q=%E6%B5%8B%E8%AF%95%E6%A3%80%E7%B4%A2&platform=youtube'])
  expect(new URLSearchParams(calls[0].split('?')[1]).get('platform')).toBe('youtube')
  expect(new URLSearchParams(calls[0].split('?')[1]).get('q')).toBe('测试检索')
})

test('adding content can recover from an upstream error without losing the draft', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/discovery/bilibili?**', route => {
    attempts++
    if (attempts === 1) return route.fulfill({ status: 502, json: { code: 'platform_unavailable', message: '测试平台暂时不可用。' } })
    return route.fulfill({ json: { items: [{ id: 'bilibili:retry', platform: 'bilibili', platformId: 'BVretry00000', kind: 'video', title: '重试后读取到的视频', author: '测试作者', authorId: '', url: 'https://www.bilibili.com/video/BVretry00000', thumbnailUrl: '', description: '', durationSeconds: 10, publishedAt: 0 }], page: 1, total: 1, hasMore: false, sourceTitle: '测试作者', query: '12345' } })
  })
  await page.goto('/search')
  const input = page.getByLabel('UP 主 UID 或视频地址')
  await input.fill('12345')
  await page.getByRole('button', { name: '获取内容', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('测试平台暂时不可用')
  await expect(input).toHaveValue('12345')
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('heading', { name: '重试后读取到的视频', exact: true })).toBeVisible()
  expect(attempts).toBe(2)
})

test('add results can be filtered locally and keep the filter in the route', async ({ page }) => {
  const item = (id: string, title: string) => ({ id, platform: 'bilibili', platformId: id.split(':')[1], kind: 'video', title, author: '测试作者', authorId: '', url: `https://www.bilibili.com/video/${id.split(':')[1]}`, thumbnailUrl: '', description: '', durationSeconds: 10, publishedAt: 0 })
  await page.route('**/api/discovery/bilibili?**', route => route.fulfill({ json: { items: [item('bilibili:first', '目标视频'), item('bilibili:second', '另一个视频'), item('bilibili:third', '无关内容')], page: 1, total: 3, hasMore: false, sourceTitle: '测试作者', query: '12345' } }))
  await page.goto('/search')
  await page.getByLabel('UP 主 UID 或视频地址').fill('12345')
  await page.getByRole('button', { name: '获取内容', exact: true }).click()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(3)
  await page.getByLabel('搜索当前列表').fill('目标')
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(1)
  await expect(page).toHaveURL(/entry=add[^#]*list=%E7%9B%AE%E6%A0%87/)
})

test('starting a new add search clears the previous list filter and result cache', async ({ page }) => {
  let query = ''
  await page.route('**/api/discovery/bilibili?**', route => {
    query = new URL(route.request().url()).searchParams.get('q') ?? ''
    const title = query === 'second' ? '第二批内容' : '第一批内容'
    const item = { id: `bilibili:${query}`, platform: 'bilibili', platformId: query, kind: 'video', title, author: '测试作者', authorId: '', url: `https://www.bilibili.com/video/${query}`, thumbnailUrl: '', description: '', durationSeconds: 10, publishedAt: 0 }
    return route.fulfill({ json: { items: [item, { ...item, id: `${item.id}:extra`, title: `${title} 另一条` }], page: 1, total: 2, hasMore: false, sourceTitle: '测试作者', query } })
  })
  await page.goto('/search')
  const input = page.getByLabel('UP 主 UID 或视频地址')
  await input.fill('first')
  await page.getByRole('button', { name: '获取内容', exact: true }).click()
  await expect(page.getByRole('heading', { name: '第一批内容', exact: true })).toBeVisible()
  await page.getByLabel('搜索当前列表').fill('第一')
  await expect(page).toHaveURL(/list=/)
  await input.fill('second')
  await page.getByRole('button', { name: '获取内容', exact: true }).click()
  await expect(page.getByRole('heading', { name: '第二批内容', exact: true })).toBeVisible()
  await expect(page.getByLabel('搜索当前列表')).toHaveValue('')
  await expect(page).not.toHaveURL(/list=/)
  expect(query).toBe('second')
})
