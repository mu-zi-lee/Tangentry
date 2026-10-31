import { expect, test } from './e2e'

test('Bilibili QR login polls until confirmed without exposing credentials', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 })
  let polls = 0
  await page.route('**/api/settings/bilibili/login', route => route.fulfill({ json: { id: 'synthetic-session', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZioAAAAASUVORK5CYII=', status: 'waiting', expiresAt: Date.now()/1000+180 } }))
  await page.route('**/api/settings/bilibili/login/synthetic-session', route => {
    polls++
    return route.fulfill({ json: { id: 'synthetic-session', status: 'success', expiresAt: Date.now()/1000+180 } })
  })
  await page.goto('/tools#accounts')
  await page.getByRole('button', { name: '连接哔哩哔哩', exact: true }).click()
  await page.getByRole('button', { name: '扫码登录 B站' }).click()
  await expect(page.getByAltText('B站登录二维码')).toBeVisible()
  await expect(page.getByText('登录成功，已保存 Cookie。', { exact: true })).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(3000)
  expect(polls).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})
