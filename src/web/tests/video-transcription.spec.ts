import { openSubtitleSettings } from './subtitle-settings'
import { expect, test } from './e2e'

let previousConfig: Record<string, unknown>
test.beforeEach(async ({ request }) => {
 previousConfig = (await (await request.get('/api/transcription/settings')).json()).config
 expect((await request.put('/api/transcription/settings', { data: {
  ...previousConfig, backend: 'whisper.cpp', model: '/explicit-fixture/ggml-base.bin',
 } })).ok()).toBe(true)
})
test.afterEach(async ({ request }) => {
 expect((await request.put('/api/transcription/settings', { data: previousConfig })).ok()).toBe(true)
})

for (const [id, url] of [['bilibili:BVnone000000', '/reader?video=BVnone000000'], ['youtube:Nocaps00001', '/reader?contentId=youtube%3ANocaps00001']]) {
 test(`${id}: manual transcription starts explicitly, saves timed text, and survives reopening`, async ({ page, request }) => {
  const platform = id.split(':')[0]
  await page.route(`**/api/subtitles/${platform}?**`, route => route.fulfill({ json: {
   videoId: id.split(':')[1], part: 1, status: 'none', tracks: [], selectedLanguage: '',
  } }))
  const savedURL='/api/saved-subtitles?contentId='+encodeURIComponent(id)
  for(const saved of (await (await request.get(savedURL)).json()).tracks) await request.delete('/api/saved-subtitles/'+encodeURIComponent(id)+'/'+saved.track.language+'?revision='+saved.revision)
  let starts=0; page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/transcription/jobs'))starts++})
  await page.goto(url)
  await expect(page.getByRole('status').filter({hasText:'暂无可用'})).toBeVisible()
  expect(starts).toBe(0)
  await page.getByRole('button',{name:'转写前 1 分钟',exact:true}).click()
  await expect(page.getByRole('button',{name:'取消转写',exact:true})).toBeVisible()
  await expect(page.getByRole('list',{name:'字幕段落'})).toContainText('播客转写测试第一句',{timeout:10000})
  const saved=(await (await request.get(savedURL)).json()).tracks
  expect(saved).toHaveLength(1); expect(saved[0].track.language).toBe('whisper-preview');expect(starts).toBe(1)
  await page.reload();await expect(page.getByRole('list',{name:'字幕段落'})).toContainText('播客转写测试第一句');expect(starts).toBe(1)
 })
}

test('transcription failures show the failed stage and keep explicit retry controls',async({page})=>{
 await page.route('**/api/transcription/jobs?*',route=>route.fulfill({json:{job:{id:'explicit-failure-fixture',contentId:'bilibili:BVnone000000',state:'failed',preview:false,failedStage:'fetching',errorCode:'audio_download',error:'yt-dlp 未能下载完整音轨，请检查网络，或重新获取媒体连接后重试。'}}}))
 await page.goto('/reader?video=BVnone000000')
 await openSubtitleSettings(page, 'transcription')
 await expect(page.getByRole('status').filter({hasText:'暂存音频：yt-dlp 未能下载完整音轨'})).toBeVisible()
 await expect(page.getByRole('button',{name:'开始转录视频',exact:true})).toBeEnabled()
 await expect(page.getByRole('button',{name:'取消转写',exact:true})).toHaveCount(0)
})
