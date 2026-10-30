import { openSubtitleSettings } from './subtitle-settings'
import { openSubtitleOptions, closeSubtitleOptions } from './fixtures/subtitle-options'
import { expect, test, type Page } from './e2e'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import type { ContentItem, ReadingNote } from '../src/shared/api/types'

// Only platform discovery is intercepted; collection uses the real Go API / SQLite.
const fixture: ContentItem = {
  id: 'bilibili:BV17x411w7KC', platform: 'bilibili', platformId: 'BV17x411w7KC', kind: 'video',
  title: '浏览器测试样例：沿着好奇心继续发现', author: '测试创作者', authorId: '12345',
  url: 'https://www.bilibili.com/video/BV17x411w7KC/', thumbnailUrl: '',
  description: '明确标识的浏览器测试内容，不是正式应用中的推荐数据。', durationSeconds: 123, publishedAt: 1720000000,
}

test.beforeEach(async ({ request }) => {
  const { jobs } = await (await request.get('/api/downloads')).json()
  for (const job of jobs) {
    if (job.state === 'queued' || job.state === 'running') await request.post(`/api/downloads/${job.id}/cancel`)
    const removed = await request.delete(`/api/downloads/${job.id}`, { data: { deleteFiles: false } })
    expect(removed.ok(), `${removed.status()}: ${await removed.text()}`).toBe(true)
  }
  const response = await request.get('/api/library')
  const { items } = await response.json() as { items: ContentItem[] }
  for (const item of items) await request.delete(`/api/library/${encodeURIComponent(item.id)}`)
  // This API client is bound to the isolated E2E server on 7391, never production data.
  for (const video of ['BV17x411w7KC', 'BV1Pyta66EDh', 'BVlogin00000', 'BVnone000000', 'BVlong000000', 'BVcancel0000']) {
    const response = await request.get(`/api/notes?contentId=${encodeURIComponent(`bilibili:${video}`)}`)
    const { notes } = await response.json() as { notes: ReadingNote[] }
    for (const note of notes) await request.delete(`/api/notes/${note.id}`)
    const { tracks } = await (await request.get('/api/saved-subtitles?contentId=' + encodeURIComponent(`bilibili:${video}`))).json()
    for (const saved of tracks) await request.delete('/api/saved-subtitles/' + encodeURIComponent(`bilibili:${video}`) + '/' + saved.track.language + '?revision=' + saved.revision)
  }
})

async function seekRealPlayback(page: Page) {
  await page.getByRole('button', { name: /^播放视频 / }).click()
  const video = page.getByLabel('B站在线视频播放器', { exact: true })
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(1)
  await video.evaluate((node: HTMLVideoElement) => node.pause())
  await page.getByRole('button', { name: '跳转播放时间 00:01', exact: true }).click()
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(1.25, 2)
}

test('discovery topics use one manager for creating, renaming and deleting the active topic', async ({ page, request }) => {
  await page.route('**/api/discovery/bilibili?**', route => route.fulfill({ json: { items: [fixture], page: 1, total: 1, hasMore: false, sourceTitle: fixture.author, query: fixture.platformId } }))
  await page.goto('/')
  const topics = page.getByRole('group', { name: '主题筛选' })
  await page.getByRole('button', { name: '管理主题', exact: true }).click()
  await page.getByRole('dialog', { name: '管理主题' }).getByRole('button', { name: '新增主题' }).click()
  const dialog = page.getByRole('dialog', { name: '新增主题' })
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(50)
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('主题名称').fill('AI')
  await dialog.getByRole('button', { name: '保存主题' }).click()
  await expect(page.getByRole('dialog', { name: '管理主题' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()

  const topic = topics.getByRole('button', { name: 'AI', exact: true })
  await expect(topic).toBeVisible()
  const size = await topic.evaluate(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }))
  expect(size.width).toBeGreaterThan(size.height)
  expect(size.height).toBeGreaterThanOrEqual(26)
  await expect(topics.getByRole('button', { name: /编辑主题|删除主题/ })).toHaveCount(0)

  await page.getByRole('button', { name: '管理主题', exact: true }).click()
  await page.getByRole('dialog').getByRole('searchbox', { name: '搜索主题' }).fill('AI')
  await page.getByRole('dialog').getByRole('button', { name: '编辑主题 AI', exact: true }).click()
  const editDialog = page.getByRole('dialog', { name: '编辑主题' })
  await expect(editDialog.getByLabel('主题名称')).toHaveValue('AI')
  await editDialog.getByLabel('主题名称').fill('人工智能')
  await editDialog.getByRole('button', { name: '保存主题' }).click()
  await expect(topics.getByRole('button', { name: '人工智能', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('searchbox', { name: '搜索主题' })).toHaveValue('')
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await topics.getByRole('button', { name: '人工智能', exact: true }).click()
  await expect(page).toHaveURL(/topic=/)
  await page.getByRole('button', { name: '管理主题', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除主题 人工智能', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: '删除主题 人工智能', exact: true })).toHaveCount(0)
  await page.getByRole('dialog').press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page).not.toHaveURL(/topic=/)
  expect((await (await request.get('/api/discovery/topics')).json()).topics).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: '人工智能' })]))
})

test('reading notes save, edit, persist and delete with subtitle time without collecting or downloading', async ({ page, request }) => {
  await page.route('**/api/discovery/bilibili?**', route => route.fulfill({ json: { items: [fixture], page: 1, total: 1, hasMore: false, sourceTitle: fixture.author, query: fixture.platformId } }))
  const beforeJobs = (await (await request.get('/api/downloads')).json()).jobs
  await page.goto(`/reader?video=${fixture.platformId}`)
  await expect(page.getByRole('heading', { name: '我的笔记' })).toBeVisible()
  await seekRealPlayback(page)
  await page.getByLabel('笔记正文').fill('笔记测试：记录关联字幕的想法。')
  await expect(page.getByLabel('笔记正文')).toHaveValue('笔记测试：记录关联字幕的想法。')
  await expect(page.getByLabel('笔记关联时间', { exact: true })).toHaveText('00:01')
  await expect(page.getByLabel('笔记正文')).toBeFocused()
  await page.getByRole('button', { name: '保存笔记', exact: true }).click()
  await expect(page.getByRole('list', { name: '已保存笔记' }).getByRole('listitem')).toHaveCount(1)
  await expect(page.getByLabel('笔记正文')).toHaveValue('')
  const { notes } = await (await request.get(`/api/notes?contentId=${encodeURIComponent(fixture.id)}`)).json() as { notes: ReadingNote[] }
  expect(notes[0].positionSeconds).toBe(1)
  expect(notes[0].contentId).toBe(fixture.id)
  await page.getByRole('button', { name: '编辑笔记 笔记测试', exact: false }).click()
  await page.getByLabel('笔记正文').fill('笔记测试：编辑后仍关联原视频。')
  await page.getByRole('button', { name: '移除笔记关联时间', exact: true }).click()
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.getByRole('list', { name: '已保存笔记' })).toContainText('编辑后仍关联原视频')
  const updated = (await (await request.get(`/api/notes?contentId=${encodeURIComponent(fixture.id)}`)).json()).notes[0] as ReadingNote
  expect(updated.id).toBe(notes[0].id)
  expect(updated.createdAt).toBe(notes[0].createdAt)
  expect(updated.positionSeconds).toBeNull()
  await page.reload()
  await expect(page.getByRole('list', { name: '已保存笔记' })).toContainText('编辑后仍关联原视频')
  const readerAreas = page.getByRole('group', { name: '阅读区域', exact: true })
  await expect(readerAreas).toBeVisible()
  await expect(page.locator('.reading-nav .reading-nav-modes')).toContainText('字幕')
  await expect(readerAreas.getByRole('button', { name: '笔记', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await readerAreas.getByRole('button', { name: '字幕', exact: true }).click()
  await expect(page.locator('.reading-columns')).toHaveAttribute('data-notebook-panel', 'content')
  await expect(page.locator('.reading-notes')).toBeHidden()
  await readerAreas.getByRole('button', { name: '笔记', exact: true }).click()
  await expect(page.locator('.reading-notes')).toBeVisible()
  await readerAreas.getByRole('button', { name: '专注模式', exact: true }).click()
  await expect(page.locator('.reading-columns')).toHaveAttribute('data-theater', 'true')
  await expect(page.locator('.reading-notes')).toBeHidden()
  await expect(page.locator('.reading-columns')).toHaveCSS('grid-template-columns', /^\d+(?:\.\d+)?px$/)
  await readerAreas.getByRole('button', { name: '退出专注', exact: true }).click()
  await expect(page.locator('.reading-columns')).toHaveAttribute('data-theater', 'false')
  await expect(page.locator('.reading-notes')).toBeVisible()
  expect((await (await request.get('/api/library')).json()).items).toEqual([])
  expect((await (await request.get('/api/downloads')).json()).jobs).toEqual(beforeJobs)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  // axe and keyboard checks can leave the skip link focused and the document scrolled.
  // Normalize only focus/scroll before capturing the full-page layout.
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0) })
  await page.setViewportSize({ width: 390, height: 844 })
  await readerAreas.getByRole('button', { name: '字幕', exact: true }).click()
  await expect(page.locator('.reading-notes')).toBeHidden()
  await expect(page.locator('.subtitle-reader')).toBeVisible()
  await readerAreas.getByRole('button', { name: '笔记', exact: true }).click()
  await expect(page.locator('.reading-notes')).toBeVisible()
  await expect(page.locator('.subtitle-reader')).toBeHidden()
  await page.locator('.notes-panel').scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0) })
  await page.getByRole('button', { name: '删除笔记 笔记测试', exact: false }).click()
  await page.getByRole('button', { name: '保留笔记', exact: true }).click()
  const deleteButton = page.getByRole('button', { name: '删除笔记 笔记测试', exact: false })
  await deleteButton.scrollIntoViewIfNeeded()
  const hitTarget = await deleteButton.evaluate(node => {
    const bounds = node.getBoundingClientRect()
    return node.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
  })
  expect(hitTarget).toBe(true)
  await expect(page.getByRole('list', { name: '已保存笔记' }).getByRole('listitem')).toHaveCount(1)
  await page.getByRole('button', { name: '删除笔记 笔记测试', exact: false }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('list', { name: '已保存笔记' })).toHaveCount(0)
  expect((await (await request.get(`/api/notes?contentId=${encodeURIComponent(fixture.id)}`)).json()).notes).toEqual([])
})

test('note drafts survive navigation and failed saves without pretending to be persisted', async ({ page, request }) => {
  await page.route('**/api/discovery/bilibili?**', route => route.fulfill({ json: { items: [fixture], page: 1, total: 1, hasMore: false, sourceTitle: fixture.author, query: fixture.platformId } }))
  await page.goto(`/reader?video=${fixture.platformId}`)
  await seekRealPlayback(page)
  await expect(page.locator('.notes-panel')).not.toContainText('正在打开笔记')
  await expect(page.getByRole('button', { name: '保存笔记', exact: true })).toBeDisabled()
  await page.getByLabel('笔记正文').fill('笔记草稿测试：尚未保存。')
  await page.getByLabel('笔记正文').fill('字'.repeat(8001))
  await page.getByRole('button', { name: '保存笔记', exact: true }).click()
  await expect(page.locator('.notes-panel').getByRole('alert')).toContainText('请填写 1–8000 字')
  await expect(page.getByLabel('笔记正文')).toBeFocused()
  await page.getByLabel('笔记正文').fill('笔记草稿测试：尚未保存。')
  await page.getByRole('button', { name: '返回列表' }).click()
  await page.goto(`/reader?video=${fixture.platformId}`)
  await expect(page.getByLabel('笔记正文')).toHaveValue('笔记草稿测试：尚未保存。')
  await expect(page.getByLabel('笔记关联时间', { exact: true })).toHaveText('00:01')
  await page.route('**/api/notes', route => route.request().method() === 'POST' ? route.fulfill({ status: 500, json: { code: 'internal_error', message: '测试笔记写入失败。' } }) : route.continue())
  await page.getByRole('button', { name: '保存笔记', exact: true }).click()
  await expect(page.locator('.notes-panel').getByRole('alert')).toContainText('测试笔记写入失败')
  await expect(page.getByLabel('笔记正文')).toHaveValue('笔记草稿测试：尚未保存。')
  expect((await (await request.get(`/api/notes?contentId=${encodeURIComponent(fixture.id)}`)).json()).notes).toEqual([])
  await page.reload()
  await expect(page.getByLabel('笔记正文')).toHaveValue('笔记草稿测试：尚未保存。')
  await page.unroute('**/api/notes')
  await page.getByRole('button', { name: '保存笔记', exact: true }).click()
  await expect(page.getByRole('list', { name: '已保存笔记' })).toContainText('笔记草稿测试')
  expect((await (await request.get(`/api/notes?contentId=${encodeURIComponent(fixture.id)}`)).json()).notes[0].positionSeconds).toBe(1)
  await expect(page.getByLabel('笔记正文')).toHaveValue('')
  await page.reload()
  await expect(page.getByLabel('笔记正文')).toHaveValue('')
})

test('personal notes remain available and isolated when platform metadata cannot be loaded', async ({ page, request }) => {
  const source = 'bilibili:BV1Pyta66EDh'
  const created = await request.post('/api/notes', { data: { contentId: source, body: '<script>只是笔记文字</script>', positionSeconds: 125 } })
  expect(created.status()).toBe(201)
  await page.route('**/api/discovery/bilibili?**', route => route.fulfill({ status: 502, json: { code: 'platform_unavailable', message: '测试平台暂时不可用。' } }))
  await page.goto('/reader?video=BV1Pyta66EDh')
  await expect(page.getByRole('alert')).toContainText('测试平台暂时不可用')
  await expect(page.getByRole('list', { name: '已保存笔记' })).toContainText('<script>只是笔记文字</script>')
  expect(await page.locator('.note-list script').count()).toBe(0)
  await expect(page.getByRole('button', { name: '跳转笔记关联时间 02:05', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '在原视频打开笔记时间 02:05' })).toHaveAttribute('href', 'https://www.bilibili.com/video/BV1Pyta66EDh/?p=1&t=125')
  await page.getByLabel('笔记正文').fill('平台失败时仍能保存自己的想法。')
  await page.getByRole('button', { name: '保存笔记', exact: true }).click()
  await expect(page.getByRole('list', { name: '已保存笔记' }).getByRole('listitem')).toHaveCount(2)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.goto(`/reader?video=${fixture.platformId}`)
  await expect(page.locator('.notes-panel')).not.toContainText('正在打开笔记')
  await expect(page.getByRole('button', { name: '保存笔记', exact: true })).toBeDisabled()
  await expect(page.getByRole('list', { name: '已保存笔记' })).toHaveCount(0)
  await expect(page.getByLabel('笔记正文')).toHaveValue('')
})

test('empty app and mobile navigation are usable', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '发现', exact: true })).toBeVisible()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(0)
  await expect(page.locator('.desktop-nav').getByRole('button', { name: '收藏', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '菜单', exact: true }).click()
  await page.getByRole('dialog', { name: '导航菜单' }).getByRole('button', { name: '收藏', exact: true }).click()
  await expect(page.getByRole('heading', { name: '收藏', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: '导航菜单' })).not.toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  expect(overflow).toBe(false)
})

test('empty data opens every settings section without page load errors', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('/tools')
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
  const navigation = page.getByRole('navigation', { name: '设置目录', exact: true })
  for (const [label, title] of [['概览', '概览'], ['外观', '外观'], ['平台账号', '平台账号'], ['发现与推荐', '发现与推荐'], ['AI 服务', 'AI 服务'], ['Agent 与 MCP', 'Agent 与 MCP'], ['数据与备份', '数据与备份'], ['组件与更新', '组件与更新']]) {
    await navigation.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator('.settings-action-page').getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: '页面未能加载' })).toHaveCount(0)
  }
  await page.goto('/tools#transcription')
  await expect(page.getByRole('heading', { name: 'AI 服务', exact: true })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'AI 服务分区' }).getByRole('tab', { name: '字幕转录' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('group', { name: '转录引擎' })).toBeVisible()
  await page.goto('/tools#backup')
  await expect(page.getByRole('heading', { name: '数据与备份', exact: true })).toBeVisible()
  await expect(page.locator('#settings-backup')).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('settings search opens the matching row and mobile details return to the directory', async ({ page }) => {
  await page.goto('/tools')
  const desktopSearch = page.getByRole('searchbox', { name: '搜索设置', exact: true }).first()
  await desktopSearch.fill('模型')
  const desktopNavigation = page.getByRole('navigation', { name: '设置目录', exact: true }).first()
  await expect(desktopNavigation.getByRole('button', { name: 'AI 服务', exact: true })).toBeVisible()
  await expect(desktopNavigation.getByRole('button', { name: '数据与备份', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '翻译模型 AI 服务 · 翻译与摘要', exact: true }).click()
  await expect(page.locator('.settings-action-page').getByRole('heading', { name: 'AI 服务', exact: true })).toBeVisible()
  await expect(page.getByLabel('翻译模型', { exact:true })).toBeFocused()
  await page.getByRole('tab', { name: '字幕转录', exact: true }).click()
  await expect(page).toHaveURL(/#ai\/asr$/)
  await expect(page.getByRole('group', { name: '转录引擎' })).toBeVisible()
  await expect(desktopSearch).toHaveValue('')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tools')
  const mobileNavigation = page.getByRole('navigation', { name: '设置目录', exact: true }).last()
  await expect(mobileNavigation).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索设置', exact: true }).fill('备份')
  await expect(mobileNavigation).toBeHidden()
  await page.getByRole('button', { name: '备份目标 数据与备份', exact: true }).click()
  await expect(page.locator('.settings-action-page').getByRole('heading', { name: '数据与备份', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#data$/)
  await page.getByRole('button', { name: '返回设置列表', exact: true }).click()
  await expect(mobileNavigation).toBeVisible()
  await expect(page.getByRole('heading', { name:'设置', exact:true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('legacy settings hashes open their consolidated sections', async ({ page }) => {
  await page.goto('/tools#translation')
  await expect(page.locator('.settings-action-page').getByRole('heading', { name: 'AI 服务', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: '翻译与摘要' })).toHaveAttribute('aria-selected', 'true')
  await page.goto('/tools#ai/prompts')
  await expect(page).toHaveURL(/#ai\/text$/)
  await expect(page.getByRole('tab', { name:'提示词', exact:true })).toHaveCount(0)

  await page.goto('/tools#data-storage')
  await expect(page.locator('.settings-action-page').getByRole('heading', { name: '数据与备份', exact: true })).toBeVisible()
  await expect(page.locator('#settings-storage')).toBeVisible()

  await page.goto('/tools#data-backup')
  await expect(page.locator('#settings-backup')).toBeVisible()
  await page.goto('/tools#about')
  await expect(page.locator('.settings-action-page').getByRole('heading', { name: '组件与更新', exact: true })).toBeVisible()
})

test('inactive transcription settings stop model polling and resume when reopened', async ({ page }) => {
  let modelReads = 0
  await page.route('**/api/transcription/models', async route => {
    modelReads++
    await route.fulfill({ json: { models: [], available: true, job: { id: 'fixture-job', modelId: 'fixture-model', state: 'fetching' } } })
  })
  await page.goto('/tools#overview')
  await expect(page.locator('.settings-action-page').getByRole('heading', { name: '概览', exact: true })).toBeVisible()
  expect(modelReads).toBe(0)

  await page.getByRole('navigation', { name: '设置目录', exact: true }).getByRole('button', { name: 'AI 服务', exact: true }).click()
  await page.getByRole('tab', { name: '字幕转录', exact: true }).click()
  await expect.poll(() => modelReads).toBe(1)
  await page.getByRole('navigation', { name: '设置目录', exact: true }).getByRole('button', { name: '平台账号', exact: true }).click()
  await page.waitForTimeout(3300)
  expect(modelReads).toBe(1)

  await page.getByRole('navigation', { name: '设置目录', exact: true }).getByRole('button', { name: 'AI 服务', exact: true }).click()
  await page.getByRole('tab', { name: '字幕转录', exact: true }).click()
  await expect.poll(() => modelReads).toBe(2)
  await expect.poll(() => modelReads, { timeout: 5000 }).toBeGreaterThan(2)
})

test('navigation replaces the active page without stacking titles', async ({ page }) => {
  await page.goto('/')
  const mainNav = page.getByRole('navigation', { name: '主导航', exact: true })
  for (const title of ['收藏', '订阅管理', '笔记', '收藏']) {
    await mainNav.getByRole('button', { name: title, exact: true }).click()
    await expect(page.locator('h1:visible')).toHaveCount(1)
    await expect(page.locator('h1:visible')).toHaveText(title)
    await expect(page.getByRole('status').filter({ hasText: '正在打开页面…' })).toHaveCount(0)
  }
  await page.goBack()
  await expect(page.locator('h1:visible')).toHaveCount(1)
  await expect(page.locator('h1:visible')).toHaveText('笔记')
})

test('black and white themes, reduced motion and keyboard drawer are accessible', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.getByRole('button', { name: '切换深色模式' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '菜单', exact: true }).focus()
  await page.keyboard.press('Enter')
  const drawer = page.getByRole('dialog', { name: '导航菜单' })
  await expect(drawer).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.keyboard.press('Escape')
  await expect(drawer).not.toBeVisible()
  await expect(page.getByRole('button', { name: '菜单', exact: true })).toBeFocused()
})

test('download submits through real API, persists, serves a file and can be cancelled', async ({ page, request }) => {
  await page.goto('/downloads')
  await expect(page.getByRole('heading', { name: '下载资料库', exact: true })).toBeVisible()
  await page.getByLabel('下载视频地址').fill('BV17x411w7KC')
  await page.getByRole('button', { name: '获取信息', exact: true }).click()
  await expect(page.getByRole('button', { name: '开始下载' })).toBeEnabled()
  await page.getByRole('button', { name: '开始下载' }).click()
  await expect(page.getByRole('link', { name: '保存文件' }).first()).toBeVisible({ timeout: 10000 })
  const href = await page.getByRole('link', { name: '保存文件' }).first().getAttribute('href')
  const file = await request.get(href!)
  expect(file.status()).toBe(200)
  expect(file.headers()['content-disposition']).toContain('attachment')
  expect(await file.text()).toContain('explicit e2e test fixture')
  await page.reload()
  await expect(page.getByRole('link', { name: '保存文件' }).first()).toBeVisible()
  await page.getByLabel('下载视频地址').fill('BVcancel0000')
  await page.getByRole('button', { name: '获取信息', exact: true }).click()
  await page.getByRole('button', { name: '开始下载' }).click()
  await page.getByRole('button', { name: '取消下载 BVcancel0000' }).first().click()
  await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'BVcancel0000', exact: true }) }).getByRole('button', { name: '重新下载', exact: true }).first()).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('download failure stays visible and tool settings report actual configured status', async ({ page }) => {
  await page.goto('/downloads')
  await page.getByLabel('下载视频地址').fill('BVfailed0000')
  await page.getByRole('button', { name: '获取信息', exact: true }).click()
  await expect(page.getByText('平台限制了下载请求', { exact: false }).first()).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: '工具设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: '设置目录' }).getByRole('button', { name: '组件与更新', exact: true }).click()
  await expect(page.locator('[data-setting="download-tools"] .settings-status-chip[data-tone="positive"]').first()).toBeVisible()
  const violations = await new AxeBuilder({ page }).analyze()
  expect(violations.violations.filter(item => !['landmark-main-is-top-level', 'landmark-no-duplicate-main', 'landmark-unique'].includes(item.id))).toEqual([])
})

test('browse, preview, save, reload and unsave use actual storage', async ({ page, request }) => {
  await page.route('**/api/discovery/bilibili?**', route => route.fulfill({ json: { items: [fixture], page: 1, total: 1, hasMore: false, sourceTitle: fixture.author, query: '12345' } }))
  await page.goto('/search')
  await page.getByLabel('UP 主 UID 或视频地址').fill('12345')
  await page.getByRole('button', { name: '获取内容' }).click()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(1)
  expect((await (await request.get('/api/library')).json()).items).toHaveLength(0)
  await page.getByRole('button', { name: `阅读 ${fixture.title}` }).click()
  await expect(page.locator('.immersive-reader')).toBeVisible()
  const dialog = page.locator('.immersive-reader')
  await expect(dialog.getByRole('link', { name: '打开原视频' })).toHaveAttribute('href', fixture.url)
  await expect(dialog.getByRole('link', { name: '打开原视频' })).toHaveAttribute('target', '_blank')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await dialog.getByRole('button', { name: '收藏内容' }).click()
  await expect(dialog.getByRole('button', { name: '取消收藏内容', exact: true })).toHaveAttribute('aria-pressed','true')
  await page.getByRole('button', { name: '返回列表', exact: true }).click()
  await expect(page.locator('.immersive-reader')).toHaveCount(0)
  await expect(page.getByRole('button', { name: `阅读 ${fixture.title}` })).toBeFocused()
  await page.getByLabel('搜索当前列表').fill('好奇心')
  await page.getByRole('button', { name: '收藏', exact: true }).click()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(1)
  await page.getByRole('button', { name: `取消收藏 ${fixture.title}` }).click()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(0)
  expect((await (await request.get('/api/library')).json()).items).toHaveLength(0)
  await page.goBack()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(1)
})

test('existing subtitles load only on demand, search, switch language and export without media jobs', async ({ page, request }) => {
  let captionRequests = 0
  await page.route('**/api/subtitles/bilibili?**', route => {
    captionRequests++
    return route.fulfill({ json: {
      videoId: fixture.platformId,
      part: 1,
      status: 'available',
      tracks: [
        { language: 'ai-zh', label: '简体中文', automatic: true, source: 'ai', cues: [
          { start: 1.25, end: 4, text: '第一段测试字幕：好奇心。' },
          { start: 5, end: 8.5, text: '第二段测试字幕：继续发现。' },
          { start: 9, end: 11, text: '<script>这只是字幕文本</script>' },
        ] },
        { language: 'en', label: 'English', automatic: true, cues: [
          { start: 1.25, end: 4, text: 'English subtitle fixture.' },
        ] },
      ],
      languages: [
        { language: 'ai-zh', label: '简体中文', automatic: true, source: 'ai', hasUrl: true },
        { language: 'en', label: 'English', automatic: true, hasUrl: true },
      ],
    } })
  })
  await page.route('**/api/discovery/bilibili?**', route => route.fulfill({ json: { items: [fixture], page: 1, total: 1, hasMore: false, sourceTitle: fixture.author, query: fixture.platformId } }))
  const beforeJobs = (await (await request.get('/api/downloads')).json()).jobs
  await page.goto('/search')
  await page.getByLabel('UP 主 UID 或视频地址').fill(fixture.platformId)
  await page.getByRole('button', { name: '获取内容' }).click()
  await page.getByRole('button', { name: `阅读 ${fixture.title}` }).click()
  await expect(page.locator('.immersive-reader')).toBeVisible()
  await expect(page.getByRole('heading', { name: fixture.title, exact: true })).toBeVisible()
  await expect(page.locator('.preview-dialog')).toHaveCount(0)
  await expect(page.getByRole('list', { name: '字幕段落' }).getByRole('listitem')).toHaveCount(3)
  expect(captionRequests).toBe(1)
  await seekRealPlayback(page)
  await expect(page.getByText('<script>这只是字幕文本</script>', { exact: true })).toBeVisible()
  expect(await page.locator('.subtitle-reader script').count()).toBe(0)
  await closeSubtitleOptions(page)
  await page.getByLabel('搜索字幕').fill('好奇心')
  await expect(page.getByRole('list', { name: '字幕段落' }).getByRole('listitem')).toHaveCount(1)
  await expect(page.getByText('匹配 1 / 3 段', { exact: false })).toBeVisible()
  const downloadEvent = page.waitForEvent('download')
  await openSubtitleOptions(page)
  await page.getByRole('button', { name: '导出 SRT' }).click()
  const exported = await downloadEvent
  expect(exported.suggestedFilename()).toBe(`${fixture.platformId}.p1.ai-zh.srt`)
  const text = await readFile((await exported.path())!, 'utf8')
  expect(text).toContain('00:00:01,250 --> 00:00:04,000')
  expect(text).toContain('第二段测试字幕') // Export the full track even when the visible list is filtered.
  await closeSubtitleOptions(page)
  await page.getByLabel('搜索字幕').fill('')
  await closeSubtitleOptions(page)
  await page.getByLabel('字幕语言', { exact: true }).selectOption('en')
  await expect(page.getByText('English subtitle fixture.', { exact: true })).toBeVisible()
  expect(captionRequests).toBe(1)
  expect((await (await request.get('/api/downloads')).json()).jobs).toEqual(beforeJobs)
  expect((await (await request.get('/api/library')).json()).items).toEqual([])
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('group', { name: '阅读区域' }).getByRole('button', { name: '字幕', exact: true }).click()
  await closeSubtitleOptions(page)
  const visibleReader = page.locator('.subtitle-reader:visible')
  const visibleLanguage = visibleReader.getByLabel('字幕语言', { exact: true })
  await expect(visibleLanguage).toBeVisible()
  await visibleLanguage.selectOption('ai-zh')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.locator('.subtitle-reader').scrollIntoViewIfNeeded()
  // Reading actions scroll away with the page instead of covering the transcript.
  await expect(page.getByRole('button', { name: '返回列表' })).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.getByRole('button', { name: '返回列表' }).scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: '返回列表' }).click()
  await expect(page.getByRole('button', { name: `阅读 ${fixture.title}` })).toBeFocused()
})

test('no captions, login requirement and platform failure stay distinct', async ({ page }) => {
  await page.route('**/api/discovery/bilibili?**', route => {
    const id = new URL(route.request().url()).searchParams.get('q')!
    return route.fulfill({ json: { items: [{ ...fixture, id: `bilibili:${id}`, platformId: id, url: `https://www.bilibili.com/video/${id}/` }], page: 1, total: 1, hasMore: false, sourceTitle: fixture.author, query: id } })
  })
  await page.route('**/api/subtitles/bilibili?**', route => {
    const id = new URL(route.request().url()).searchParams.get('q')!
    const document = id === 'BVnone000000'
      ? { videoId: id, part: 1, status: 'none', tracks: [] }
      : id === 'BVlogin00000'
        ? { videoId: id, part: 1, status: 'login_required', tracks: [] }
        : { videoId: id, part: 1, status: 'error', errorCode: 412, errorMessage: '字幕未能完整获取 · E2E 测试夹具', tracks: [] }
    return route.fulfill({ json: document })
  })
  await page.goto('/search')
  for (const [id, message] of [
    ['BVnone000000', '第一分 P 暂无可用字幕，可以按需转录。'],
    ['BVlogin00000', 'B站提示读取字幕需要登录'],
    ['BVfailed0000', '字幕未能完整获取'],
  ]) {
    await page.getByLabel('UP 主 UID 或视频地址').fill(id)
    await page.getByRole('button', { name: '获取内容' }).click()
    await page.getByRole('button', { name: `阅读 ${fixture.title}` }).click()
    const messageLocator = id === 'BVlogin00000'
      ? page.locator('.subtitle-empty').getByText(message, { exact: false })
      : id === 'BVfailed0000'
        ? page.getByRole('alert').getByText(message, { exact: false })
        : page.locator('.subtitle-note').getByText(message, { exact: false })
    await expect(messageLocator).toBeVisible()
    await expect(page.getByRole('list', { name: '字幕段落' })).toHaveCount(0)
    if (id === 'BVfailed0000') await expect(page.getByRole('alert')).toContainText('字幕未能完整获取')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await page.getByRole('button', { name: '返回列表' }).click()
  }
})

test('long subtitles search the full track and cancellation returns to an explicit action', async ({ page }) => {
  await page.route('**/api/discovery/bilibili?**', route => {
    const id = new URL(route.request().url()).searchParams.get('q')!
    return route.fulfill({ json: { items: [{ ...fixture, id: `bilibili:${id}`, platformId: id, url: `https://www.bilibili.com/video/${id}/` }], page: 1, total: 1, hasMore: false, sourceTitle: fixture.author, query: id } })
  })
  await page.goto('/search')
  await page.getByLabel('UP 主 UID 或视频地址').fill('BVlong000000')
  await page.getByRole('button', { name: '获取内容' }).click()
  await page.getByRole('button', { name: `阅读 ${fixture.title}` }).click()
  const lines = page.getByRole('list', { name: '字幕段落' }).getByRole('listitem')
  await expect(lines).toHaveCount(200)
  await closeSubtitleOptions(page)
  await page.getByLabel('搜索字幕').fill('第249段')
  await expect(lines).toHaveCount(1)
  await expect(lines.first()).toContainText('第249段长字幕测试')
  await closeSubtitleOptions(page)
  await page.getByLabel('搜索字幕').fill('')
  await page.getByRole('button', { name: '继续阅读字幕', exact: false }).click()
  await expect(lines).toHaveCount(250)
  await page.getByRole('button', { name: '返回列表' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '返回列表' })).toBeInViewport()
  await page.getByRole('button', { name: '返回列表' }).click()
  await page.getByLabel('UP 主 UID 或视频地址').fill('BVcancel0000')
  await page.getByRole('button', { name: '获取内容' }).click()
  await page.getByRole('button', { name: `阅读 ${fixture.title}` }).click()
  await expect(page.getByText('正在获取已有字幕…')).toBeVisible()
  await openSubtitleSettings(page, 'source')
  await page.getByRole('button', { name: '取消获取' }).click()
  await expect(page.getByRole('button', { name: '读取字幕', exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: '字幕段落' })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: '返回列表' }).click()
  await expect(page.getByRole('heading', { name: '添加内容', exact: true })).toBeVisible()
})

test('reader direct URLs load metadata, survive reload, and reject invalid identifiers', async ({ page }) => {
  let metadataRequests = 0
  await page.route('**/api/discovery/bilibili?**', route => {
    metadataRequests++
    return route.fulfill({ json: { items: [fixture], page: 1, total: 1, hasMore: false, sourceTitle: fixture.author, query: fixture.platformId } })
  })
  await page.goto(`/reader?video=${fixture.platformId}`)
  await expect(page.getByRole('list', { name: '字幕段落' })).toBeVisible()
  expect(metadataRequests).toBe(1)
  await page.reload()
  await expect(page.getByRole('list', { name: '字幕段落' })).toBeVisible()
  expect(metadataRequests).toBe(2)
  await page.goto('/reader?video=12345')
  await expect(page.getByRole('alert')).toContainText('阅读地址缺少正确的视频 BV 号')
  expect(metadataRequests).toBe(2)
  await page.getByRole('button', { name: '返回列表' }).click()
  await expect(page.getByRole('heading', { name: '发现', exact: true })).toBeVisible()
})

test('platform error is shown, not mistaken for a successful empty feed', async ({ page }) => {
  await page.route('**/api/discovery/bilibili?**', route => route.fulfill({ status: 429, json: { code: 'platform_restricted', message: '测试平台限制：请等待一分钟后重试。' } }))
  await page.goto('/search')
  await page.getByLabel('UP 主 UID 或视频地址').fill('12345')
  await page.getByRole('button', { name: '获取内容' }).click()
  await expect(page.getByRole('alert')).toContainText('测试平台限制')
  await expect(page.getByRole('heading', { name: '这位创作者暂时没有可见投稿' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible()
})

test('failed save stays unsaved and reports the error inside the reader', async ({ page, request }) => {
  await page.route('**/api/discovery/bilibili?**', route => route.fulfill({ json: { items: [fixture], page: 1, total: 1, hasMore: false, sourceTitle: fixture.author, query: '12345' } }))
  await page.route('**/api/library', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 500, json: { code: 'internal_error', message: '测试写入失败，收藏没有保存。' } })
    : route.continue())
  await page.goto('/search')
  await page.getByLabel('UP 主 UID 或视频地址').fill('12345')
  await page.getByRole('button', { name: '获取内容' }).click()
  await page.getByRole('button', { name: `阅读 ${fixture.title}` }).click()
  const dialog = page.locator('.immersive-reader')
  await dialog.getByRole('button', { name: '收藏内容' }).click()
  await expect(dialog.locator('.reader-read-state').getByRole('alert')).toContainText('测试写入失败')
  await expect(dialog.getByRole('button', { name: '收藏内容' })).toBeEnabled()
  expect((await (await request.get('/api/library')).json()).items).toHaveLength(0)
})

test('pagination deduplicates and direct reader preserves scroll and search filter', async ({ page }) => {
  const items = Array.from({ length: 24 }, (_, i) => ({ ...fixture, id: `bilibili:test${i}`, platformId: `test${i}`, title: `浏览器测试视频 ${i + 1}` }))
  await page.route('**/api/discovery/bilibili?**', route => {
    const second = new URL(route.request().url()).searchParams.get('page') === '2'
    return route.fulfill({ json: { items: second ? [items[0], { ...fixture, id: 'bilibili:last', title: '浏览器测试视频 25' }] : items, page: second ? 2 : 1, total: 25, hasMore: !second, sourceTitle: fixture.author, query: '12345' } })
  })
  await page.goto('/search')
  await page.getByLabel('UP 主 UID 或视频地址').fill('12345')
  await page.getByRole('button', { name: '获取内容' }).click()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(24)
  await page.getByRole('button', { name: '继续浏览' }).click()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(25)
  await page.getByLabel('搜索当前列表').fill('视频')
  await page.getByRole('button', { name: '阅读 浏览器测试视频 20', exact: true }).click()
  await page.getByRole('button', { name: '返回列表', exact: true }).click()
  const scroll = await page.evaluate(() => scrollY)
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(scroll)
  await page.getByRole('button', { name: '收藏', exact: true }).click()
  await expect(page.getByLabel('搜索当前列表')).toHaveValue('')
  await page.goBack()
  await expect(page.getByLabel('搜索当前列表')).toHaveValue('视频')
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(25)
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(scroll)
  await page.getByRole('button', { name: '阅读 浏览器测试视频 25', exact: true }).scrollIntoViewIfNeeded()
  const readingScroll = await page.evaluate(() => scrollY)
  await page.getByRole('button', { name: '阅读 浏览器测试视频 25', exact: true }).click()
  await expect(page.getByRole('list', { name: '字幕段落' })).toBeVisible()
  await page.goBack()
  await expect(page.getByLabel('搜索当前列表')).toHaveValue('视频')
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(25)
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(readingScroll)
  await expect(page.getByRole('button', { name: '阅读 浏览器测试视频 25', exact: true })).toBeFocused()
})

test('retrying a failed next page retains the previously loaded results', async ({ page }) => {
  let firstPageRequests = 0
  let secondPageRequests = 0
  await page.route('**/api/discovery/bilibili?**', route => {
    const second = new URL(route.request().url()).searchParams.get('page') === '2'
    if (!second) firstPageRequests++
    else secondPageRequests++
    if (second && secondPageRequests === 1) return route.fulfill({ status: 502, json: { code: 'platform_unavailable', message: '测试下一页暂时不可用。' } })
    return route.fulfill({ json: { items: second ? [{ ...fixture, id: 'bilibili:second', title: '测试第二页视频' }] : [fixture], page: second ? 2 : 1, total: 2, hasMore: !second, sourceTitle: fixture.author, query: '12345' } })
  })
  await page.goto('/search')
  await page.getByLabel('UP 主 UID 或视频地址').fill('12345')
  await page.getByRole('button', { name: '获取内容' }).click()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(1)
  await page.getByRole('button', { name: '继续浏览' }).click()
  await expect(page.getByRole('alert')).toContainText('测试下一页暂时不可用')
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(1)
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.locator('[data-testid="content-card"]:visible')).toHaveCount(2)
  expect(firstPageRequests).toBe(1)
  expect(secondPageRequests).toBe(2)
})
