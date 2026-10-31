import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppearancePreference } from './appearancePreference'
import { resetInterfacePreferenceQueue } from './interfacePreferences'

function setup(initial?: string, injected?: string) {
  const values = new Map(initial ? [['appearance', initial]] : [])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  })
  vi.stubGlobal('window', { __TANGENTRY_APPEARANCE__: injected ? { card_appearance: injected } : {} })
  const apply = vi.fn()
  const create = () => createAppearancePreference({
    key: 'card_appearance', storageKey: 'appearance', apply,
    validate: (raw: unknown) => ({ width: typeof (raw as { width?: unknown })?.width === 'number' ? (raw as { width: number }).width : 248 }),
  })
  return { values, apply, create, store: create() }
}

function result(value: string, saved = true) {
  return new Response(JSON.stringify({ key: 'card_appearance', value, saved }), { status: 200 })
}

describe('stable appearance preferences', () => {
  afterEach(() => { vi.unstubAllGlobals(); resetInterfacePreferenceQueue() })

  it('reads the injected preference before stale origin storage without a startup request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { store } = setup('{"width":180}', '{"width":420}')
    expect(store.read()).toEqual({ width: 420 })
    await store.hydrate()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('migrates an existing local preference once without persisting an untouched default', async () => {
    const writes: string[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') writes.push(JSON.parse(String(options.body)).value)
      return Promise.resolve(result('', false))
    }))
    const { store } = setup('{"width":320}')
    await Promise.all([store.hydrate(), store.hydrate()])
    expect(writes).toEqual(['{"width":320}'])
    const blank = setup().store
    await blank.hydrate()
    expect(writes).toHaveLength(1)
  })

  it('restores saved appearance on a new origin with empty local storage', async () => {
    let saved = ''
    vi.stubGlobal('fetch', vi.fn((_url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') saved = JSON.parse(String(options.body)).value
      return Promise.resolve(result(saved, !!saved))
    }))
    const first = setup()
    first.store.change({ width: 360 })
    const restarted = setup()
    expect(restarted.store.read()).toEqual({ width: 248 })
    await restarted.store.hydrate()
    expect(restarted.store.read()).toEqual({ width: 360 })
    expect(restarted.apply).toHaveBeenCalledWith({ width: 360 })
    expect(restarted.values.get('appearance')).toBe('{"width":360}')
  })

  it('does not overwrite a newer selection with a slow hydration response', async () => {
    let resolveRead: (response: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn((_url: string, options?: RequestInit) => options?.method === 'PUT'
      ? Promise.resolve(result(JSON.parse(String(options.body)).value))
      : new Promise<Response>(resolve => { resolveRead = resolve })))
    const { store } = setup()
    const hydration = store.hydrate()
    store.change({ width: 420 })
    resolveRead(result('{"width":180}'))
    await hydration
    expect(store.read()).toEqual({ width: 420 })
  })

  it('persists and applies changes even when local storage is unavailable', async () => {
    const { store, apply } = setup()
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    const fetch = vi.fn(() => Promise.resolve(result('{"width":300}')))
    vi.stubGlobal('fetch', fetch)
    store.change({ width: 300 })
    expect(apply).toHaveBeenCalledWith({ width: 300 })
    expect(fetch.mock.calls[0]).toMatchObject(['/api/preferences/card_appearance', { method: 'PUT', keepalive: true }])
  })
})
