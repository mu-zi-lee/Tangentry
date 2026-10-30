import { expect, test, type Download } from './e2e'
import AxeBuilder from '@axe-core/playwright'
import { execFileSync } from 'node:child_process'
import type { ReadingNote } from '../src/shared/api/types'

// Validate the browser's actual downloaded archive independently with Python's
// ZIP/CRC/UTF-8 reader; no client implementation or additional ZIP dependency.
async function inspect(download: Download) {
  expect(download.suggestedFilename()).toMatch(/^Tangentry-notes-\d{8}-\d{6}\.zip$/)
  const path = await download.path()
  expect(path).toBeTruthy()
  return JSON.parse(execFileSync('python3', ['-c', `
import json,zipfile,sys,pathlib,urllib.parse
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 names=z.namelist()
 assert len(names)==len(set(names))
 for name in names:
  p=pathlib.PurePosixPath(name)
  assert not p.is_absolute() and '..' not in p.parts and '\\\\' not in name
 files={name:z.read(name).decode('utf-8') for name in names}
 manifest=json.loads(files['tangentry-notes.json'])
 assert manifest['schemaVersion']==1
 sources=[name for name in files if name.startswith('sources/')]
 images=[name for name in files if name.startswith('images/')]
 assert len(files)==len(manifest['entries'])+5+len(sources)+len(images)
 assert len(sources)==len({entry['note']['contentId'] for entry in manifest['entries'] if not entry['note']['contentId'].startswith('memo:')})
 assert 'TAGS.md' in files
 assert 'SOURCES.md' in files
 for entry in manifest['entries']:
  assert urllib.parse.quote(pathlib.PurePosixPath(entry['file']).name) in files['SOURCES.md']
 for entry in manifest['entries']:
  metadata,body=files[entry['file']].removeprefix('---\\n').split('\\n---\\n\\n',1)
  properties=json.loads(metadata)
  assert body==entry['note']['body']+'\\n' or body.endswith('## 我的记录\\n\\n'+entry['note']['body']+'\\n')
  assert properties['tangentry_note_id']==entry['note']['id']
  entry['properties']=properties
 print(json.dumps(manifest,ensure_ascii=False))
`, path!], { encoding: 'utf8' })) as { selection: { q: string; tag: string; from: number; to: number; contentId: string }; entries: { note: ReadingNote; properties: Record<string, unknown> }[] }
}

test.beforeEach(async ({ request, page }) => {
  await page.setViewportSize({ width: 1844, height: 1098 })
  let cursor = ''
  do {
    const result = await (await request.get(`/api/notes/search?${new URLSearchParams({ cursor })}`)).json()
    for (const note of result.notes) await request.delete(`/api/notes/${note.id}`)
    cursor = result.nextCursor
  } while (cursor)
})

test('nested parent export matches visible descendants and keeps original tag paths', async ({ page, request }) => {
  const tags = ['学习/阅读', '学习/阅读/书摘', '学习/阅读延伸']
  for (const tag of tags) expect((await request.post('/api/notes', { data: { body: `分级导出 ${tag}`, tags: [tag] } })).status()).toBe(201)
  await page.goto('/notes')
  await page.getByLabel('筛选笔记标签', { exact: true }).selectOption('学习/阅读')
  await page.getByRole('button', { name: '搜索笔记', exact: true }).click()
  await expect(page.locator('.global-note-list > li')).toHaveCount(2)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出筛选笔记', exact: true }).click()
  const manifest = await inspect(await downloaded)
  expect(manifest.entries).toHaveLength(2)
  expect(manifest.selection.tag).toBe('学习/阅读')
  expect(manifest.entries.map(entry => entry.note.tags?.[0]).sort()).toEqual(tags.slice(0, 2).sort())
  for (const entry of manifest.entries) expect(entry.properties.tags).toEqual(entry.note.tags)
})

test('exports all saved matching notes beyond the displayed page and uses confirmed filters', async ({ page, request }) => {
  for (let index = 0; index < 65; index++) expect((await request.post('/api/notes', { data: { body: `导出😀 **想法** ${index}`, tags: ['学习'] } })).status()).toBe(201)
  await request.post('/api/notes', { data: { body: '其他笔记', tags: ['其他'] } })
  await page.goto('/notes')
  await page.getByLabel('搜索全部笔记正文').fill('导出😀')
  await page.getByLabel('筛选笔记标签', { exact: true }).selectOption('学习')
  await page.getByRole('button', { name: '搜索笔记', exact: true }).click()
  await expect(page.getByRole('list', { name: '全部笔记结果' }).getByRole('listitem')).toHaveCount(50)
  await expect(page.getByText('匹配“导出😀”', { exact: false })).toBeVisible()
  const memo = page.getByLabel('随手记正文')
  await memo.fill('未保存的导出草稿')
  await page.getByLabel('搜索全部笔记正文').fill('未提交条件')
  await page.getByLabel('筛选笔记标签', { exact: true }).selectOption('其他')
  const first = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出筛选笔记', exact: true }).click()
  const manifest = await inspect(await first)
  expect(manifest.entries).toHaveLength(65)
  expect(manifest.selection.q).toBe('导出😀'); expect(manifest.selection.tag).toBe('学习')
  expect(manifest.entries.every(e => e.note.body.startsWith('导出😀'))).toBe(true)
  await expect(memo).toHaveValue('未保存的导出草稿')
  await expect(page.getByRole('status').filter({ hasText: '已生成 65 条笔记' })).toBeVisible()
  await page.route('**/api/notes/search?**', route => route.fulfill({ status: 503, json: { code: 'test_failure', message: '测试查询失败' } }))
  await page.getByRole('button', { name: '搜索笔记', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('测试查询失败')
  const second = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出筛选笔记', exact: true }).click()
  expect((await inspect(await second)).selection).toEqual(manifest.selection)
  await page.unroute('**/api/notes/search?**')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.getByRole('button', { name: '切换深色模式', exact: true }).click()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

test('source export keeps fractional original time and anchors while excluding unsaved drafts and other sources', async ({ page, request }) => {
  const contentId = 'youtube:abcdefghijk'
  const textAnchor = { quote: '原文😀', start: 3, end: 7, prefix: '前文', suffix: '后文', sourceHash: 'b'.repeat(64) }
  const positionSeconds = 9258.100000000364
  const note = await (await request.post('/api/notes', { data: { contentId, body: '视频导出 **想法**', positionSeconds, textAnchor, tags: ['学习'] } })).json() as ReadingNote
  await request.post('/api/notes', { data: { body: '另一来源' } })
  await page.goto('/notes')
  await page.getByRole('button', { name: /^编辑来源笔记：.*视频导出/ }).click()
  const panel = page.getByRole('complementary', { name: '来源笔记编辑' })
  await panel.getByLabel('笔记正文').fill('正在输入的未保存笔记')
  await page.getByRole('button', { name: /^查看来源上下文：/ }).click()
  const context = page.getByRole('complementary', { name: '笔记来源上下文', exact: true })
  await expect(context).toBeVisible()
  await expect(panel.getByLabel('笔记正文')).toBeVisible()
  const contextBox = (await context.boundingBox())!
  expect(contextBox.x + contextBox.width).toBeLessThan((await panel.boundingBox())!.x)
  await context.getByRole('button', { name: '关闭来源上下文', exact: true }).click()
  await expect(context).toBeHidden()
  await panel.getByRole('button', { name: '笔记操作', exact: true }).click()
  const actions = panel.getByRole('region', { name: '笔记复制与导出', exact: true })
  await expect(actions).toBeVisible()
  expect(await actions.evaluate(element => getComputedStyle(element).position)).toBe('static')
  const actionBox = (await actions.boundingBox())!
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual((await panel.getByLabel('笔记正文').boundingBox())!.y)
  await panel.getByLabel('笔记正文').click()
  await expect(actions).toBeVisible()
  await panel.getByLabel('笔记正文').press('Escape')
  await expect(actions).toBeHidden()
  await expect(panel.getByRole('button', { name: '笔记操作', exact: true })).toBeFocused()
  await panel.getByRole('button', { name: '笔记操作', exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await panel.getByRole('button', { name: '导出来源笔记', exact: true }).click()
  const manifest = await inspect(await downloaded)
  expect(manifest.entries).toHaveLength(1)
  expect(manifest.selection.contentId).toBe(contentId)
  expect(manifest.entries[0].note).toEqual(note)
  expect(manifest.entries[0].properties.position_seconds).toBe(9258)
  expect(manifest.entries[0].properties.position).toBe('2:34:18')
  expect(manifest.entries[0].properties.source_url_at_time).toBe('https://www.youtube.com/watch?v=abcdefghijk&t=9258s')
  await expect(panel.getByLabel('笔记正文')).toHaveValue('正在输入的未保存笔记')
  expect((await (await request.get('/api/notes?contentId='+contentId)).json()).notes).toEqual([note])
})

test('uncollected local XHS metadata is shared by author search and the downloaded note archive', async ({ page, request }) => {
  const contentId = 'xiaohongshu:6411cf99000000001300b6d9'
  await request.delete('/api/library/' + encodeURIComponent(contentId))
  const feed = await (await request.get('/api/discovery/xiaohongshu?q=' + encodeURIComponent('https://xhslink.com/a/Fixture'))).json()
  const item = feed.items[0]
  const response = await request.post('/api/notes', { data: { contentId, body: '保留来源的图文理解', tags: ['图文/阅读'] } })
  expect(response.status()).toBe(201)
  const saved = await response.json()
  let externalReads = 0
  await page.route('**/api/discovery/**', route => { externalReads++; return route.fulfill({ status: 503, json: {} }) })
  await page.goto('/notes')
  await page.getByLabel('搜索全部笔记正文').fill(item.author)
  await page.getByLabel('筛选笔记标签', { exact: true }).selectOption('图文')
  await page.getByRole('button', { name: '搜索笔记', exact: true }).click()
  await expect(page.locator('.global-note-list > li')).toHaveCount(1)
  await expect(page.locator('.global-note-source h3')).toHaveText(item.title)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出筛选笔记', exact: true }).click()
  const manifest = await inspect(await downloaded)
  expect(manifest.entries).toHaveLength(1)
  expect(manifest.entries[0].note).toEqual(saved)
  expect(manifest.entries[0].properties.source_title).toBe(item.title)
  expect(manifest.entries[0].properties.source_author).toBe(item.author)
  expect(manifest.selection.q).toBe(item.author)
  expect(manifest.selection.tag).toBe('图文')
  expect(externalReads).toBe(0)
})

test('failed export and cancelled late responses preserve drafts without phantom downloads', async ({ page, request }) => {
  await request.post('/api/notes', { data: { body: '可导出笔记' } })
  await page.goto('/notes')
  const button = page.getByRole('button', { name: '导出全部笔记', exact: true })
  await expect(button).toBeEnabled()
  await page.getByLabel('随手记正文').fill('取消后还在的草稿')
  const downloads: Download[] = []
  page.on('download', value => downloads.push(value))
  await page.route('**/api/notes/export', route => route.fulfill({ status: 413, json: { code: 'note_export_limit', message: '按标签或日期缩小范围' } }))
  await button.click()
  await expect(page.getByRole('alert')).toContainText('按标签或日期缩小范围')
  await page.unroute('**/api/notes/export')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let finished!: () => void
  const done = new Promise<void>(resolve => { finished = resolve })
  await page.route('**/api/notes/export', async route => {
    const response = await route.fetch()
    await gate
    try { await route.fulfill({ response }) } catch { /* User cancelled the request. */ } finally { finished() }
  })
  await button.click()
  await page.getByRole('button', { name: '取消导出', exact: true }).click()
  release(); await done
  await expect(page.getByRole('status')).toContainText('已取消导出')
  await expect(page.getByLabel('随手记正文')).toHaveValue('取消后还在的草稿')
  expect(downloads).toHaveLength(0)
  await page.unroute('**/api/notes/export')
  let finishNavigation!: () => void, releaseNavigation!: () => void
  const navigationDone = new Promise<void>(resolve => { finishNavigation = resolve })
  const navigationGate = new Promise<void>(resolve => { releaseNavigation = resolve })
  await page.route('**/api/notes/export', async route => {
    const response = await route.fetch(); await navigationGate
    try { await route.fulfill({ response }) } catch { /* Scope unmounted. */ } finally { finishNavigation() }
  })
  await button.click()
  await page.getByRole('button', { name: '发现', exact: true }).click()
  releaseNavigation(); await navigationDone
  expect(downloads).toHaveLength(0)
  await page.getByRole('button', { name: '笔记', exact: true }).click()
  await expect(page.getByLabel('随手记正文')).toHaveValue('取消后还在的草稿')
})
