import { useState } from 'react'
import { ChevronDown, LoaderCircle } from 'lucide-react'
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
    <div className="retrieval-context" aria-label={`第 ${data.page} 页上下文`}>
      <p className="retrieval-context-text">
        {window.truncatedBefore && <span className="retrieval-context-cut">…</span>}
        {window.before}
        <mark className="retrieval-mark">{window.hit}</mark>
        {window.after}
        {window.truncatedAfter && <span className="retrieval-context-cut">…</span>}
      </p>
      <p className="retrieval-context-note">
        第 {data.page} / {data.totalPages} 页
        {data.extractor === 'local-paddleocr' && ' · 本页文本由 OCR 识别，可能有识别错误'}
      </p>
    </div>
  )
}

/**
 * PassageContext loads one stored PDF page on demand and shows the text around
 * the hit. It reads what retrieval reads, so OCR-derived documents show the
 * recognised text (their PDF text layer is unusable).
 */
export function PassageContext({ contentId, page, startRune, endRune }: {
  contentId: string
  page: number
  startRune: number
  endRune: number
}) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<PageText | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const toggle = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (data || loading) return
    setLoading(true)
    setError('')
    try {
      const value = await request<PageText>(`/library/${encodeURIComponent(contentId)}/page-text?page=${page}`)
      setData(value)
    } catch (cause) {
      setError(cause instanceof APIError ? cause.message : '这一页的原文暂时读不到。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="retrieval-context-wrap">
      <button type="button" className="retrieval-context-toggle" aria-expanded={open} onClick={() => void toggle()}>
        <ChevronDown size={13} strokeWidth={2} aria-hidden="true" className={open ? 'is-open' : undefined}/>
        {open ? '收起上下文' : '展开上下文'}
      </button>
      {open && loading && (
        <p className="retrieval-context-note" role="status">
          <LoaderCircle size={13} strokeWidth={2} aria-hidden="true"/> 正在读取第 {page} 页…
        </p>
      )}
      {open && error && <p className="retrieval-context-error" role="alert">{error}</p>}
      {open && data && <ContextBody data={data} startRune={startRune} endRune={endRune}/>}
    </div>
  )
}