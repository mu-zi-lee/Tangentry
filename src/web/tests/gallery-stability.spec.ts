import { expect, test, type Page } from './e2e'
import type { ContentItem } from '../src/shared/api/types'

function imageItem(index: number): ContentItem {
  return {
    id: `xiaohongshu:cover-${index}`, platform: 'xiaohongshu', platformId: `cover-${index}`, kind: 'image',
    title: `封面比例测试 ${index + 1}`, author: '图片测试作者', authorId: '',
    url: `https://www.xiaohongshu.com/explore/cover-${index}`, thumbnailUrl: `https://sns-webpic-qc.xhscdn.com/cover-${index}`,
    thumbnailWidth: 600, thumbnailHeight: [900, 400, 600][index % 3],
    description: '', durationSeconds: 0, publishedAt: 0,
  }
}

async function mockImages(page: Page, wait: Promise<void> = Promise.resolve()) {
  await page.route('**/api/xiaohongshu/images/**', async route => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[4])
    const item = imageItem(Number(id.split('-').at(-1)))
    await wait
    await route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${item.thumbnailHeight}"><rect width="100%" height="100%" fill="#74a9bd"/></svg>` })
  })
}

test('image covers reserve their actual ratio before loading and keep it across viewport widths', async ({ page }) => {
  const items = Array.from({ length: 18 }, (_, index) => imageItem(index))
  let release = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  await mockImages(page, pending)
  await page.route('**/api/library', route => route.fulfill({ json: { items } }))
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/library')
  const images = page.locator('.card-image .modern-card-thumbnail img')
  await expect(images).toHaveCount(items.length)
  const before = await images.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect()
    return { width: rect.width, height: rect.height, loaded: (node as HTMLImageElement).complete }
  }))
  for (let index = 0; index < before.length; index++) {
    expect(before[index].loaded).toBe(false)
    expect(before[index].height / before[index].width).toBeCloseTo(items[index].thumbnailHeight! / 600, 2)
  }
  release()
  await expect.poll(() => images.first().evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(600)
  expect(await images.first().evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(before[0].height, 1)
  for (const width of [1844, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => images.first().evaluate(node => {
      const rect = node.getBoundingClientRect()
      return Math.abs(rect.height / rect.width - 1.5)
    })).toBeLessThan(0.01)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('scrolling a long mixed gallery does not move card geometry or pull the viewport back', async ({ page }) => {
  const items = Array.from({ length: 90 }, (_, index) => imageItem(index))
  await mockImages(page)
  await page.route('**/api/discovery/batch', route => route.fulfill({ json: {
    batchId: 'stability', items: items.map(item => ({ item, source: 'xiaohongshu', reason: '小红书推荐', carriedOver: false })),
    reason: '', hasNextBatch: false, sourceStatus: {},
  } }))
  await page.goto('/')
  const cards = page.getByTestId('content-card')
  await expect(cards).toHaveCount(items.length)
  const initial = await cards.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect()
    return { top: rect.top + scrollY, height: rect.height }
  }))
  for (const top of [1000, 2400, 4300, 1800, 600]) {
    await page.evaluate(top => scrollTo(0, top), top)
    await page.waitForTimeout(160)
    const samples = await page.evaluate(async () => {
      const values = []
      for (let index = 0; index < 12; index++) {
        await new Promise(requestAnimationFrame)
        values.push(scrollY)
      }
      return values
    })
    expect(Math.max(...samples) - Math.min(...samples)).toBeLessThanOrEqual(1)
    expect(samples.at(-1)).toBeCloseTo(top, 0)
  }
  const after = await cards.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect()
    return { top: rect.top + scrollY, height: rect.height }
  }))
  expect(after).toEqual(initial)
})

test('legacy image cards learn their natural cover ratio and reuse it when returning', async ({ page }) => {
  const item = { ...imageItem(0), thumbnailWidth: undefined, thumbnailHeight: undefined }
  let release = () => {}
  let pending = Promise.resolve()
  await page.route('**/api/xiaohongshu/images/**', async route => {
    await pending
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#74a9bd"/></svg>', headers: { 'Cache-Control': 'no-store' } })
  })
  await page.route('**/api/library', route => route.fulfill({ json: { items: [item] } }))
  await page.goto('/library')
  const image = page.locator('.card-image .modern-card-thumbnail img')
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(600)
  await expect(image).toHaveAttribute('width', '600')
  await expect(image).toHaveAttribute('height', '900')
  const height = await image.evaluate(node => node.getBoundingClientRect().height)
  await page.getByRole('button', { name: '工具设置', exact: true }).click()
  pending = new Promise<void>(resolve => { release = resolve })
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '收藏', exact: true }).click()
  await expect(image).toHaveAttribute('height', '900')
  expect(await image.evaluate(node => node.getBoundingClientRect().height)).toBeCloseTo(height, 1)
  release()
})

test('returning to a shorter collection yields scroll restoration to wheel input', async ({ page }) => {
  const items: ContentItem[] = Array.from({ length: 60 }, (_, index) => ({
    ...imageItem(index), platform: 'bilibili', kind: 'video',
    id: index === 50 ? 'bilibili:BV17x411w7KC' : `bilibili:scroll-${index}`,
    platformId: index === 50 ? 'BV17x411w7KC' : `scroll-${index}`, thumbnailUrl: '',
  }))
  await page.route('**/api/library', route => route.fulfill({ json: { items } }))
  await page.goto('/library')
  await expect(page.getByTestId('content-card')).toHaveCount(60)
  const target = page.getByRole('button', { name: '阅读 封面比例测试 51', exact: true })
  await target.scrollIntoViewIfNeeded()
  const savedTop = await page.evaluate(() => scrollY)
  await target.click()
  await expect(page.getByRole('button', { name: '返回列表', exact: true })).toBeVisible()
  // Preserve a real source element but make its previous viewport unreachable,
  // as can happen after an item is removed or the layout changes.
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = '.content-container .modern-card { max-height: 50px; }'
    document.head.append(style)
  })
  await page.getByRole('button', { name: '返回列表', exact: true }).click()
  await expect(page.getByTestId('content-card')).toHaveCount(60)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThan(savedTop)
  await page.mouse.move(700, 400)
  await page.mouse.wheel(0, -500)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight) - 100)
  const top = await page.evaluate(() => scrollY)
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(top, 0)
})
