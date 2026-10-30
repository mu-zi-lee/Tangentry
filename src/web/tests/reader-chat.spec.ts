import { expect, test } from './e2e'
import type { ContentItem, SavedSubtitle, SubtitleTrack } from '../src/shared/api/types'

test('manual YouTube subtitles replace local captions, survive reopening and supply streamed chat and summaries', async ({ page, request }) => {
  const item: ContentItem = {
    id: 'youtube:N6FkmdL0Lg0', platform: 'youtube', platformId: 'N6FkmdL0Lg0', kind: 'video',
    title: 'How Factory is building autonomous software with Claude', author: 'Claude', authorId: '',
    url: 'https://www.youtube.com/watch?v=N6FkmdL0Lg0', thumbnailUrl: '', description: 'Description without selected captions',
    durationSeconds: 120, publishedAt: 1720000000,
  }
  const english: SubtitleTrack = { language: 'en', label: 'English', automatic: false, source: 'youtube', cues: [{ start: 0, end: 5, text: 'MANUALLY CHOSEN English captions for this conversation.' }] }
  const chinese: SubtitleTrack = { language: 'zh-Hans', label: '中文', automatic: true, source: 'youtube', translated: true, sourceLanguage: 'en', cues: [{ start: 0, end: 5, text: '自动选择的旧中文内容。' }] }
  const previous = { ...english, cues: [{ start: 0, end: 3, text: 'Old saved English captions.' }] }
  expect((await request.post('/api/library', { data: item })).ok()).toBe(true)
  expect((await request.put(`/api/saved-subtitles/${encodeURIComponent(item.id)}/en`, { data: { track: previous, revision: 0 } })).ok()).toBe(true)
  expect((await request.put(`/api/saved-subtitles/${encodeURIComponent(item.id)}/zh-Hans`, { data: { track: chinese, revision: 0 } })).ok()).toBe(true)
  const settings = await (await request.get('/api/ai/settings')).json()
  expect((await request.put('/api/ai/settings', { data: {
    baseUrl: 'https://ai-fixture.example/v1', model: 'fixture-reader-chat', enabledModels: ['fixture-reader-chat'],
    chatModel: 'fixture-reader-chat', key: '', revision: settings.revision,
  } })).ok()).toBe(true)
  await page.route('**/api/subtitles/youtube?**', route => route.fulfill({ json: { videoId: item.platformId, part: 1, status: 'available', languages: [chinese, english], tracks: [chinese, english] } }))
  await page.setViewportSize({ width: 1844, height: 1098 })
  await page.goto('/reader?contentId=' + encodeURIComponent(item.id))
  const cues = page.getByRole('list', { name: '字幕段落' })
  await expect(cues).toContainText(chinese.cues[0].text)
  await page.getByRole('button', { name: '字幕来源与保存', exact: true }).click()
  await page.getByLabel('读取字幕来源').selectOption('platform')
  await page.getByRole('button', { name: '关闭字幕来源', exact: true }).click()
  await page.getByLabel('字幕语言', { exact: true }).selectOption('en')
  await expect(cues).toContainText(english.cues[0].text)
  await expect.poll(async () => {
    const { tracks }: { tracks: SavedSubtitle[] } = await (await request.get('/api/saved-subtitles?contentId=' + encodeURIComponent(item.id))).json()
    return tracks.find(value => value.selected)?.track
  }).toEqual(english)
  await page.reload()
  await expect(page.getByLabel('字幕语言', { exact: true })).toHaveValue('en')
  await expect(cues).toContainText(english.cues[0].text)
  await expect(cues).not.toContainText(chinese.cues[0].text)
  await page.getByRole('group', { name: '阅读区域' }).getByRole('button', { name: 'AI 辅助', exact: true }).click()
  await page.getByRole('tab', { name: 'AI 对话', exact: true }).click()
  const chat = page.locator('.ai-chat-panel')
  await expect(chat.getByLabel('对话模型')).toHaveValue('fixture-reader-chat')
  const outgoing = page.waitForRequest(value => value.method() === 'POST' && value.url().endsWith('/api/ai/chat'))
  await chat.getByRole('button', { name: '这个讲了什么', exact: true }).click()
  const sent = await outgoing
  expect(new URL(sent.url()).search).toBe('')
  expect(sent.headers().accept).toBe('text/event-stream')
  expect(sent.postDataJSON().context).toContain(english.cues[0].text)
  expect(sent.postDataJSON().context).not.toContain(chinese.cues[0].text)
  await expect(chat.getByRole('article', { name: 'AI 回答' })).toContainText(english.cues[0].text)
  await expect(chat.getByRole('alert')).toHaveCount(0)
  await expect(chat.getByRole('button', { name: '复制回答' })).toBeVisible()
  await page.reload()
  await page.getByRole('group', { name: '阅读区域' }).getByRole('button', { name: 'AI 辅助', exact: true }).click()
  await page.getByRole('tab', { name: 'AI 对话', exact: true }).click()
  await expect(chat.getByRole('article', { name: 'AI 回答' })).toContainText(english.cues[0].text)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(chat.getByLabel('输入问题')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('reader title translates on click and toggles without a separate translation control', async ({ page, request }) => {
  const settings = await (await request.get('/api/ai/settings')).json()
  expect((await request.put('/api/ai/settings', { data: { baseUrl: 'https://ai-fixture.example/v1', model: 'fixture-title', key: '', revision: settings.revision } })).ok()).toBe(true)
  const id = 'youtube:TitleTest01'
  expect((await request.post('/api/library', { data: {
    id, platform: 'youtube', platformId: 'TitleTest01', kind: 'video',
    title: 'An original English title', author: 'Author', authorId: '', url: 'https://www.youtube.com/watch?v=TitleTest01', thumbnailUrl: '', description: '', durationSeconds: 10, publishedAt: 1720000000,
  } })).ok()).toBe(true)
  await page.goto('/reader?contentId=' + encodeURIComponent(id))
  const title = page.locator('.reading-nav-title h1')
  await expect(title.getByRole('button')).toBeEnabled()
  await title.getByRole('button').click()
  await expect(title).toContainText('这是第1句的中文译文。')
  await title.getByRole('button').click()
  await expect(title).toContainText('An original English title')
  await title.getByRole('button').click()
  await expect(title).toContainText('这是第1句的中文译文。')
  await expect(page.locator('.reading-nav-title .text-translation-control')).toHaveCount(0)
})
