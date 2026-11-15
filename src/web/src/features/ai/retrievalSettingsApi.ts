// Retrieval settings API: load/save B's embedding/rerank configuration. The
// server masks secrets (hasKey only); keys are write-only — an empty key is
// omitted from the save payload so the stored one is kept.

import { request } from '../../shared/api/client'
import type { MaskedRetrievalSettings, RetrievalSettings } from './retrievalSettings'

// settingsFromMasked maps the masked API response to the form shape. Keys
// never come back from the server, so the form starts with empty key fields.
export function settingsFromMasked(masked: MaskedRetrievalSettings): RetrievalSettings {
  const { hasKey, hasRerankKey, batchingMode, ...rest } = masked
  return { ...rest, apiKey: '', rerankApiKey: '' }
}

// retrievalSettingsPayload builds the save body: empty keys are omitted so
// the server keeps the stored ones; a typed key is sent once and never echoed.
export function retrievalSettingsPayload(settings: RetrievalSettings): Record<string, unknown> {
  const { apiKey, rerankApiKey, ...rest } = settings
  return {
    ...rest,
    ...(apiKey.trim() ? { apiKey } : {}),
    ...(rerankApiKey.trim() ? { rerankApiKey } : {}),
  }
}

export async function loadRetrievalSettings(): Promise<MaskedRetrievalSettings> {
  return request<MaskedRetrievalSettings>('/ai/retrieval/settings')
}

export async function saveRetrievalSettings(settings: RetrievalSettings): Promise<MaskedRetrievalSettings> {
  return request<MaskedRetrievalSettings>('/ai/retrieval/settings', {
    method: 'PUT',
    body: JSON.stringify(retrievalSettingsPayload(settings)),
  })
}
