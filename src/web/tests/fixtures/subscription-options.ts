import { expect, type Page } from '@playwright/test'

export async function openSubscriptionSettings(page: Page) {
  const toggle = page.getByRole('button', { name: '来源设置', exact: true })
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
}

export async function closeSubscriptionSettings(page: Page) {
  const toggle = page.getByRole('button', { name: '来源设置', exact: true })
  if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click()
}

export async function openSubscriptionAdd(page: Page) {
  const toggle = page.locator('#subscription-add-toggle')
  await expect(page.locator('.subscription-page-header')).toHaveAttribute('aria-busy', 'false')
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
}
