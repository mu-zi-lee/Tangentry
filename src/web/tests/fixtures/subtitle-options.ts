import type { Page } from '@playwright/test'
import { openSubtitleSettings } from '../subtitle-settings'
export async function openSubtitleOptions(page: Page) {
  await openSubtitleSettings(page, 'export')
}
export async function closeSubtitleOptions(page: Page) {
  const close = page.locator('.subtitle-inline-panel:visible .subtitle-inline-close')
  if (await close.count()) await close.click()
}
