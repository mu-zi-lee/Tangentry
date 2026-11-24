// Bundled starter library API and presentation. The server owns presence and
// seeding state; this module only describes it and never assumes a sample is
// installed.

import { request } from '../../shared/api/client'

export interface SamplesItem {
  id: string
  title: string
  source: string
  note: string
  present: boolean
}

export interface SamplesStatus {
  enabled: boolean
  seeded: boolean
  items: SamplesItem[]
}

export async function loadSamples(): Promise<SamplesStatus> {
  return request<SamplesStatus>('/samples')
}

export async function setSamplesEnabled(enabled: boolean): Promise<SamplesStatus> {
  return request<SamplesStatus>('/samples', { method: 'PUT', body: JSON.stringify({ enabled }) })
}

export async function loadSamplesNow(): Promise<SamplesStatus> {
  return request<SamplesStatus>('/samples/load', { method: 'POST' })
}

export async function removeSamples(): Promise<SamplesStatus> {
  return request<SamplesStatus>('/samples', { method: 'DELETE' })
}

/** Present/total counts for the section summary. */
export function samplesCounts(status: SamplesStatus | null): { present: number; total: number } {
  if (!status) return { present: 0, total: 0 }
  return { present: status.items.filter(item => item.present).length, total: status.items.length }
}

/** One-line state used by the section header. */
export function samplesSummary(status: SamplesStatus | null): string {
  if (!status) return '状态未知'
  const { present, total } = samplesCounts(status)
  if (total === 0) return '没有可用的示例资料'
  if (present === total) return `已载入 ${present} 份`
  if (present === 0) return status.enabled ? '尚未载入，将在资料库为空时自动载入' : '尚未载入'
  return `已载入 ${present} / ${total} 份`
}

/** A removal needs confirmation because it deletes library items. */
export function canRemoveSamples(status: SamplesStatus | null): boolean {
  return samplesCounts(status).present > 0
}

/** Loading is offered whenever something is missing. */
export function canLoadSamples(status: SamplesStatus | null): boolean {
  const { present, total } = samplesCounts(status)
  return total > 0 && present < total
}