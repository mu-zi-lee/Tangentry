import { afterEach, describe, expect, it, vi } from 'vitest'
import { APIError } from '../../shared/api/client'
import { defaultRetrievalSettings, maskRetrievalSettings } from './retrievalSettings'
import { loadRetrievalSettings, retrievalSettingsPayload, saveRetrievalSettings, settingsFromMasked } from './retrievalSettingsApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('settingsFromMasked', () => {
  it('maps the masked response to the form with empty write-only keys', () => {
    const settings = defaultRetrievalSettings()
    settings.apiKey = 'stored-secret'
    settings.rerankApiKey = 'rerank-secret'
    const masked = maskRetrievalSettings(settings)
    const form = settingsFromMasked(masked)
    expect(form.apiKey).toBe('')
    expect(form.rerankApiKey).toBe('')
    expect(form.model).toBe(settings.model)
    expect(form.dimensions).toBe(settings.dimensions)
    expect(JSON.stringify(form)).not.toContain('stored-secret')
    expect(JSON.stringify(form)).not.toContain('rerank-secret')
    expect(form).not.toHaveProperty('hasKey')
    expect(form).not.toHaveProperty('batchingMode')
  })
})

describe('retrievalSettingsPayload', () => {
  it('omits empty keys so the server keeps the stored ones', () => {
    const payload = retrievalSettingsPayload(defaultRetrievalSettings())
    expect(payload).not.toHaveProperty('apiKey')
    expect(payload).not.toHaveProperty('rerankApiKey')
    expect(payload.model).toBe('bge-m3')
  })

  it('sends a typed key once (write-only)', () => {
    const settings = defaultRetrievalSettings()
    settings.apiKey = 'new-key'
    const payload = retrievalSettingsPayload(settings)
    expect(payload.apiKey).toBe('new-key')
    expect(payload).not.toHaveProperty('rerankApiKey')
  })
})

describe('loadRetrievalSettings / saveRetrievalSettings', () => {
  it('loads the masked settings from the retrieval settings endpoint', async () => {
    const masked = maskRetrievalSettings(defaultRetrievalSettings())
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(masked), { status: 200 })))
    vi.stubGlobal('fetch', fetch)
    const result = await loadRetrievalSettings()
    expect(fetch).toHaveBeenCalledWith('/api/ai/retrieval/settings', expect.objectContaining({}))
    expect(result.model).toBe('bge-m3')
    expect(result.hasKey).toBe(false)
  })

  it('saves via PUT with the keyless payload and returns the masked response', async () => {
    const settings = defaultRetrievalSettings()
    settings.model = 'custom-model'
    settings.apiKey = 'typed-key'
    const masked = maskRetrievalSettings(settings)
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(masked), { status: 200 })))
    vi.stubGlobal('fetch', fetch)
    const result = await saveRetrievalSettings(settings)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/ai/retrieval/settings')
    expect(options.method).toBe('PUT')
    const body = JSON.parse(String(options.body))
    expect(body.model).toBe('custom-model')
    expect(body.apiKey).toBe('typed-key')
    expect(result.hasKey).toBe(true)
    expect(JSON.stringify(result)).not.toContain('typed-key')
  })

  it('surfaces validation failures as APIError', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: 'invalid_retrieval_settings', message: '向量维度必须是正整数。' }), { status: 400 }))))
    await expect(saveRetrievalSettings(defaultRetrievalSettings())).rejects.toBeInstanceOf(APIError)
  })
})
