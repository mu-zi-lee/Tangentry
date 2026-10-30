import { openSubtitleSettings } from './subtitle-settings'
import { expect, test, type APIRequestContext } from './e2e'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import type { SubtitleTrack } from '../src/shared/api/types'

const id = 'bilibili:BVaitest0001'
test('AI refresh preserves private drafts until discard is explicitly confirmed', async({page})=>{
 let reads=0
 const mutations:string[]=[]
 await page.route('**/api/ai/settings',async route=>{
  if(route.request().method()==='GET') {
   reads++
   await route.fulfill({json:{protocol:'openai',baseUrl:'https://fixture.example/v1',model:'fixture-model',summaryModel:'',revision:1,hasKey:false,ready:true,summaryReady:true,translating:false}})
  } else {mutations.push(route.request().method());await route.fulfill({status:503,json:{message:'明确保存失败测试'}})}
 })
 await page.goto('/tools#ai/provider')
 const section=page.locator('.ai-settings-workspace')
 await expect(page.getByRole('heading', { name: 'AI 服务', exact: true })).toBeVisible()
 const endpoint=section.getByLabel('接口地址',{exact:true})
 const key=section.getByLabel('API 密钥',{exact:true})
 await endpoint.fill('https://changed-fixture.example/v1')
 await key.fill('synthetic-private-draft')
 for (const name of ['翻译与摘要', '字幕转录', '服务商']) {
  await page.getByRole('tab', { name, exact:true }).click()
  const panel = await page.getByRole('tab', { name, exact:true }).getAttribute('aria-controls')
  await expect(page.locator(`#${panel}`)).toBeVisible()
 }
 await expect(endpoint).toHaveValue('https://changed-fixture.example/v1')
 await expect(key).toHaveValue('synthetic-private-draft')
 await section.getByRole('button',{name:'保存 AI 设置',exact:true}).click()
 await expect(section.getByRole('alert')).toContainText('明确保存失败测试')
 await expect(endpoint).toHaveValue('https://changed-fixture.example/v1')
 await expect(key).toHaveValue('synthetic-private-draft')
 await section.getByRole('button',{name:'刷新',exact:true}).click()
 await expect(section.getByRole('group',{name:'放弃未保存的设置'})).toBeVisible()
 expect(reads).toBe(2)
 await section.getByRole('button',{name:'继续编辑',exact:true}).click()
 await expect(key).toHaveValue('synthetic-private-draft')
 await section.getByRole('button',{name:'刷新',exact:true}).click()
 await section.getByRole('button',{name:'放弃修改',exact:true}).click()
 await expect(endpoint).toHaveValue('https://fixture.example/v1')
 await expect(key).toHaveValue('')
 expect(reads).toBe(3)
 expect(mutations).toEqual(['PUT'])
})

// Translations are stored by source text and shared by every test in a file,
// so each test's sentences carry a tag of its own.
function testTag() {
  let hash = 0
  for (const char of test.info().title) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return (hash >>> 0).toString(36)
}
function source(count: number, language = 'en'): SubtitleTrack {
  const tag = testTag()
  return { language, label: language === 'en' ? 'English' : '简体中文', automatic: false, cues: Array.from({ length: count }, (_, i) => ({ start: i + 0.125, end: i + 1.125, text: `Original sentence ${i + 1}. [${tag}]` })) }
}
async function configure(request: APIRequestContext, model: string) {
  const status = await (await request.get('/api/ai/settings')).json()
  const result = await request.put('/api/ai/settings', { data: { baseUrl: 'https://ai-fixture.example/v1', model, key: '', revision: status.revision } })
  expect(result.ok()).toBe(true)
}
async function save(request: APIRequestContext, track: SubtitleTrack) {
  const tracks = (await (await request.get('/api/saved-subtitles?contentId=' + encodeURIComponent(id))).json()).tracks
  const existing = tracks.find((value: { track: SubtitleTrack }) => value.track.language === track.language)
  const response = await request.put(`/api/saved-subtitles/${encodeURIComponent(id)}/${track.language}`, { data: { track, revision: existing?.revision ?? 0 } })
  expect(response.ok()).toBe(true)
}
async function inspect(request: APIRequestContext, track: SubtitleTrack, targetLanguage = 'zh-Hant') {
  const result = await request.post('/api/ai/subtitles/inspect', { data: { contentId: id, track, targetLanguage, revision: 0 } })
  expect(result.ok()).toBe(true)
  return result.json()
}
async function prepareAITranslation(page: Page, language = 'en', target = 'zh-Hant') {
  await openSubtitleSettings(page)
  await page.getByLabel('翻译目标语言', { exact: true }).selectOption(target)
  await page.getByLabel('字幕语言', { exact: true }).selectOption(language)
}
async function selectSubtitleLanguage(page: Page, language: string) {
  await openSubtitleSettings(page)
  await page.getByLabel('字幕语言', { exact: true }).selectOption(language)
}
test('Chinese subtitles skip AI requests and duplicate translations; English still exposes translation', async ({ page, request }) => {
  const requests: string[] = []
  page.on('request', request => {
    if (/\/api\/ai\/subtitles\/(inspect|translate)$/.test(request.url()) && !request.postDataJSON()?.source) requests.push(request.url())
  })
  for (const { platform, language, multilingual, intro } of [
    { platform: 'bilibili', language: 'zh-Hans', multilingual: true },
    { platform: 'youtube', language: 'zh-Hans', multilingual: true },
    { platform: 'youtube', language: 'und', multilingual: false },
    { platform: 'bilibili', language: 'und', multilingual: false, intro: true },
  ]) {
    const chinese = { language, label: '中文', automatic: true, cues: [{ start: 0, end: 5, text: '这是已经识别出来的中文字幕，不需要再次翻译。' }] }
    if (intro) chinese.cues = Array.from({ length: 200 }, (_, index) => ({ start: index, end: index + 1, text: index < 20 ? 'Welcome to the video.' : '这是一段中文视频正文，介绍真实的内容与阅读方式。' }))
    const english = source(1)
    const contentId = platform === 'bilibili' ? 'bilibili:BVzhskip0001' : 'youtube:CapsTest001'
    for (const saved of (await (await request.get('/api/saved-subtitles?contentId=' + encodeURIComponent(contentId))).json()).tracks) {
      expect((await request.delete(`/api/saved-subtitles/${encodeURIComponent(contentId)}/${saved.track.language}?revision=${saved.revision}`)).ok()).toBe(true)
    }
    await page.route(`**/api/subtitles/${platform}?**`, route => route.fulfill({ json: { videoId: 'CapsTest001', part: 1, status: 'available', tracks: multilingual ? [chinese, english] : [chinese] } }))
    const before = requests.length
    await page.goto(platform === 'bilibili' ? '/reader?video=BVzhskip0001' : '/reader?contentId=youtube%3ACapsTest001')
    const cues = page.getByRole('list', { name: '字幕段落' })
    await expect(cues).toContainText(chinese.cues[0].text)
    if (intro) await expect(cues).toContainText(chinese.cues[199].text)
    await openSubtitleSettings(page)
    await expect(page.getByLabel('翻译目标语言', { exact: true })).toBeVisible()
    await expect(page.locator('.subtitle-translation summary')).toHaveCount(0)
    await expect(cues.locator('.subtitle-translated')).toHaveCount(0)
    expect(requests.length).toBe(before)
    if (!multilingual) continue
    await openSubtitleSettings(page)
    await page.getByLabel('字幕语言', { exact: true }).selectOption('en')
    await page.getByLabel('翻译目标语言', { exact: true }).selectOption('fr')
    await expect(page.locator('.subtitle-translation summary')).toBeVisible()
    await expect.poll(() => requests.length).toBeGreaterThan(before)
    await openSubtitleSettings(page)
    await page.getByLabel('字幕语言', { exact: true }).selectOption(language)
    await page.getByLabel('翻译目标语言', { exact: true }).selectOption('zh-Hans')
    await expect(page.locator('.subtitle-translation summary')).toHaveCount(0)
    await expect(cues).toContainText(chinese.cues[0].text)
    await expect(cues.locator('.subtitle-translated')).toHaveCount(0)
  }
})

test('native platform targets use their own timeline and AI fallback keeps the selected target', async ({ page }) => {
  const english = { language: 'en', label: '英语', automatic: false, source: 'cc', cues: [{ start: 0, end: 4, text: 'Original source sentence.' }] }
  const japanese = { language: 'ja', label: '日语', automatic: false, source: 'cc', cues: [{ start: 20, end: 23, text: '日本語の字幕。' }, { start: 30, end: 33, text: '別の時間軸。' }] }
  const traditional = { language: 'zh-TW', label: '繁体中文', automatic: false, source: 'cc', cues: [{ start: 40, end: 43, text: '繁體原生字幕。' }] }
  const languages = [
    { language: 'en', label: '英语', automatic: false, source: 'cc', hasUrl: true },
    { language: 'ja', label: '日语', automatic: false, source: 'cc', hasUrl: true },
    { language: 'zh-TW', label: '繁体中文', automatic: false, source: 'cc', hasUrl: true },
    { language: 'fr', label: '法语', automatic: false, source: 'cc', hasUrl: false },
  ]
  const inspections: string[] = [], translations: string[] = []
  const reads: string[] = []
  await page.route('**/api/subtitles/bilibili?**', route => {
    const language = new URL(route.request().url()).searchParams.get('language')
    if (language) reads.push(language)
    const track = language === 'ja' ? japanese : language === 'zh-TW' ? traditional : english
    return route.fulfill({ json: { videoId: 'BVnative0001', part: 1, status: 'available', tracks: [track], languages } })
  })
  await page.route('**/api/ai/subtitles/inspect', route => {
    const body = route.request().postDataJSON()
    inspections.push(body.targetLanguage)
    return route.fulfill({ json: { settings: { ready: true, baseUrl: 'https://ai-fixture.example/v1', model: 'fixture-model', revision: 1, translating: false }, result: { key: 'a'.repeat(64), contentId: body.contentId, language: body.track.language, targetLanguage: body.targetLanguage, baseUrl: 'https://ai-fixture.example/v1', model: 'fixture-model', total: body.track.cues.length, texts: [], updatedAt: 0 }, active: false } })
  })
  await page.route('**/api/ai/subtitles/translate', route => {
    const body = route.request().postDataJSON()
    translations.push(body.targetLanguage)
    return route.fulfill({ json: { key: 'a'.repeat(64), contentId: body.contentId, language: body.track.language, targetLanguage: body.targetLanguage, baseUrl: 'https://ai-fixture.example/v1', model: 'fixture-model', total: body.track.cues.length, texts: body.track.cues.map((_cue: unknown, index: number) => `Fixture translation ${body.targetLanguage} ${index + 1}.`), updatedAt: 0 } })
  })

  await page.goto('/reader?video=BVnative0001')
  const cues = page.getByRole('list', { name: '字幕段落' })
  await expect(cues).toContainText('Original source sentence.')
  const initialInspections = inspections.length
  await openSubtitleSettings(page)
  await page.getByLabel('翻译目标语言', { exact: true }).selectOption('ja')
  await expect(cues).toContainText('日本語の字幕。')
  await expect(cues).toContainText('別の時間軸。')
  await expect(cues.locator('.subtitle-translated')).toHaveCount(0)
  await expect(page.locator('.subtitle-track-status [role="status"]')).toHaveAttribute('title', 'B 站 CC 提供的日语字幕')
  expect(translations).toEqual([])
  expect(inspections).toHaveLength(initialInspections)
  await expect(cues.locator('.subtitle-time time')).toHaveText(['00:20', '00:30'])

  await page.getByLabel('翻译目标语言', { exact: true }).selectOption('zh-Hans')
  await expect(cues).toContainText('Original source sentence.')
  await expect.poll(() => inspections.includes('zh-Hans')).toBe(true)
  const unmatchedInspectionCount = inspections.length
  await page.getByLabel('翻译目标语言', { exact: true }).selectOption('zh-Hant')
  await expect(cues).toContainText('繁體原生字幕。')
  await expect(cues).not.toContainText('日本語の字幕。')
  await expect(cues.locator('.subtitle-translated')).toHaveCount(0)
  expect(translations).toEqual([])
  expect(inspections).toHaveLength(unmatchedInspectionCount)

  await page.getByLabel('翻译目标语言', { exact: true }).selectOption('fr')
  await expect(cues).toContainText('Original source sentence.')
  await expect.poll(() => inspections.includes('fr')).toBe(true)
  await page.locator('.subtitle-translation summary').click()
  await page.getByRole('button', { name: '开始翻译整份字幕', exact: true }).click()
  await expect.poll(() => translations).toContain('fr')
  await page.getByLabel('翻译目标语言', { exact: true }).selectOption('en')
  await expect(cues).toContainText('Original source sentence.')
  expect(translations).toEqual(['fr'])
})
test('AI settings explicitly select a model, retain private keys only for the same endpoint, and never start translation', async ({ page, request }) => {
  let starts = 0; page.on('request', r => { if (r.url().endsWith('/api/ai/subtitles/translate')) starts++ })
  await page.goto('/tools#ai/provider')
 const section = page.locator('.ai-settings-workspace')
 await expect(page.getByRole('heading', { name: 'AI 服务', exact: true })).toBeVisible()
 await section.getByLabel('接口地址', { exact: true }).fill('https://ai-fixture.example/v1')
 await section.getByRole('combobox', { name: '接口类型', exact: true }).selectOption('compatible')
 await section.getByLabel('API 密钥', { exact: true }).fill('synthetic-e2e-key-only')
  await page.getByRole('tab', { name: '翻译与摘要', exact: true }).click()
  await section.getByRole('button', { name: '管理模型', exact:true }).click()
  const library = page.getByRole('dialog', { name:'模型库', exact:true })
  await library.getByLabel('手动添加模型名', { exact: true }).fill('fixture-translation')
  await library.getByRole('button', { name: '添加模型', exact: true }).click()
  await library.getByRole('button', { name:'完成', exact:true }).click()
  await section.getByRole('button', { name: '保存 AI 设置', exact: true }).click()
  await expect(section.getByRole('status')).toContainText('设置已保存')
  const status = await (await request.get('/api/ai/settings')).json()
  expect(status.protocol).toBe('compatible'); expect(status.hasKey).toBe(true); expect(JSON.stringify(status)).not.toContain('synthetic-e2e-key-only')
  await page.reload()
  await page.getByRole('tab', { name:'服务商', exact:true }).click()
  await expect(section.getByLabel('API 密钥', { exact: true })).toHaveValue('')
  await expect(section.getByRole('combobox', { name: '接口类型', exact: true })).toHaveValue('compatible')
  await section.getByLabel('接口地址', { exact: true }).fill('https://another-fixture.example/v1')
  await expect(section.getByRole('button', { name: '保存 AI 设置', exact: true })).toBeDisabled()
  await section.getByLabel('无需密钥（清除旧密钥）', { exact: true }).check()
  await section.getByRole('button', { name: '保存 AI 设置', exact: true }).click()
  await expect(section.getByRole('status')).toContainText('设置已保存')
  expect((await (await request.get('/api/ai/settings')).json()).hasKey).toBe(false)
  expect(starts).toBe(0)
  await page.getByRole('tab', { name: '翻译与摘要', exact: true }).click()
  await section.getByRole('combobox', { name: '翻译模型', exact: true }).selectOption('')
  await section.getByRole('button', { name: '保存 AI 设置', exact: true }).click()
  await expect(section.getByRole('status')).toContainText('未选择模型，翻译尚未启用')
  expect((await (await request.get('/api/ai/settings')).json()).ready).toBe(false)
  await page.getByRole('tab', { name: '服务商', exact: true }).click()
  await section.locator('details').filter({ hasText: '数据发送与费用' }).locator('summary').click()
  await expect(section).toContainText('可见卡片的外文标题与摘要会自动发送')
  await expect(section).toContainText('摘要最多发送前 280 个字符')
  expect(starts).toBe(0)
  await configure(request, 'fixture-translation')
})

test('explicit full-track translation keeps original timings, uses the selected target, supports bilingual search/study and persists across reload', async ({ page, request }) => {
  await configure(request, 'fixture-bilingual'); const track = source(4); await save(request, track)
  let starts = 0; page.on('request', r => { if (r.url().endsWith('/api/ai/subtitles/translate')) starts++ })
  await page.goto('/reader?video=BVaitest0001')
  const cues = page.getByRole('list', { name: '字幕段落' })
  await selectSubtitleLanguage(page, 'en')
  await page.getByLabel('翻译目标语言', { exact: true }).selectOption('zh-Hant')
  await expect(cues).toContainText('Original sentence 1.'); expect(starts).toBe(0)
  await page.getByRole('region', { name: '在线播放', exact: true }).getByRole('button', { name: /^播放视频 / }).click()
  const video = page.getByLabel('B站在线视频播放器', { exact: true })
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.videoWidth)).toBe(640)
  await video.evaluate((node: HTMLVideoElement) => node.pause())
  await openSubtitleSettings(page)
  await page.locator('.subtitle-translation summary').click()
  await page.getByRole('button', { name: '开始翻译整份字幕', exact: true }).click()
  await expect(page.locator('.subtitle-translation').getByRole('status')).toContainText('繁体中文译文已保存到本机')
  await expect(cues).toContainText('這是第1句的中文譯文。')
  await expect(cues.locator('.subtitle-translated').first()).toHaveAttribute('lang', 'zh-Hant')
  await expect(cues.locator('.subtitle-translated')).toHaveCount(4)
  const original = (await (await request.get('/api/saved-subtitles?contentId=' + encodeURIComponent(id))).json()).tracks.find((value: { track: SubtitleTrack }) => value.track.language === 'en').track
  expect(original).toEqual(track)
  await openSubtitleSettings(page)
  await page.getByLabel('搜索字幕', { exact: true }).fill('第3句')
  await expect(cues.getByRole('listitem')).toHaveCount(1)
  await expect(cues).toContainText('Original sentence 3.')
  await cues.getByRole('button', { name: '跳转播放时间 00:02', exact: true }).click()
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(2.125, 2)
  await expect(cues.locator('[aria-current=true]')).toContainText('這是第3句的中文譯文。')
  await openSubtitleSettings(page)
  await page.getByLabel('搜索字幕', { exact: true }).fill('')
  await cues.getByRole('button', { name: '跳转播放时间 00:00', exact: true }).click()
  await openSubtitleSettings(page)
  await page.getByRole('button', { name: '语言学习', exact: true }).click()
  await expect(page.getByLabel('逐句学习')).toContainText('這是第1句的中文譯文。')
  await page.getByRole('button', { name: '隐藏原文', exact: true }).click()
  await expect(page.getByLabel('逐句学习').locator('.subtitle-translated')).toHaveCount(0)
  await page.getByRole('button', { name: '显示原文', exact: true }).click()
  await page.getByRole('button', { name: '阅读', exact: true }).click()
  await expect(page.getByRole('button', { name: '开始翻译整份字幕', exact: true })).not.toBeVisible()
  for (const height of [900, 700]) {
    await page.setViewportSize({ width: 1440, height })
    await cues.scrollIntoViewIfNeeded()
    await expect.poll(() => cues.evaluate(node => node.clientHeight)).toBeGreaterThanOrEqual(120)
    await expect(cues).toBeInViewport()
    const transcript = (await page.locator('.subtitle-reader').boundingBox())!
    const player = (await page.locator('.online-player').boundingBox())!
    expect(transcript.y).toBeGreaterThanOrEqual(player.y + player.height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => window.scrollTo(0, 0))
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.goto('/')
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click()
  await page.goto('/reader?video=BVaitest0001')
  await prepareAITranslation(page, 'en', 'zh-Hant')
  await expect(cues).toContainText('這是第1句的中文譯文。')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await openSubtitleSettings(page)
  await page.locator('.subtitle-translation').scrollIntoViewIfNeeded()
  await page.reload()
  await prepareAITranslation(page, 'en', 'zh-Hant')
  await expect(cues).toContainText('這是第1句的中文譯文。'); expect(starts).toBe(1)
})

test('failed batch retains committed translations and manual continuation does not overwrite source and survives timestamp changes', async ({ page, request }) => {
  await configure(request, 'fixture-partial'); const track = source(40); await save(request, track)
  await page.goto('/reader?video=BVaitest0001')
  await prepareAITranslation(page)
  await expect(page.getByRole('list', { name: '字幕段落' })).toContainText('Original sentence 40.')
  await openSubtitleSettings(page)
  await page.locator('.subtitle-translation summary').click()
  await page.getByRole('button', { name: '开始翻译整份字幕', exact: true }).click()
  await expect(page.locator('.subtitle-translation').getByRole('alert')).toContainText('额度或请求限制')
  expect((await inspect(request, track)).result.texts).toHaveLength(32)
  await openSubtitleSettings(page)
  await page.locator('.subtitle-translation summary').click()
  await page.getByRole('button', { name: '继续翻译', exact: true }).click()
  await expect(page.locator('.subtitle-translation').getByRole('status')).toContainText('繁体中文译文已保存到本机')
  expect((await inspect(request, track)).result.texts).toHaveLength(40)
  // Translations follow the text, so retimed cues keep them without new calls.
  track.cues[0].start += 0.1; await save(request, track); await page.reload()
  await prepareAITranslation(page)
  await expect(page.locator('.subtitle-cues .subtitle-translated').first()).toContainText('這是第1句的中文譯文。')
  expect((await inspect(request, track)).result.texts).toHaveLength(40)
  await openSubtitleSettings(page)
  await page.locator('.subtitle-translation summary').click()
  await expect(page.getByRole('button', { name: '开始翻译整份字幕', exact: true })).toHaveCount(0)
})

test('changing subtitle language during translation cancels the old scope and permits a new explicit translation', async ({ page, request }) => {
  await configure(request, 'fixture-language-switch')
  const english = source(3)
  const french = { ...source(2, 'fr'), label: 'French', cues: [{ start: 0, end: 1, text: 'Bonjour.' }, { start: 1, end: 2, text: 'Au revoir.' }] }
  await save(request, english); await save(request, french)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const starts: string[] = []
  await page.route('**/api/ai/subtitles/translate', async route => {
    const language = route.request().postDataJSON().track.language
    starts.push(language)
    if (language === 'en') {
      await held
      await route.fulfill({ status: 502, json: { code: 'provider_unavailable', message: 'Old scope error must not appear in French.' } }).catch(() => {})
    } else await route.continue()
  })
  await page.goto('/reader?video=BVaitest0001')
  await prepareAITranslation(page, 'en', 'ja')
  await openSubtitleSettings(page)
  await page.locator('.subtitle-translation summary').click()
  await page.getByRole('button', { name: '开始翻译整份字幕', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消翻译', exact: true })).toBeVisible()
  await openSubtitleSettings(page)
  await page.getByLabel('字幕语言', { exact: true }).selectOption('fr')
  await expect(page.getByRole('list', { name: '字幕段落' })).toContainText('Bonjour.')
  await openSubtitleSettings(page)
  await page.locator('.subtitle-translation summary').click()
  await expect(page.getByRole('button', { name: '开始翻译整份字幕', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '开始翻译整份字幕', exact: true }).click()
  await expect(page.locator('.subtitle-cues .subtitle-translated')).toHaveCount(2)
  release()
  await expect(page.locator('.subtitle-translation').getByRole('alert')).toHaveCount(0)
  expect(starts).toEqual(['en', 'fr'])
  await expect(page.getByRole('list', { name: '字幕段落' })).not.toContainText('Original sentence')
})

test('cancel or navigating away aborts the provider request, leaves partial cache, and a configuration change requires renewed explicit action', async ({ page, request }) => {
  await configure(request, 'fixture-cancel'); const track = source(40); await save(request, track)
  await page.goto('/reader?video=BVaitest0001')
  await prepareAITranslation(page)
  await page.locator('.subtitle-translation summary').click()
  await page.getByRole('button', { name: '开始翻译整份字幕', exact: true }).click()
  await expect.poll(async () => (await inspect(request, track)).result.texts.length).toBe(32)
  await page.getByRole('button', { name: '取消翻译', exact: true }).click()
  await expect.poll(async () => (await inspect(request, track)).active).toBe(false)
  expect((await inspect(request, track)).result.texts).toHaveLength(32)
  await openSubtitleSettings(page)
  await page.locator('.subtitle-translation summary').click()
  await expect(page.getByRole('button', { name: '继续翻译', exact: true })).toBeEnabled()
  await configure(request, 'fixture-navigation')
  await page.getByRole('button', { name: '继续翻译', exact: true }).click()
  await expect(page.locator('.subtitle-translation').getByRole('alert')).toContainText('AI 配置已更新')
  await openSubtitleSettings(page)
  await page.locator('.subtitle-translation summary').click()
  await page.getByRole('button', { name: '重新读取设置与译文', exact: true }).click()
  // The new model continues the stored partial translation instead of restarting.
  await page.getByRole('button', { name: '继续翻译', exact: true }).click()
  await expect.poll(async () => (await inspect(request, track)).active).toBe(true)
  await page.goto('/notes')
  await expect.poll(async () => (await inspect(request, track)).active).toBe(false)
  await page.goto('/reader?video=BVaitest0001')
  await expect(page.getByRole('list', { name: '字幕段落' })).toContainText('Original sentence 1.')
  await expect(page.locator('.subtitle-translation').getByRole('status')).toHaveCount(0)
})

test('YouTube and RSS podcast readers receive the same isolated bilingual assistance without changing original subtitle records', async ({ page, request }) => {
  await configure(request, 'fixture-cross-source')
  for (const [index, item] of [
    { id: 'youtube:AICross0001', platform: 'youtube', platformId: 'AICross0001', kind: 'video', title: '跨来源字幕翻译测试视频', author: '明确测试作者', authorId: '', url: 'https://www.youtube.com/watch?v=AICross0001', thumbnailUrl: '', description: '', durationSeconds: 12, publishedAt: 1720000000 },
    { id: 'rss:' + 'f'.repeat(64), platform: 'rss', platformId: 'f'.repeat(64), kind: 'audio', title: '跨来源字幕翻译测试播客', author: '明确测试作者', authorId: '', url: 'https://rss-fixture.example/translation-podcast', mediaUrl: 'https://rss-fixture.example/audio.mp3', thumbnailUrl: '', description: '', durationSeconds: 12, publishedAt: 1720000000 },
  ].entries()) {
    const track = source(3)
    const added = await request.post('/api/library', { data: item }); expect(added.ok()).toBe(true)
    const record = await request.put(`/api/saved-subtitles/${encodeURIComponent(item.id)}/en`, { data: { track, revision: 0 } }); expect(record.ok()).toBe(true)
    try {
      await page.goto('/reader?contentId=' + encodeURIComponent(item.id))
      const cues = page.getByRole('list', { name: '字幕段落' })
      await prepareAITranslation(page)
      await expect(cues).toContainText('Original sentence 1.')
      // The second source has the same text and reuses the first translation.
      if (index === 0) {
        await openSubtitleSettings(page)
        await page.locator('.subtitle-translation summary').click()
        await page.getByRole('button', { name: '开始翻译整份字幕', exact: true }).click()
      }
      await expect(cues).toContainText('這是第1句的中文譯文。')
      const records = (await (await request.get('/api/saved-subtitles?contentId=' + encodeURIComponent(item.id))).json()).tracks
      expect(records.map((value: { track: SubtitleTrack }) => value.track)).toEqual([track])
      const result = await request.post('/api/ai/subtitles/inspect', { data: { contentId: item.id, track, targetLanguage: 'zh-Hant', revision: 0 } })
      expect((await result.json()).result.contentId).toBe(item.id)
      await page.reload()
      await prepareAITranslation(page)
      await expect(cues).toContainText('這是第1句的中文譯文。')
    } finally {
      await page.goto('/notes')
      await request.delete(`/api/saved-subtitles/${encodeURIComponent(item.id)}/en?revision=1`)
      await request.delete('/api/library/' + encodeURIComponent(item.id))
    }
  }
})
