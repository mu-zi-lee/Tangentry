import type { Page } from '@playwright/test'

export async function openSubtitleSettings(page: Page, tool: 'translation' | 'export' | 'source' | 'transcription' = 'translation') {
  if (page.viewportSize()!.width <= 960) {
    await page.getByRole('group', { name: '阅读区域', exact: true }).getByRole('button', { name: /^(字幕|字幕与正文|内容)$/ }).click()
  }
  await page.locator('.subtitle-workbar').waitFor({ state: 'visible' })
  const toggle = tool === 'source' ? page.getByRole('button', { name: '字幕来源与保存', exact: true })
    : tool === 'export' ? page.getByRole('button', { name: '导出字幕与文稿', exact: true })
      : tool === 'transcription' ? page.locator('.subtitle-transcribe-trigger')
        : page.getByRole('button', { name: '字幕翻译', exact: true })
  await toggle.waitFor({ state: 'visible' })
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
}
