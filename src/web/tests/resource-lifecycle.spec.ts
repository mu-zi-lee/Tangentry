import { expect, test } from './e2e'

// Only the external YouTube API is a fixture. The actual reader/component,
// event handling, clock timers, visibility changes and teardown run in-browser.
const youtubeAPI = `
window.YT = { Player: class {
  constructor(frame, { events }) {
    this.state = 2; this.position = 5; this.reads = 0; this.destroyed = false;
    this.events = events;
    window.__youtubeFixture = this;
    queueMicrotask(() => events.onReady());
  }
  getCurrentTime() { this.reads++; return this.position; }
  getDuration() { return 120; }
  getPlayerState() { return this.state; }
  seekTo(seconds) { this.position = seconds; }
  destroy() { this.destroyed = true; }
  change(state) { this.state = state; this.events.onStateChange({ data: state }); }
}};
window.onYouTubeIframeAPIReady?.();
`
type Fixture = { state: number; position: number; reads: number; destroyed: boolean; change(state: number): void }
declare global { interface Window { __youtubeFixture: Fixture } }

test('subscriptions stay dormant outside their page and stop polling after leaving it', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (['/api/subscriptions', '/api/subscription-inbox', '/api/subscription-groups'].includes(path)) requests.push(path)
  })
  await page.goto('/downloads')
  await page.waitForTimeout(300)
  expect(requests).toEqual([])
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '订阅管理', exact: true }).click()
  await expect(page.getByRole('heading', { name: '全部订阅', exact: true })).toBeVisible()
  await expect.poll(() => requests.filter(path => path === '/api/subscriptions').length).toBeGreaterThan(0)
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '下载', exact: true }).click()
  const count = requests.length
  await page.waitForTimeout(5500)
  expect(requests).toHaveLength(count)
})

test('mixed discovery does not preload the unused legacy feeds', async ({ page }) => {
  const legacy: string[] = []
  let batches = 0
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && /^\/api\/recommendations\/[^/]+(?:\/pending)?$/.test(path)) legacy.push(path)
    if (path === '/api/discovery/batch') batches++
  })
  await page.route('**/api/discovery/batch', route => route.fulfill({ json: {
    batchId: 'resource-fixture', items: [], hasNextBatch: false, sourceStatus: {},
  } }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '还没有可浏览的推荐', exact: true })).toBeVisible()
  await page.waitForTimeout(1200)
  expect(batches).toBe(1)
  expect(legacy).toEqual([])
  await page.getByRole('button', { name: '刷新发现内容', exact: true }).click()
  await expect.poll(() => batches).toBe(2)
  expect(legacy).toEqual([])
})

test('discovery continuation does not loop on duplicate pages and remains manually pageable', async ({ page }) => {
  const item = (id: string) => ({
    id: `bilibili:${id}`, platform: 'bilibili', platformId: id, kind: 'video', title: `分页 ${id}`,
    author: '分页作者', authorId: '', url: `https://www.bilibili.com/video/${id}`, thumbnailUrl: '',
    description: '', durationSeconds: 0, publishedAt: 1,
  })
  let batches = 0
  await page.route('**/api/discovery/batch', route => {
    batches++
    return route.fulfill({ json: {
      batchId: 'pagination-fixture', nextCursor: `cursor-${batches + 1}`, hasNextBatch: true,
      items: [{ item: item('first'), source: 'bilibili', reason: 'B站推荐', carriedOver: false }], sourceStatus: {},
    } })
  })
  await page.goto('/')
  await expect.poll(() => batches).toBe(2)
  await page.waitForTimeout(500)
  expect(batches).toBe(2)
  await expect(page.getByTestId('content-card')).toHaveCount(1)
  await page.getByRole('button', { name: '加载更多', exact: true }).click()
  await expect.poll(() => batches).toBe(3)
  await page.waitForTimeout(500)
  expect(batches).toBe(3)
  await page.mouse.move(700, 400)
  await page.mouse.wheel(0, 400)
  await expect.poll(() => batches).toBe(4)
})

test('appending discovery cards preserves observers, avoids detail fetches and mounts only opened menus', async ({ page }) => {
  await page.addInitScript(() => {
    const counts = { resize: {} as Record<string, number>, exposure: {} as Record<string, number>, listeners: {} as Record<string, number> }
    Object.assign(window, { __galleryObservers: counts })
    const add = EventTarget.prototype.addEventListener
    const remove = EventTarget.prototype.removeEventListener
    const tracked = new Map<EventTarget, Map<string, Set<EventListenerOrEventListenerObject>>>()
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if ((this === window || this === document) && ['focus', 'visibilitychange', 'tangentry-translation-language-changed'].includes(type) && listener) {
        let events = tracked.get(this)
        if (!events) tracked.set(this, events = new Map())
        let callbacks = events.get(type)
        if (!callbacks) events.set(type, callbacks = new Set())
        if (!callbacks.has(listener)) { callbacks.add(listener); counts.listeners[type] = (counts.listeners[type] || 0) + 1 }
      }
      return add.call(this, type, listener, options)
    }
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      if (listener && tracked.get(this)?.get(type)?.delete(listener)) counts.listeners[type]--
      return remove.call(this, type, listener, options)
    }
    const Resize = window.ResizeObserver
    window.ResizeObserver = class extends Resize {
      override observe(node: Element, options?: ResizeObserverOptions) {
        if (node.matches('.discovery-card-slot')) {
          const key = node.getAttribute('data-card-label')!
          counts.resize[key] = (counts.resize[key] || 0) + 1
        }
        super.observe(node, options)
      }
    }
    const Intersection = window.IntersectionObserver
    window.IntersectionObserver = class extends Intersection {
      override observe(node: Element) {
        if (node.matches('[data-testid="content-card"]')) {
          const key = node.getAttribute('aria-label')!
          counts.exposure[key] = (counts.exposure[key] || 0) + 1
        }
        super.observe(node)
      }
    }
  })
  const detailRequests: string[] = []
  const exposed: string[] = []
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (/^\/api\/discovery\/(youtube|xiaohongshu|xiaoyuzhou)$/.test(path)) detailRequests.push(path)
  })
  await page.route('**/api/recommendations/*/marks', route => {
    exposed.push(route.request().postDataJSON().contentId)
    return route.fulfill({ json: {} })
  })
  const item = (index: number) => ({
    id: `youtube:resource${index}`, platform: 'youtube', platformId: `resource${index}`, kind: 'video',
    title: `增量分页 ${index}`, author: '分页作者', authorId: '', url: `https://www.youtube.com/watch?v=resource${index}`,
    thumbnailUrl: '', description: '', durationSeconds: 0, publishedAt: 0,
  })
  await page.route('**/api/discovery/batch', route => {
    const next = Boolean(route.request().postDataJSON().cursor)
    return route.fulfill({ json: {
      batchId: 'incremental-fixture', items: Array.from({ length: 18 }, (_, index) => ({
        item: item(index + (next ? 18 : 0)), source: 'youtube', reason: 'YouTube 推荐', carriedOver: false,
      })), hasNextBatch: !next, nextCursor: next ? undefined : 'next', sourceStatus: {},
    } })
  })
  await page.goto('/')
  await expect(page.getByTestId('content-card')).toHaveCount(18)
  await expect.poll(() => exposed.length).toBeGreaterThan(0)
  const listenersBefore = await page.evaluate(() => ({ ...(window as unknown as { __galleryObservers: { listeners: Record<string, number> } }).__galleryObservers.listeners }))
  expect(detailRequests).toEqual([])
  await expect(page.locator('.discovery-feedback-popover button')).toHaveCount(0)
  await page.getByRole('button', { name: '调整发现偏好', exact: true }).first().click()
  await expect(page.getByRole('button', { name: '不感兴趣', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.discovery-feedback-popover button')).toHaveCount(0)
  await page.getByRole('button', { name: '加载更多', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByTestId('content-card')).toHaveCount(36)
  await page.waitForTimeout(250)
  const counts = await page.evaluate(() => (window as unknown as {
    __galleryObservers: { resize: Record<string, number>; exposure: Record<string, number>; listeners: Record<string, number> }
  }).__galleryObservers)
  expect(Object.keys(counts.resize)).toHaveLength(36)
  expect(Object.keys(counts.exposure)).toHaveLength(36)
  expect(Object.values(counts.resize).every(value => value === 1)).toBe(true)
  expect(Object.values(counts.exposure).every(value => value === 1)).toBe(true)
  expect(counts.listeners).toEqual(listenersBefore)
  expect(counts.listeners['tangentry-translation-language-changed']).toBe(1)
  expect(counts.listeners.focus || 0).toBeLessThan(10)
  expect(detailRequests).toEqual([])
})

test('long discovery paging releases distant card trees without changing positions or losing access', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const item = (index: number) => ({
    id: `youtube:dQw4w9Wg${String(index).padStart(3, '0')}`, platform: 'youtube', platformId: `dQw4w9Wg${String(index).padStart(3, '0')}`, kind: 'video',
    title: `长列表 ${index}`, author: '分页作者', authorId: '', url: `https://www.youtube.com/watch?v=dQw4w9Wg${String(index).padStart(3, '0')}`,
    thumbnailUrl: '', description: '用于验证等高占位、回滚和键盘访问的分页夹具。', durationSeconds: 0, publishedAt: 0,
  })
  let requests = 0
  await page.route('**/api/discovery/batch', route => {
    requests++
    const pageIndex = Number(route.request().postDataJSON().cursor || 0)
    return route.fulfill({ json: {
      batchId: 'windowed-fixture', items: Array.from({ length: 30 }, (_, index) => ({
        item: item(pageIndex * 30 + index), source: 'youtube', reason: 'YouTube 推荐', carriedOver: false,
      })), hasNextBatch: pageIndex < 7, nextCursor: String(pageIndex + 1), sourceStatus: {},
    } })
  })
  await page.goto('/')
  const slots = page.locator('.discovery-card-slot')
  await expect(slots).toHaveCount(30)
  for (let count = 60; count <= 240; count += 30) {
    const previous = count - 30
    await page.getByRole('button', { name: '加载更多', exact: true }).scrollIntoViewIfNeeded()
    await expect(slots).toHaveCount(count)
    const changed = await slots.nth(previous).evaluate(node => node.getBoundingClientRect().top)
    expect(Number.isFinite(changed)).toBe(true)
  }
  expect(requests).toBe(8)
  await expect.poll(() => page.getByTestId('content-card').count()).toBeLessThan(90)
  const geometry = () => slots.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect()
    return { top: Math.round(rect.top + scrollY), height: Math.round(rect.height) }
  }))
  const before = await geometry()
  const top = await page.evaluate(() => scrollY)
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(top, 0)
  await page.evaluate(() => scrollTo(0, 0))
  await expect(page.getByTestId('content-card').filter({ hasText: '长列表 0' })).toBeVisible()
  await page.waitForTimeout(200)
  expect(await geometry()).toEqual(before)
  await expect.poll(() => page.getByTestId('content-card').count()).toBeLessThan(90)

  // A focused placeholder restores the actual card rather than dropping it
  // from keyboard navigation. Selecting it must still open the reader.
  await slots.nth(180).focus()
  await expect(slots.nth(180)).toHaveAttribute('data-card-mounted', 'true')
  await expect(slots.nth(180).getByTestId('content-card')).toBeFocused()
  await slots.nth(180).getByTestId('content-card').press('Enter')
  await expect(page.getByRole('button', { name: '返回列表', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回列表', exact: true }).click()
  await expect(slots.nth(180).getByTestId('content-card')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(slots).toHaveCount(240)
  await page.evaluate(() => scrollTo(0, 0))
  await expect(page.getByTestId('content-card').filter({ hasText: '长列表 0' })).toBeVisible()
  await expect.poll(() => slots.first().evaluate(node => Math.abs(node.getBoundingClientRect().height - node.firstElementChild!.getBoundingClientRect().height))).toBeLessThan(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('YouTube samples only advancing playback and releases clocks on hide and unmount', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: youtubeAPI }))
  await page.route('https://www.youtube-nocookie.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>YouTube API fixture</title>' }))
  await page.goto('/reader?contentId=youtube%3AdQw4w9WgXcQ')
  await page.getByRole('button', { name: /^播放视频 / }).click()
  await expect.poll(() => page.evaluate(() => Boolean(window.__youtubeFixture))).toBe(true)
  const reads = () => page.evaluate(() => window.__youtubeFixture.reads)
  const change = (state: number) => page.evaluate(state => window.__youtubeFixture.change(state), state)
  const idle = await reads()
  await page.waitForTimeout(450)
  expect(await reads()).toBe(idle)
  await change(1)
  await expect.poll(reads).toBeGreaterThan(idle + 2)
  await change(2)
  const paused = await reads()
  await page.waitForTimeout(450)
  expect(await reads()).toBe(paused)
  await change(3)
  const buffering = await reads()
  await page.waitForTimeout(350)
  expect(await reads()).toBe(buffering)
  await change(1)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const hidden = await reads()
  await page.waitForTimeout(450)
  expect(await reads()).toBe(hidden)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(reads).toBeGreaterThan(hidden + 1)
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '下载', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__youtubeFixture.destroyed)).toBe(true)
  const disposed = await reads()
  await page.waitForTimeout(450)
  expect(await reads()).toBe(disposed)
  expect(errors).toEqual([])
})

test('Bilibili heartbeats avoid reconnects, recover stale clocks, and stop retrying while hidden', async ({ page }) => {
  await page.route('https://player.bilibili.com/player.html?**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Bilibili bridge fixture</title><script>
    window.connects = 0; window.respond = true;
    let peer, origin, token, id, sequence = 0;
    window.addEventListener('message', event => {
      if (event.data?.type !== 'tangentry:bilibili:connect') return;
      window.connects++; peer = event.source; origin = event.origin;
      token = event.data.token; id = event.data.id;
    });
    setInterval(() => {
      if (peer && window.respond) peer.postMessage({ type: 'tangentry:bilibili:clock', id, token,
        sequence: ++sequence, position: 5, duration: 120, paused: true }, origin);
    }, 500);
  </script>` }))
  await page.goto('/reader?video=BV17x411w7KC')
  await page.getByRole('button', { name: /^播放视频 / }).click()
  await page.getByRole('button', { name: '使用 B站官方播放器', exact: true }).click()
  const status = page.getByRole('status').filter({ hasText: '官方播放器时间已同步' })
  await expect(status).toBeVisible()
  const frame = page.frames().find(frame => frame.url().startsWith('https://player.bilibili.com/'))!
  await expect.poll(() => frame.evaluate(() => (window as unknown as { connects: number }).connects)).toBeGreaterThan(0)
  const connections = () => frame.evaluate(() => (window as unknown as { connects: number }).connects)
  const connected = await connections()
  await page.waitForTimeout(3200)
  expect(await connections()).toBe(connected)
  await frame.evaluate(() => { (window as unknown as { respond: boolean }).respond = false })
  await expect.poll(connections, { timeout: 7000 }).toBeGreaterThan(connected)
  await expect(status).toHaveCount(0)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const hidden = await connections()
  await page.waitForTimeout(1400)
  expect(await connections()).toBe(hidden)
  await frame.evaluate(() => { (window as unknown as { respond: boolean }).respond = true })
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(connections).toBeGreaterThan(hidden)
  await expect(status).toBeVisible()
})
