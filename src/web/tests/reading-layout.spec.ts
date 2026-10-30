import { expect, test } from './e2e'
import type { ContentItem } from '../src/shared/api/types'

const video: ContentItem = {
  id: 'bilibili:BV17x411w7KC', platform: 'bilibili', platformId: 'BV17x411w7KC', kind: 'video',
  title: '浏览器测试样例：沿着好奇心继续发现', author: '测试创作者', authorId: '12345',
  url: 'https://www.bilibili.com/video/BV17x411w7KC/', thumbnailUrl: '',
  description: '用于验证阅读与卡片布局的测试内容。', durationSeconds: 123, publishedAt: 1720000000,
}
const article: ContentItem = {
  ...video, id: `rss:${'a'.repeat(64)}`, platform: 'rss', platformId: 'a'.repeat(64), kind: 'article',
  title: '另一篇订阅文章', author: '订阅作者', authorId: '', url: 'https://example.com/reading-layout',
  durationSeconds: 0,
}

test.beforeEach(async ({ request }) => {
  const { items } = await (await request.get('/api/library')).json()
  for (const item of items) expect((await request.delete(`/api/library/${encodeURIComponent(item.id)}`)).ok()).toBe(true)
})

test('library and history share a compact header while search and mixed content remain usable', async ({ page, request }) => {
  for (const item of [video, article]) expect((await request.post('/api/library', { data: item })).ok()).toBe(true)
  expect((await request.post('/api/history/viewing', { data: { entries: [video, article].map(item => ({ item, openedAt: Date.now() })) } })).ok()).toBe(true)
  await page.setViewportSize({ width: 1844, height: 1098 })
  await page.goto('/library')
  const header = page.locator('.experience-topbar')
  await expect(header.getByRole('heading', { name: '收藏', exact: true })).toBeVisible()
  await expect(page.getByTestId('content-card')).toHaveCount(2)
  await expect(page.getByRole('group', { name: '媒体类型' })).toHaveCount(0)
  await expect(page.getByLabel('按播放进度筛选')).toHaveCount(0)
  await expect(page.getByLabel('内容排序')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '添加内容', exact: true })).toHaveCount(1)
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(64)
  await header.getByRole('searchbox', { name: '搜索当前列表' }).fill('订阅文章')
  await expect(page.getByTestId('content-card')).toHaveCount(1)
  await header.getByRole('searchbox', { name: '搜索当前列表' }).fill('')
  await header.getByRole('button', { name: '列表布局' }).click()
  await expect(page.locator('.content-collection')).toHaveClass(/list-layout/)
  await header.getByRole('button', { name: '画廊布局' }).click()
  await page.goto('/history')
  await expect(header.getByRole('heading', { name: '历史', exact: true })).toBeVisible()
  await expect(header).toContainText('2 条记录')
  await expect(page.getByTestId('content-card')).toHaveCount(2)
  await expect(page.getByRole('group', { name: '媒体类型' })).toHaveCount(0)
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(64)
  await header.getByRole('searchbox', { name: '搜索历史' }).fill('订阅文章')
  await expect(page.getByTestId('content-card')).toHaveCount(1)
  await header.getByRole('button', { name: '清空历史', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect((await (await request.get('/api/history/viewing')).json()).entries).toHaveLength(2)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(header.getByRole('searchbox', { name: '搜索历史' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.goto('/library')
  await expect(header.getByRole('searchbox', { name: '搜索当前列表' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('reader read state stays changed and saving does not add extra toolbar buttons', async ({ page, request }) => {
  expect((await request.post('/api/library', { data: video })).ok()).toBe(true)
  expect((await request.put('/api/read-state', { data: { contentIds: [video.id], read: false } })).ok()).toBe(true)
  await page.setViewportSize({ width: 1844, height: 1098 })
  await page.goto(`/reader?video=${video.platformId}`)
  const actions = page.locator('.reader-read-state')
  const unread = actions.getByRole('button', { name: '标为未读', exact: true })
  await expect(unread).toHaveAttribute('aria-pressed', 'true')
  await expect(unread).toBeEnabled()
  await unread.click()
  const read = actions.getByRole('button', { name: '标为已读', exact: true })
  await expect(read).toHaveAttribute('aria-pressed', 'false')
  await expect(read).toBeEnabled()
  expect((await (await request.get('/api/read-state?contentId=' + encodeURIComponent(video.id))).json()).states[0].read).toBe(false)
  const count = await actions.getByRole('button').count()
  await actions.getByRole('button', { name: '取消收藏内容', exact: true }).click()
  await expect(actions.getByRole('button', { name: '收藏内容', exact: true })).toBeEnabled()
  await actions.getByRole('button', { name: '收藏内容', exact: true }).click()
  await expect(actions.getByRole('button', { name: '取消收藏内容', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(actions.getByRole('button')).toHaveCount(count)
  await expect(actions.locator('.toolbar-popover-success')).toHaveCount(0)
  await expect(read).toHaveAttribute('aria-pressed', 'false')
  const title = await page.locator('.reading-nav-title h1').boundingBox()
  const metadata = await page.locator('.reading-nav-title .reading-meta').boundingBox()
  expect(title && metadata).toBeTruthy()
  expect(Math.abs(title!.y + title!.height / 2 - metadata!.y - metadata!.height / 2)).toBeLessThan(3)
})

test('subtitle tools sit above the text, open one task at a time and keep saved progress above the player', async ({ page, request }) => {
  expect((await request.post('/api/library', { data: video })).ok()).toBe(true)
  const previous = (await (await request.get('/api/reading-progress?contentId=' + encodeURIComponent(video.id))).json()).progress
  expect((await request.put('/api/reading-progress/' + encodeURIComponent(video.id), { data: { positionSeconds: 17, durationSeconds: 123, revision: previous?.revision ?? 0 } })).ok()).toBe(true)
  await page.setViewportSize({ width: 1844, height: 1098 })
  await page.goto(`/reader?video=${video.platformId}`)
  const progress = page.getByRole('region', { name: '阅读进度' })
  await expect(progress).toContainText('00:17')
  expect((await progress.boundingBox())!.y).toBeLessThan((await page.locator('.online-player').boundingBox())!.y)
  const reader = page.getByRole('region', { name: '字幕与阅读' })
  const panels = reader.locator('.subtitle-inline-panel:visible')
  const source = reader.getByRole('region', { name: '字幕来源与保存', exact: true })
  const exporting = reader.getByRole('region', { name: '导出字幕与文稿', exact: true })
  const cues = page.getByRole('list', { name: '字幕段落' })
  await expect(cues).toBeVisible()
  await expect(panels).toHaveCount(0)
  await expect(page.getByRole('button', { name: '字幕设置', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('字幕语言', { exact: true })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索字幕', exact: true })).toBeVisible()
  const toolbar = await reader.locator('.subtitle-workbar').boundingBox()
  expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual((await cues.boundingBox())!.y)
  await reader.getByRole('button', { name: '字幕来源与保存', exact: true }).click()
  await expect(source).toBeVisible()
  await expect(panels).toHaveCount(1)
  await expect(source.getByLabel('读取字幕来源')).toBeVisible()
  expect((await source.boundingBox())!.height).toBeLessThanOrEqual(56)
  await expect(source.locator('.subtitle-source-details')).toBeHidden()
  await source.getByRole('button', { name: '字幕来源详情', exact: true }).click()
  await expect(source.locator('.subtitle-source-details')).toBeVisible()
  await reader.getByRole('button', { name: '导出字幕与文稿', exact: true }).click()
  await expect(source).toBeHidden()
  await expect(exporting).toBeVisible()
  await expect(panels).toHaveCount(1)
  await expect(exporting.getByRole('button', { name: '导出 SRT', exact: true })).toBeVisible()
  await exporting.getByLabel('导出文件格式').selectOption('markdown')
  await expect(exporting.getByRole('button', { name: '导出文稿', exact: true })).toBeVisible()
  expect((await cues.boundingBox())!.y).toBeGreaterThanOrEqual((await exporting.boundingBox())!.y + (await exporting.boundingBox())!.height)
  await exporting.getByRole('button', { name: '关闭字幕导出' }).click()
  await expect(panels).toHaveCount(0)
  await expect(reader.getByRole('button', { name: '导出字幕与文稿', exact: true })).toBeFocused()
  await reader.getByRole('button', { name: '转录', exact: true }).click()
  const transcribing = reader.getByRole('region', { name: '转录字幕', exact: true })
  await expect(transcribing.getByRole('button', { name: '开始转录视频', exact: true })).toBeVisible()
  expect((await transcribing.locator('.podcast-transcription-tools').boundingBox())!.height).toBeLessThanOrEqual(36)
  await transcribing.getByRole('button', { name: '关闭字幕转录' }).press('Escape')
  await expect(panels).toHaveCount(0)
  await expect(reader.getByRole('button', { name: '转录', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '文章', exact: true }).click()
  await expect(cues).toHaveClass(/subtitle-article-mode/)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('group', { name: '阅读区域', exact: true }).getByRole('button', { name: '字幕', exact: true }).click()
  await expect(page.getByLabel('字幕语言', { exact: true })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索字幕', exact: true })).toBeVisible()
  await reader.getByRole('button', { name: '导出字幕与文稿', exact: true }).click()
  await expect(exporting.getByRole('button', { name: '导出文稿', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('manual transcription stays hidden while subtitles are being fetched', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let requested = false
  await page.route('**/api/subtitles/youtube?**', async route => {
    requested = true
    await pending
    await route.fulfill({ json: { videoId: 'Nocaps00002', part: 1, status: 'none', tracks: [] } })
  })
  await page.goto('/reader?contentId=youtube%3ANocaps00002')
  await expect.poll(() => requested).toBe(true)
  await expect(page.getByText('正在获取已有字幕…', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '转录字幕', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: '开始转录视频', exact: true })).toBeHidden()
  release()
  await expect(page.getByRole('region', { name: '转录字幕', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始转录视频', exact: true })).toBeVisible()
})

test('source warnings stay inline, native options follow the theme and dismissed confirmations preserve saved subtitles', async ({ page, request }) => {
  const item = { ...video, id: 'bilibili:BVsource0000', platformId: 'BVsource0000' }
  const track = { language: 'zh-Hans', label: '中文', source: 'ai', automatic: true, mismatch: true, cues: [{ start: 0, end: 4, text: '需要核对的字幕内容。' }] }
  expect((await request.post('/api/library', { data: item })).ok()).toBe(true)
  expect((await request.put(`/api/saved-subtitles/${encodeURIComponent(item.id)}/zh-Hans`, { data: { track, revision: 0 } })).ok()).toBe(true)
  await page.route('**/api/subtitles/bilibili?**', route => route.fulfill({ json: { videoId: item.platformId, part: 1, status: 'available', tracks: [track] } }))
  await page.setViewportSize({ width: 1844, height: 1098 })
  await page.goto(`/reader?video=${item.platformId}`)
  const reader = page.getByRole('region', { name: '字幕与阅读', exact: true })
  await expect(reader.getByRole('list', { name: '字幕段落' })).toContainText(track.cues[0].text)
  const baseline = await (await request.get('/api/saved-subtitles?contentId=' + encodeURIComponent(item.id))).json()
  const source = reader.getByRole('region', { name: '字幕来源与保存', exact: true })
  await reader.getByRole('button', { name: '字幕来源与保存', exact: true }).click()
  await expect(source.locator('.subtitle-source-warning')).toContainText('字幕疑似不符')
  expect((await source.boundingBox())!.height).toBeLessThanOrEqual(56)
  const warning = (await source.locator('.subtitle-source-warning').boundingBox())!
  const select = (await source.getByLabel('读取字幕来源').boundingBox())!
  expect(Math.abs(warning.y + warning.height / 2 - select.y - select.height / 2)).toBeLessThan(2)
  await source.getByRole('button', { name: '移除此语言的本机字幕', exact: true }).click()
  await expect(source.getByRole('button', { name: '确认移除字幕', exact: true })).toBeVisible()
  await reader.getByRole('button', { name: '导出字幕与文稿', exact: true }).click()
  await reader.getByRole('button', { name: '字幕来源与保存', exact: true }).click()
  await expect(source.getByRole('button', { name: '确认移除字幕', exact: true })).toHaveCount(0)
  await source.getByLabel('读取字幕来源').selectOption('platform')
  await source.getByRole('button', { name: '保存此语言到本机', exact: true }).click()
  await expect(source.getByRole('button', { name: '确认覆盖字幕', exact: true })).toBeVisible()
  await source.getByRole('button', { name: '关闭字幕来源', exact: true }).click()
  expect(await (await request.get('/api/saved-subtitles?contentId=' + encodeURIComponent(item.id))).json()).toEqual(baseline)
  for (const theme of ['dark', 'light']) {
    await page.goto('/')
    const switcher = page.getByRole('button', { name: theme === 'dark' ? '切换深色模式' : '切换浅色模式', exact: true })
    await switcher.click()
    await page.goto(`/reader?video=${item.platformId}`)
    await expect(reader.getByLabel('字幕语言', { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const colors = await reader.getByLabel('字幕语言', { exact: true }).evaluate(el => {
      const option = getComputedStyle(el.querySelector('option')!)
      const root = getComputedStyle(document.documentElement)
      return { color: option.color, background: option.backgroundColor, ink: root.getPropertyValue('--ink').trim(), card: root.getPropertyValue('--card').trim(), scheme: getComputedStyle(el).colorScheme }
    })
    expect(colors.scheme).toBe(theme)
    expect(colors.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(colors.color).not.toBe(colors.background)
    expect(await reader.getByLabel('字幕语言', { exact: true }).evaluate(el => {
      const option = getComputedStyle(el.querySelector('option')!)
      return option.color === getComputedStyle(el).color
    })).toBe(true)
  }
})

test('focus mode centers a stable player and aligns the transcript across desktop heights', async ({ page, request }) => {
  expect((await request.post('/api/library', { data: video })).ok()).toBe(true)
  await page.setViewportSize({ width: 1844, height: 1098 })
  await page.goto(`/reader?video=${video.platformId}`)
  const player = page.getByRole('region', { name: '在线播放', exact: true })
  await player.getByRole('button', { name: /^播放视频 / }).click()
  const media = page.getByLabel('B站在线视频播放器', { exact: true })
  await expect.poll(() => media.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2)
  const identity = await media.elementHandle()
  await media.evaluate((node: HTMLVideoElement) => { node.pause(); node.currentTime = 5 })
  await page.getByRole('button', { name: '专注模式', exact: true }).click()
  const transcript = page.getByRole('region', { name: '字幕与阅读', exact: true })
  for (const viewport of [{ width: 1844, height: 1098 }, { width: 1440, height: 700 }]) {
    await page.setViewportSize(viewport)
    await expect(transcript).toBeVisible()
    const columns = (await page.locator('.reading-columns').boundingBox())!
    const primary = (await page.locator('.reader-primary').boundingBox())!
    const screen = (await media.boundingBox())!
    const text = (await transcript.boundingBox())!
    expect(Math.abs(primary.x + primary.width / 2 - columns.x - columns.width / 2)).toBeLessThan(2)
    expect(Math.abs(screen.width / screen.height - 16 / 9)).toBeLessThan(.01)
    expect(screen.height).toBeGreaterThanOrEqual(viewport.height * .5)
    expect(screen.height).toBeLessThanOrEqual(viewport.height * .65)
    expect(Math.abs(screen.x - text.x)).toBeLessThan(2)
    expect(Math.abs(screen.width - text.width)).toBeLessThan(2)
    expect(text.y).toBeGreaterThan(screen.y + screen.height)
    expect(await identity!.evaluate(node => node.isConnected)).toBe(true)
    expect(await media.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(5, 2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  }
  await page.getByRole('button', { name: '退出专注', exact: true }).click()
  expect(await identity!.evaluate(node => node.isConnected)).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: '专注模式', exact: true })).toBeHidden()
  await page.getByRole('group', { name: '阅读区域', exact: true }).getByRole('button', { name: '字幕', exact: true }).click()
  await expect(transcript).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('excerpt range belongs to its cue, dismisses without changes and preserves surrounding source text', async ({ page, request }) => {
  const track = { language: 'zh-Hans', label: '中文', automatic: false, source: 'cc', cues: [
    { start: 0, end: 4, text: '第一句，交代前面的背景。' },
    { start: 5, end: 9, text: '第二句，需要摘录的重点。' },
    { start: 10, end: 14, text: '第三句，保留后面的解释。' },
  ] }
  await page.route('**/api/subtitles/bilibili?**', route => route.fulfill({ json: {
    videoId: video.platformId, part: 1, status: 'available', tracks: [track],
  } }))
  for (const { id } of (await (await request.get('/api/notes?contentId=' + encodeURIComponent(video.id))).json()).notes) {
    expect((await request.delete('/api/notes/' + id)).ok()).toBe(true)
  }
  for (const saved of (await (await request.get('/api/saved-subtitles?contentId=' + encodeURIComponent(video.id))).json()).tracks) {
    expect((await request.delete(`/api/saved-subtitles/${encodeURIComponent(video.id)}/${saved.track.language}?revision=${saved.revision}`)).ok()).toBe(true)
  }
  expect((await request.post('/api/library', { data: video })).ok()).toBe(true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/reader?video=${video.platformId}`)
  const cues = page.getByRole('list', { name: '字幕段落' })
  const row = cues.getByRole('listitem').nth(1)
  const trigger = row.getByRole('button', { name: '选择摘录范围 00:05', exact: true })
  const menu = page.locator('.subtitle-excerpt-menu:popover-open')
  await row.hover()
  await trigger.click()
  await expect(menu).toHaveCount(1)
  await menu.getByRole('button', { name: '本句', exact: true }).press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(page.getByLabel('笔记正文')).toHaveValue('')
  await trigger.click()
  await page.locator('.subtitle-workbar').click()
  await expect(menu).toHaveCount(0)
  await page.getByLabel('搜索字幕', { exact: true }).fill('第二句')
  const filtered = cues.getByRole('listitem')
  await expect(filtered).toHaveCount(1)
  await filtered.hover()
  await filtered.getByRole('button', { name: '选择摘录范围 00:05', exact: true }).click()
  const bounds = (await menu.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(900)
  await menu.getByRole('button', { name: '前后一句', exact: true }).click()
  await expect(menu).toHaveCount(0)
  const references = page.locator('#note-composer').getByLabel('字幕摘录', { exact: true })
  await expect(references).toContainText(track.cues.map(cue => cue.text).join(' '))
  await page.getByRole('button', { name: '保存摘录', exact: true }).click()
  const notes = (await (await request.get('/api/notes?contentId=' + encodeURIComponent(video.id))).json()).notes
  expect(notes).toHaveLength(1)
  expect(notes[0].subtitleReferences[0]).toMatchObject({ start: 0, end: 14, text: track.cues.map(cue => cue.text).join(' ') })
  await page.reload()
  await page.getByLabel('搜索字幕', { exact: true }).fill('第二句')
  await expect(cues.getByRole('button', { name: '摘录字幕原句 00:05', exact: true })).toHaveAttribute('title', '摘录前后一句到笔记')
})

test('discovery preferences toggle once, dismiss outside and never stack across cards', async ({ page }) => {
  const second = { ...video, id: 'bilibili:BV1Pyta66EDh', platformId: 'BV1Pyta66EDh', title: '第二张视频卡片', url: 'https://www.bilibili.com/video/BV1Pyta66EDh/' }
  await page.route('**/api/discovery/batch', route => route.fulfill({ json: {
    batchId: 'layout-fixture', items: [video, second].map(item => ({ item, source: 'bilibili', reason: 'B站推荐', carriedOver: false })),
    reason: '', hasNextBatch: false, sourceStatus: {},
  } }))
  await page.setViewportSize({ width: 1844, height: 1098 })
  await page.goto('/')
  const cards = page.getByTestId('content-card')
  await expect(cards).toHaveCount(2)
  const triggers = page.getByRole('button', { name: '调整发现偏好', exact: true })
  const open = page.locator('.discovery-feedback-popover:popover-open')
  await cards.nth(0).hover()
  await triggers.nth(0).click()
  await expect(open).toHaveCount(1)
  await triggers.nth(0).click()
  await expect(open).toHaveCount(0)
  await triggers.nth(0).click()
  await cards.nth(1).hover()
  await triggers.nth(1).click()
  await expect(open).toHaveCount(1)
  await expect(triggers.nth(0)).toHaveAttribute('aria-expanded', 'false')
  await expect(triggers.nth(1)).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(open).toHaveCount(0)
  await triggers.nth(1).click()
  await page.locator('.experience-location-title').click()
  await expect(open).toHaveCount(0)
  for (const width of [1844, 960, 390]) {
    await page.setViewportSize({ width, height: 1098 })
    const bounds = await cards.nth(0).evaluate(card => {
      const outer = card.getBoundingClientRect()
      const title = card.querySelector('.modern-card-title')!.getBoundingClientRect()
      const author = card.querySelector('.modern-card-author')!.getBoundingClientRect()
      return { outer: { left: outer.left, right: outer.right }, title: { left: title.left, right: title.right }, author: { left: author.left, right: author.right } }
    })
    expect(bounds.title.left).toBeGreaterThan(bounds.outer.left)
    expect(bounds.title.right).toBeLessThan(bounds.outer.right)
    expect(bounds.author.right).toBeLessThan(bounds.outer.right)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  }
})
