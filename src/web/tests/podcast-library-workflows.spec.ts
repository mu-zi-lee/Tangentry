import { expect, test } from './e2e'
import { openSubscriptionAdd } from './fixtures/subscription-options'

test('subscription inbox presets, filters, saved views, and podcast add stay in the intended context', async ({ page }) => {
  await page.goto('/subscriptions?mode=history')
  const inbox = page.getByRole('region', { name: '历史收件箱' })
  const presets = page.getByRole('navigation', { name: '常用订阅筛选' })
  await expect(inbox).toBeVisible()
  await expect(presets.getByRole('button', { name: /本周视频/ })).toBeVisible()
  await expect(page.getByRole('group', { name: '自定义订阅视图' })).toHaveCount(0)

  await presets.getByRole('button', { name: /本周视频/ }).click()
  await expect(page).toHaveURL(/\/subscriptions\?view=/)
  await inbox.getByRole('searchbox', { name: '搜索历史内容' }).fill('测试筛选')
  await inbox.getByRole('button', { name: '应用筛选' }).click()
  await expect(page).toHaveURL('/subscriptions?mode=history')
  await expect(inbox.getByRole('searchbox', { name: '搜索历史内容' })).toHaveValue('测试筛选')

  await inbox.getByRole('button', { name: '保存为视图' }).click()
  await inbox.getByRole('textbox', { name: '视图名称' }).fill('测试视图')
  await inbox.getByRole('button', { name: '保存视图', exact: true }).click()
  await expect(page).toHaveURL(/\/subscriptions\?view=/)
  await expect(page.getByRole('group', { name: '自定义订阅视图' }).getByRole('button', { name: /测试视图/ })).toBeVisible()

  await openSubscriptionAdd(page)
  await expect(page.locator('#subscription-add-toggle')).toHaveAttribute('aria-expanded', 'true')
  await page.getByLabel('订阅地址').fill('https://rss-fixture.example/feed.xml')
  await expect(page.locator('.add-source-confirm')).toContainText('RSS / 播客')
  await expect(page).toHaveURL(/\/subscriptions\?view=/)
})
