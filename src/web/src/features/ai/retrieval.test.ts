import { describe, expect, it } from 'vitest'
import { defaultRetrievalRequest, retrievalRequestFragment, RETRIEVAL_SCHEMA_VERSION } from './retrieval'
import { buildChatContext } from './chatContext'

describe('retrievalRequestFragment (B-T01 frontend)', () => {
  it('is empty when retrieval is off, keeping the legacy body byte-compatible', () => {
    expect(retrievalRequestFragment(false)).toEqual({})
    expect(JSON.stringify(retrievalRequestFragment(false))).toBe('{}')
    // The legacy context builder is untouched and still used when off.
    expect(buildChatContext('正文', '概览')).toBe('概览\n\n正文')
  })

  it('omits the retrieval key entirely when off (no field-set change)', () => {
    const legacyBody = { contentId: 'rss:x', context: 'c', messages: [], revision: 1 }
    const withOff = { ...legacyBody, ...retrievalRequestFragment(false) }
    expect(Object.keys(withOff)).toEqual(Object.keys(legacyBody))
    expect('retrieval' in withOff).toBe(false)
  })

  it('sends the namespaced retrieval object when on', () => {
    const fragment = retrievalRequestFragment(true)
    expect(fragment.retrieval).toBeDefined()
    expect(fragment.retrieval?.schemaVersion).toBe(RETRIEVAL_SCHEMA_VERSION)
    expect(fragment.retrieval?.enabled).toBe(true)
    expect(fragment.retrieval?.mode).toBe('hybrid')
    expect(fragment.retrieval?.maxChars).toBe(120000)
    expect(fragment.retrieval?.embeddingBudget).toEqual({ batchingMode: 'shared', maxRequests: 24, maxChars: 100000, sweepCandidates: 90 })
    expect(fragment.retrieval?.rerankBudget).toEqual({ maxRequests: 0 })
  })

  it('forces enabled and schemaVersion on a custom request', () => {
    const custom = defaultRetrievalRequest()
    custom.enabled = false
    custom.mode = 'lexical'
    const fragment = retrievalRequestFragment(true, custom)
    expect(fragment.retrieval?.enabled).toBe(true)
    expect(fragment.retrieval?.mode).toBe('lexical')
    expect(fragment.retrieval?.schemaVersion).toBe(RETRIEVAL_SCHEMA_VERSION)
  })
})