import { expect, test } from './e2e'

test('card width stays saved and appearance preview remains available', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/tools#display')
  const width = page.getByRole('slider', { name: '卡片宽度', exact: true })
  await expect(width).toBeVisible()
  await width.fill('420')
  await expect(page.locator('.settings-display-previews')).toBeVisible()
  await page.reload()
  await expect(width).toHaveValue('420')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('appearance survives a fresh browser session on a different loopback origin', async ({ page, browser, baseURL, request }) => {
  await page.goto('/tools#display')
  await page.getByRole('slider', { name: '卡片宽度', exact: true }).fill('360')
  await page.getByRole('group', { name: '圆角', exact: true }).getByRole('button', { name: '大', exact: true }).click()
  await page.getByRole('switch', { name: /显示摘要/ }).uncheck()
  await page.getByRole('group', { name: '正文字体', exact: true }).getByRole('button', { name: '无衬线', exact: true }).click()
  await page.getByRole('slider', { name: '阅读字号', exact: true }).fill('19')
  await page.getByRole('group', { name: '行高', exact: true }).getByRole('button', { name: '宽松', exact: true }).click()
  for (const [key, expected] of [['card_appearance', { width: 360, corners: 'round', excerpt: false }], ['font_settings', { reading: 'noto', fontSize: 19, lineHeight: 'relaxed' }]] as const) {
    await expect.poll(async () => JSON.parse((await (await request.get(`/api/preferences/${key}`)).json()).value || '{}')).toMatchObject(expected)
  }
  // localhost and 127.0.0.1 have separate storage, just like changing the desktop port.
  const restarted = await browser.newContext({ baseURL: baseURL!.replace('127.0.0.1', 'localhost') })
  try {
    const fresh = await restarted.newPage()
    await fresh.goto('/tools#display')
    await expect(fresh.getByRole('slider', { name: '卡片宽度', exact: true })).toHaveValue('360')
    await expect(fresh.getByRole('slider', { name: '阅读字号', exact: true })).toHaveValue('19')
    await expect(fresh.getByRole('switch', { name: /显示摘要/ })).not.toBeChecked()
    await expect(fresh.getByRole('button', { name: '无衬线', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const root = fresh.locator('html')
    await expect(root).toHaveAttribute('data-font-reading', 'noto')
    await expect(root).toHaveAttribute('data-card-excerpt', 'off')
    expect(await root.evaluate(node => [node.style.getPropertyValue('--card-min'), node.style.getPropertyValue('--card-radius'), node.style.getPropertyValue('--font-reading-size'), node.style.getPropertyValue('--font-reading-line-height')])).toEqual(['360px', '20px', '19px', '2.1'])
    await fresh.getByRole('slider', { name: '卡片宽度', exact: true }).fill('280')
    await expect.poll(async () => JSON.parse((await (await request.get('/api/preferences/card_appearance')).json()).value || '{}').width).toBe(280)
    await fresh.reload()
    await expect(fresh.getByRole('slider', { name: '卡片宽度', exact: true })).toHaveValue('280')
  } finally { await restarted.close() }
})

test('saved theme wins over stale origin storage before React starts', async ({ page, request }) => {
  expect((await request.put('/api/preferences/theme', { data: { value: 'dark', revision: Date.now() + 1 } })).ok()).toBe(true)
  await page.addInitScript(() => {
    localStorage.setItem('tangentry-theme', 'light')
    document.addEventListener('DOMContentLoaded', () => {
      Object.assign(window, { __bootTheme: { theme: document.documentElement.dataset.theme, saved: (window as unknown as { __TANGENTRY_THEME_SAVED__: boolean }).__TANGENTRY_THEME_SAVED__ } })
    }, { once: true })
  })
  await page.goto('/tools#appearance')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => (window as unknown as { __bootTheme: unknown }).__bootTheme)).toEqual({ theme: 'dark', saved: true })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('download confirmation traps focus and cancels without deleting records', async ({ page }) => {
  let deletions = 0
  await page.route('**/api/downloads', route => route.fulfill({ json: { jobs: [{
    id: 'ui-cancelled-job', url: 'https://example.com/video', title: '界面验证任务',
    state: 'cancelled', message: '已取消下载。', createdAt: 1700000000,
    maxHeight: 1080, container: 'mp4',
  }] } }))
  await page.route('**/api/downloads/ui-cancelled-job', route => {
    if (route.request().method() === 'DELETE') deletions++
    return route.fulfill({ status: 204 })
  })
  await page.goto('/downloads')
  const trigger = page.getByRole('button', { name: '删除下载记录 界面验证任务', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '删除 1 条记录', exact: true })
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(node => node.matches(':modal'))).toBe(true)
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true)
  }
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Shift+Tab')
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true)
  }
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  expect(deletions).toBe(0)
})
