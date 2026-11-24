import { Button, Input } from '../../components/ui'
import { ChevronLeft, ChevronRight, LoaderCircle, Quote, RotateCw, StickyNote, TextSelect, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PageViewport, PDFDocumentProxy, RenderTask, TextLayer } from 'pdfjs-dist'
import type { PaperMetadata, PDFAnchor, ReadingNote } from '../../shared/api/types'
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { pdfSelection, viewportPDFRect } from './pdfAnchors'
import { pdfSummarySegments } from './pdfAnchors'
import { useSummary } from '../ai/useSummary'
import { SummaryControl } from '../ai/SummaryControl'
import { pdfSummaryPresentation } from '../ai/summaryPresentation'
import { AIInsights } from '../ai/AIInsights'
import { ReaderActions } from '../../shared/reader/ReaderActions'
import { useReadingNotebook } from '../../shared/reader/ReadingNotebook'
import './pdf.css'

export interface PDFAnnotationProps {
  notes?: ReadingNote[]
  focus?: { id: string; token: number } | null
  onQuote?: (text: string, anchor: PDFAnchor) => void
  onOpenNotes?: (ids: string[]) => void
  onUnresolved?: (ids: string[]) => void
}
interface RenderedPage { page: number; rotation: number; zoom: number; width: number; viewport: PageViewport; text: string }

// Additive deep link: "?page=N" opens the document at that page (used by the
// retrieval workbench to land on a hit). Absent or invalid keeps page 1.
function initialPageFromURL(): number {
  if (typeof window === 'undefined') return 1
  const raw = Number(new URLSearchParams(window.location.search).get('page'))
  return Number.isInteger(raw) && raw > 0 ? raw : 1
}

export function PDFReader({ id, contentId = id, paper, notes = [], focus, onQuote, onOpenNotes, onUnresolved }: { id: string; contentId?: string; paper?: PaperMetadata } & PDFAnnotationProps) {
  const notebook = useReadingNotebook()
  const navigatedFocus = useRef<{ id: string; token: number } | null>(null)
  const focusedLocation = useRef<{ id: string; token: number } | null>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(initialPageFromURL), [zoom, setZoom] = useState(1), [rotation, setRotation] = useState(0)
  const [width, setWidth] = useState(720), [busy, setBusy] = useState(true), [error, setError] = useState('')
  const [rendered, setRendered] = useState<RenderedPage | null>(null), [attempt, setAttempt] = useState(0)
  const [summaryPages, setSummaryPages] = useState<Array<{ page: number; text: string }>>([]), [textExtractionComplete, setTextExtractionComplete] = useState(false)
  const [selection, setSelection] = useState<PDFAnchor | null>(null), [selectionHint, setSelectionHint] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null), container = useRef<HTMLDivElement>(null), layer = useRef<HTMLDivElement>(null)
  const ready = !busy && !error && rendered?.page === page && rendered.rotation === rotation && rendered.zoom === zoom && rendered.width === width

  useEffect(() => {
    let active = true
    let destroy: (() => void) | undefined
    setDocument(null); setRendered(null); setError(''); setBusy(true); setPage(initialPageFromURL()); setSelection(null); setSummaryPages([]); setTextExtractionComplete(false)
    void import('pdfjs-dist').then(pdfjs => {
      if (!active) return
      pdfjs.GlobalWorkerOptions.workerSrc = workerURL
      const task = pdfjs.getDocument({ url: '/api/documents/' + encodeURIComponent(id) + '/file', enableXfa: false, cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' })
      destroy = () => { void task.destroy().catch(() => {}) }
      return task.promise.then(async value => {
        if (!active) return
        setDocument(value)
        setPage(current => Math.min(current, value.numPages))
        const pages: Array<{ page: number; text: string }> = []
        for (let number = 1; number <= value.numPages; number++) {
          const sheet = await value.getPage(number)
          const content = await sheet.getTextContent()
          pages.push({ page: number, text: content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('') })
        }
        if (active) { setSummaryPages(pages); setTextExtractionComplete(true) }
      })
    }).catch(() => { if (active) { setError('PDF 无法打开，文件可能损坏、加密或暂时不可用。可下载原文件后检查。'); setBusy(false) } })
    return () => { active = false; destroy?.() }
  }, [id, attempt])

  useEffect(() => {
    const node = container.current
    if (!node) return
    const observer = new ResizeObserver(entries => setWidth(Math.max(200, Math.min(900, entries[0].contentRect.width))))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!document || !canvas.current || !layer.current) return
    let active = true, task: RenderTask | undefined, textTask: TextLayer | undefined
    const node = canvas.current, textNode = layer.current
    setBusy(true); setError(''); setSelection(null); setSelectionHint('')
    textNode.replaceChildren()
    void document.getPage(page).then(async sheet => {
      if (!active) return
      const angle = (sheet.rotate + rotation) % 360
      const original = sheet.getViewport({ scale: 1, rotation: angle })
      const viewport = sheet.getViewport({ scale: Math.min(width / original.width, 2) * zoom, rotation: angle })
      const ratio = Math.min(devicePixelRatio || 1, 2)
      node.width = Math.ceil(viewport.width * ratio); node.height = Math.ceil(viewport.height * ratio)
      node.style.width = viewport.width + 'px'; node.style.height = viewport.height + 'px'
      textNode.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit))
      task = sheet.render({ canvas: node, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
      void task.promise.catch(() => {}) // Cancellation may happen before the text layer is ready.
      const content = await sheet.getTextContent()
      if (!active) return
      const pdfjs = await import('pdfjs-dist')
      if (!active) return
      textTask = new pdfjs.TextLayer({ textContentSource: content, container: textNode, viewport })
      await Promise.all([task.promise, textTask.render()])
      if (active) setRendered({ page, rotation, zoom, width, viewport, text: content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('') })
    }).catch(cause => { if (active && cause?.name !== 'RenderingCancelledException' && cause?.name !== 'AbortException') setError('这页暂时无法显示，请切换页面或重新打开原文件。') })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false; task?.cancel(); textTask?.cancel() }
  }, [document, page, zoom, rotation, width])

  const pdfNotes = useMemo(() => notes.filter(note => note.pdfAnchor), [notes])
  const valid = useMemo(() => pdfNotes.filter(note => note.pdfAnchor!.documentId === id && document && note.pdfAnchor!.page <= document.numPages), [pdfNotes, id, document])
  useEffect(() => {
    if (error) onUnresolved?.(pdfNotes.map(note => note.id))
    else if (document) onUnresolved?.(pdfNotes.filter(note => !valid.includes(note)).map(note => note.id))
  }, [document, error, pdfNotes, valid, onUnresolved])
  useEffect(() => {
    if (!focus || navigatedFocus.current?.id === focus.id && navigatedFocus.current.token === focus.token) return
    const note = valid.find(note => note.id === focus?.id)
    if (note) {
      navigatedFocus.current = focus
      setPage(note.pdfAnchor!.page)
    }
  }, [focus, valid])
  useEffect(() => {
    if (!focus || !ready || focusedLocation.current?.id === focus.id && focusedLocation.current.token === focus.token) return
    const button = container.current?.querySelector<HTMLElement>(`[data-pdf-note-id="${focus.id}"]`)
    if (!button) return
    focusedLocation.current = focus
    button.focus({ preventScroll: true })
    button.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  }, [focus, ready, rendered])

  const capture = () => {
    if (!ready || !layer.current || !rendered) { setSelection(null); return }
    const value = pdfSelection(layer.current, rendered.viewport, id, page)
    setSelection(value)
    const current = window.getSelection()
    setSelectionHint(!value && current?.anchorNode && layer.current.contains(current.anchorNode) && Array.from(current.toString().trim()).length > 2000 ? '一次批注最多选择 2000 字，请缩小选区。' : '')
  }
  useEffect(() => {
    globalThis.document.addEventListener('selectionchange', capture)
    return () => globalThis.document.removeEventListener('selectionchange', capture)
  }, [ready, rendered, page, id])
  const selectPage = () => {
    if (!ready || !layer.current) return
    const range = globalThis.document.createRange(); range.selectNodeContents(layer.current)
    const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range); capture()
  }
  const highlights = ready && rendered ? valid.filter(note => note.pdfAnchor!.page === page).map(note => ({ note, rects: note.pdfAnchor!.rects.map(rect => viewportPDFRect(rendered.viewport, rect)) })) : []
  const metadataText = paper ? [paper.title ? `标题：${paper.title}` : '', paper.authors.length ? `作者：${paper.authors.join('、')}` : '', paper.categories.length ? `分类：${paper.categories.join('、')}` : '', paper.abstract ? `摘要：${paper.abstract}` : '', paper.arxivId ? `arXiv：${paper.arxivId}${paper.version ? `v${paper.version}` : ''}` : ''].filter(Boolean).join('\n') : ''
  const summaryPagesWithMetadata = useMemo(() => metadataText && summaryPages.length ? summaryPages.map((value, index) => index === 0 ? { ...value, text: metadataText + '\n\n' + value.text } : value) : summaryPages, [metadataText, summaryPages])
  const summarySegments = useMemo(() => pdfSummarySegments(summaryPagesWithMetadata), [summaryPagesWithMetadata])
  const summary = useSummary(contentId, 'pdf', undefined, undefined, undefined, summarySegments)
  const pdfSummary = pdfSummaryPresentation(textExtractionComplete, summaryPagesWithMetadata.some(value => value.text.trim().length > 0))
  const locatePage = useCallback((target: number) => { if (target >= 1 && target <= (document?.numPages ?? 1)) setPage(target) }, [document])
  useEffect(() => {
    if (!notebook) return
    notebook.setAIContent(<AIInsights summary={summary} onLocatePage={locatePage} contentId={contentId} context={summaryPagesWithMetadata.map(value => value.text).join('\n')} revision={summary.inspection?.settings.revision ?? 0}/>)
    return () => notebook.setAIContent(null)
  }, [notebook, contentId, id, locatePage, summary.inspection, summary.loading, summary.pending, summary.error, summary.notice, summaryPagesWithMetadata])

  return <section className="pdf-reader" aria-label="PDF 阅读器" onMouseUp={event => { event.stopPropagation(); capture() }} onKeyUp={event => event.stopPropagation()}>
    <link rel="stylesheet" href="/pdfjs/text_layer.css" precedence="pdf-text-layer" />
    <div className="pdf-toolbar"><div><Button variant="quiet" iconOnly className="icon-button" aria-label="PDF 上一页" disabled={!document || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17}/></Button><label>页码<Input aria-label="PDF 页码" type="number" min={1} max={document?.numPages ?? 1} value={page} disabled={!document} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= (document?.numPages ?? 1)) setPage(value) }}/></label><span>/ {document?.numPages ?? '…'}</span><Button variant="quiet" iconOnly className="icon-button" aria-label="PDF 下一页" disabled={!document || page >= document.numPages} onClick={() => setPage(value => value + 1)}><ChevronRight size={17}/></Button></div><div><Button variant="quiet" iconOnly className="icon-button" aria-label="缩小 PDF" disabled={zoom <= .5} onClick={() => setZoom(value => Math.max(.5, value - .25))}><ZoomOut size={17}/></Button><span>{Math.round(zoom * 100)}%</span><Button variant="quiet" iconOnly className="icon-button" aria-label="放大 PDF" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .25))}><ZoomIn size={17}/></Button><Button variant="quiet" iconOnly className="icon-button" aria-label="旋转 PDF" onClick={() => setRotation(value => (value + 90) % 360)}><RotateCw size={17}/></Button></div></div>
    {(!pdfSummary.showControl || busy) && !error && <p className="field-hint" role="status"><LoaderCircle className="spin" size={14}/>{pdfSummary.loadingMessage || '正在读取 PDF 页面…'}</p>}
    {error && <div className="error-panel" role="alert"><p>{error}</p><Button variant="secondary" className="button button-secondary" onClick={() => setAttempt(value => value + 1)}>重新打开</Button></div>}
    <div ref={container} className="pdf-viewport" tabIndex={0} role="region" aria-label="PDF 页面，可滚动查看" aria-busy={!ready}>
      <div className="pdf-page" style={rendered ? { width: rendered.viewport.width, height: rendered.viewport.height } : undefined}>
        <canvas ref={canvas} aria-hidden="true" />
        <div ref={layer} className="textLayer" role="document" aria-label={'PDF 第 ' + page + ' 页文字'} style={{ visibility: ready ? 'visible' : 'hidden' }} />
        <div className="pdf-highlights">{highlights.map(({ note, rects }) => <div key={note.id} className="pdf-annotation" data-current={note.id === focus?.id}>
          {rects.map((rect, index) => <span key={index} className="pdf-highlight" aria-hidden="true" style={rect} data-pdf-highlight={note.id}/>)}
          <Button variant="quiet" className="pdf-annotation-button" data-pdf-note-id={note.id} aria-label={`查看 PDF 批注 第 ${page} 页 ${note.pdfAnchor!.quote.slice(0, 40)}`} style={{ left: Math.max(0, Math.min(rendered!.viewport.width - 28, rects[0].left + rects[0].width - 12)), top: Math.max(0, rects[0].top - 26) }} onClick={() => onOpenNotes?.([note.id])}><StickyNote size={14} aria-hidden="true"/></Button>
        </div>)}</div>
      </div>
    </div>
    {onQuote && ready && rendered?.text.trim() && <div className="pdf-selection-tools"><Button variant="secondary" className="button button-secondary" onClick={selectPage}><TextSelect size={15} aria-hidden="true"/>选择本页文字</Button><span>选中文字后，写下批注。</span></div>}
    {selection && onQuote && <div className="pdf-selection-tools"><Button variant="secondary" className="button button-secondary" onMouseDown={event => event.preventDefault()} onClick={() => { onQuote(selection.quote, selection); setSelection(null); window.getSelection()?.removeAllRanges() }}><Quote size={15} aria-hidden="true"/>引用 PDF 选区到批注</Button><span>第 {selection.page} 页 · {Array.from(selection.quote).length} 字 · 保存后保留高亮</span></div>}
    {selectionHint && <p className="field-hint" role="status">{selectionHint}</p>}
    {document && <details className="pdf-text"><summary>查看本页文字</summary><p>{!ready ? '正在读取本页文字…' : rendered?.text || '本页未检测到可提取文字，可能是扫描图片。'}</p></details>}
    {pdfSummary.showControl && !error && <ReaderActions><SummaryControl summary={summary} source={{ contentId: id, title: 'PDF 文档' }} emptyMessage={pdfSummary.emptyMessage} emptyAction={null}/></ReaderActions>}
  </section>
}
