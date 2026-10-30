import { expect, test } from './e2e'
import type { ContentItem } from '../src/shared/api/types'

test('settings keeps the app navigation mounted while its data loads', async ({ page }) => {
  let release = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/settings/cookies', async route => {
    await pending
    await route.continue()
  })
  await page.goto('/history')
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
  const sidebar = await page.locator('#desktop-sidebar').elementHandle()
  const width = await page.locator('#desktop-sidebar').evaluate(node => node.getBoundingClientRect().width)
  try {
    await page.getByRole('button', { name: '工具设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '主导航', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '工具设置', exact: true })).toHaveAttribute('aria-current', 'page')
    expect(await sidebar!.evaluate(node => node.isConnected)).toBe(true)
    expect(await page.locator('#desktop-sidebar').evaluate(node => node.getBoundingClientRect().width)).toBe(width)
    await expect(page.getByText('正在打开页面…', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '历史', exact: true }).click()
    await expect(page).toHaveURL(/\/history$/)
    expect(await sidebar!.evaluate(node => node.isConnected)).toBe(true)
    await expect(page.getByRole('button', { name: '收起侧栏', exact: true })).toBeVisible()
  } finally {
    release()
  }
})

test('settings deep links stay in the current document and browser back returns to content', async ({ page }) => {
  await page.goto('/downloads')
  const sidebar = await page.locator('#desktop-sidebar').elementHandle()
  await page.getByRole('link', { name: '下载与存储设置', exact: true }).click()
  await expect(page).toHaveURL(/\/tools#data\/storage$/)
  await expect(page.getByRole('heading', { name: '数据与备份', exact: true })).toBeVisible()
  expect(await sidebar!.evaluate(node => node.isConnected)).toBe(true)
  await expect(page.getByRole('button', { name: '展开侧栏', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/downloads$/)
  await expect(page.getByRole('link', { name: '下载与存储设置', exact: true })).toBeVisible()
  expect(await sidebar!.evaluate(node => node.isConnected)).toBe(true)
})

test('returning from settings preserves the collection filter and scroll position', async ({ page }) => {
  const items: ContentItem[] = Array.from({ length: 40 }, (_, index) => ({
    id: `bilibili:settings-${index}`, platform: 'bilibili', platformId: `settings-${index}`, kind: 'video',
    title: `保留位置测试 ${index + 1}`, author: '设置导航测试', authorId: 'settings',
    url: `https://www.bilibili.com/video/settings-${index}/`, thumbnailUrl: '',
    description: '仅用于隔离的浏览器导航测试。', durationSeconds: 123, publishedAt: 1720000000,
  }))
  await page.route('**/api/library', route => route.fulfill({ json: { items } }))
  await page.goto('/library')
  const filter = page.getByRole('searchbox', { name: '搜索当前列表', exact: true })
  await filter.fill('保留位置')
  const cards = page.getByTestId('content-card')
  await expect(cards).toHaveCount(40)
  await cards.last().scrollIntoViewIfNeeded()
  const top = await page.evaluate(() => scrollY)
  expect(top).toBeGreaterThan(500)
  await page.getByRole('button', { name: '工具设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '收藏', exact: true }).click()
  await expect(filter).toHaveValue('保留位置')
  await expect(cards).toHaveCount(40)
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(top)
})

test('settings adapts to the space left by expanded and collapsed app navigation', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tangentry-sidebar-width', '236'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/tools#appearance')
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
  const settingsNav = page.getByRole('navigation', { name: '设置目录', exact: true })
  for (const width of [1440, 1280, 1024, 980]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('#desktop-sidebar')).toBeVisible()
    await expect(page.getByRole('heading', { name: '外观', exact: true })).toBeVisible()
    if (width >= 1280) await expect(settingsNav).toBeVisible()
    else {
      await expect(settingsNav).toBeHidden()
      await expect(page.getByRole('button', { name: '返回设置列表', exact: true })).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click()
  await expect(settingsNav).toBeVisible()
  await expect(page.getByRole('button', { name: '返回设置列表', exact: true })).toBeHidden()
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
  await expect(settingsNav).toBeHidden()
  await page.getByRole('button', { name: '返回设置列表', exact: true }).click()
  await expect(settingsNav).toBeVisible()
  await settingsNav.getByRole('button', { name: 'AI 服务', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'AI 服务', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
