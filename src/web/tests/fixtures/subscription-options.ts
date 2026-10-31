import { expect, type Page } from '@playwright/test'

/** The source sheet (settings, health, rename, removal) is a modal dialog opened from the stream header or the manager. */
export function subscriptionSheet(page: Page) {
  return page.locator('#subscription-source-sheet')
}

export async function openSubscriptionSettings(page: Page) {
  if (await subscriptionSheet(page).isVisible()) return
  await page.getByRole('button', { name: '来源设置', exact: true }).click()
  await expect(subscriptionSheet(page)).toBeVisible()
}

export async function closeSubscriptionSettings(page: Page) {
  if (!await subscriptionSheet(page).isVisible()) return
  await subscriptionSheet(page).getByRole('button', { name: '关闭来源设置', exact: true }).click()
  await expect(subscriptionSheet(page)).toBeHidden()
}

/** Opens the add dialog, or focuses the inline add form when there are no sources yet. */
export async function openSubscriptionAdd(page: Page) {
  const toggle = page.locator('#subscription-add-toggle')
  await expect(page.locator('.subscription-page-header')).toHaveAttribute('aria-busy', 'false')
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await expect(page.getByLabel('订阅地址')).toBeVisible()
}

export async function closeSubscriptionAdd(page: Page) {
  const dialog = page.locator('#subscription-add-dialog')
  if (await dialog.isVisible()) await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}
