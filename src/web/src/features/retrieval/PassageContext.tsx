import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { APIError, request } from '../../shared/api/client'
import { contextWindow } from './workbench'

interface PageText {
  page: number
  text: string
  totalPages: number
  extractor: string
  extractorVersion: string
}

/** Renders the stored page text around a hit, so the passage is visible in context. */
export function ContextBody({ data, startRune, endRune }: { data: PageText; startRune: number; endRune: number }) {
  const window = contextWindow(data.text, startRune, endRune)
  return (
    <div className="retrieval-context" aria-label={`Context on page ${data.page}`}>
      <p className="retrieval-context-text">
        {window.truncatedBefore && <span className="retrieval-context-cut">…</span>}
        {window.before}
        <mark className="retrieval-mark">{window.hit}</mark>
        {window.after}
        {window.truncatedAfter && <span className="retrieval-context-cut">…</span>}
      </p>
      <p className="retrieval-context-note">
        Page {data.page} of {data.totalPages}
        {data.extractor === 'local-paddleocr' && ' · this page was recognised by OCR and may contain errors'}
      </p>
    </div>
  )
}

/**
 * PassageContext loads one stored PDF page and shows the text around the hit.
 * It mounts only when a card asks for it, so a long result list pays nothing
 * until the reader opens one. It reads what retrieval reads, so OCR-derived
 * documents show the recognised text (their PDF text layer is unusable).
 */
export function PassageContext({ contentId, page, startRune, endRune }: {
  contentId: string
  page: number
  startRune: number
  endRune: number
}) {
  const [data, setData] = useState<PageText | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setError('')
    void request<PageText>(`/library/${encodeURIComponent(contentId)}/page-text?page=${page}`)
      .then(value => { if (active) setData(value) })
      .catch(cause => { if (active) setError(cause instanceof APIError ? cause.message : 'This page cannot be read right now.') })
    return () => { active = false }
  }, [contentId, page])

  if (error) return <p className="retrieval-context-error" role="alert">{error}</p>
  if (!data) {
    return <p className="retrieval-context-note" role="status">
      <LoaderCircle size={13} strokeWidth={2} aria-hidden="true"/> Reading page {page}…
    </p>
  }
  return <ContextBody data={data} startRune={startRune} endRune={endRune}/>
}
