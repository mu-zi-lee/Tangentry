import { Button, Input, Select } from '../../components/ui'
import { BookOpen, Check, ChevronUp, Clock3, Copy, LoaderCircle, MoreHorizontal, Pencil, Plus, RotateCw, Search, StickyNote, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { ReadingNote, TextAnchor, PDFAnchor, SubtitleReference, SubtitleTrack } from '../../shared/api/types'
import { subtitleTrackHash } from '../../shared/media/subtitleSource'
import type { FrameCapture } from '../../shared/media/types'
import { useNotes } from './useNotes'
import { capturePosition, formatPosition } from './noteTime'
import { readDraft } from './noteDraft'
import { useReadingNotebook } from '../../shared/reader/ReadingNotebook'
import { MarkdownBody } from './MarkdownBody'
import { SubtitleReferences } from './SubtitleReferences'
import { subtitleReferenceValid, sameSubtitleReference } from './subtitleReferenceData'
import { noteCopyText, notePresentation } from './notePresentation'
import { NoteExport } from './NoteExport'
import { parseTags, tagValidation } from './TagInput'
import { filterNotes, linkedNote, readNoteOrder, type NoteOrder } from './noteFiltering'
import './notes.css'
import { useNoteDraft } from './useNoteDraft'
import { NoteLocation, NoteRecords } from './NoteRecords'
import { NoteComposer } from './NoteComposer'
import { useNoteNavigation } from './useNoteNavigation'

export { formatPosition } from './noteTime'

export interface NoteTarget { contentId: string; positionSeconds?: number; quote?: string; textAnchor?:TextAnchor; pdfAnchor?:PDFAnchor; subtitleReference?: SubtitleReference; token: number }
export interface NoteEditRequest { id: string; token: number }


export function NotesPanel({ contentId, linkedNoteId = '', captureActionRef, editRequest, target, subtitleTrack, onSeek, onPreparePlayback, getPosition, getDownloadID, captureFrame: captureScreen, playbackHint, playbackPosition = null, onNotesChange, onJumpText, onJumpPDF, unresolvedAnchorIds = [], activeNoteIds = [] }: {
  contentId: string; linkedNoteId?: string; editRequest?: NoteEditRequest | null; target: NoteTarget | null; onSeek?: (position: number) => boolean | void
  /** Imperative capture entry used by buttons so getDisplayMedia keeps user activation. */
  captureActionRef?: MutableRefObject<(() => void) | null>
  subtitleTrack?: SubtitleTrack | null
  onPreparePlayback?: () => boolean
  onNotesChange?:(notes:ReadingNote[])=>void; onJumpText?:(id:string, fromLink?:boolean)=>void; onJumpPDF?:(id:string)=>void; unresolvedAnchorIds?:string[]; activeNoteIds?:string[]
  getPosition?: () => number | null; playbackHint?: string; playbackPosition?: number | null
  getDownloadID?: () => string | null
  captureFrame?: () => Promise<FrameCapture>
}) {
  const notes = useNotes(contentId)
  const sourceVersion = useMemo(() => subtitleTrack ? { language: subtitleTrack.language, hash: subtitleTrackHash(subtitleTrack) } : null, [subtitleTrack])
  const captureFrame = async (note: ReadingNote, seconds: number) => {
    const downloadId = getDownloadID?.()
    if (!downloadId) { setNotice('请先选择可用的本机视频。'); return }
    if (await notes.frame(note, { downloadId, positionSeconds: seconds })) setNotice('已新增一张画面。')
  }
  const captureNoteFrame = (note: ReadingNote) => {
    const seconds = note.positionSeconds ?? note.subtitleReferences?.[0]?.start ?? capturePosition(getPosition?.())
    if (seconds === null) { setNotice('请先定位到本机视频的播放位置，再保存画面。'); return }
    void captureFrame(note, seconds)
  }
  const captureCurrentFrame = async (note: ReadingNote) => {
    if (!captureScreen || capturing || notes.pending) return
    setCapturing(true)
    try {
      const { frame } = await captureScreen()
      const saved = await notes.frame(note, undefined, { data: frame.data, positionSeconds: frame.positionSeconds })
      if (saved) setNotice('已新增一张画面。')
    } catch (error) { setNotice(error instanceof Error ? error.message : '截屏失败，请重试。') }
    finally { setCapturing(false) }
  }
  const notebook = useReadingNotebook()
  useEffect(() => {
    if (linkedNoteId) notebook?.showNotes()
  }, [linkedNoteId, notebook])
  const draftState = useNoteDraft(contentId)
  const { draft, setDraft, currentDraft, recoverable, backupFailed, backupNotice, clearDraft: clearStoredDraft, deleteBackup, restoreDraft, persistRetry } = draftState
  const handledEditRequest = useRef<NoteEditRequest | null>(null)
  const [notice, setNotice] = useState('')
  const [validationError, setValidationError] = useState('')
  const [conflictVersion, setConflictVersion] = useState<ReadingNote | null>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const focusTags = useRef(false)
  const composerKey = `tangentry.note-composer.${contentId}`
  // Long-form writing reopens as it was left when returning to this content.
  const [expandedWriting, setExpandedWriting] = useState(() => {
    try { return sessionStorage.getItem(composerKey + '.expanded') === 'true' }
    catch { return false }
  })
  const [composerOpen, setComposerOpen] = useState(() => {
    try { return sessionStorage.getItem(composerKey) !== 'closed' }
    catch { return true }
  })
  const composeButton = useRef<HTMLButtonElement>(null)
  const focusComposer = useRef<'open' | 'capture' | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'linked' | 'free'>('all')
  const [order, setOrder] = useState<NoteOrder>(readNoteOrder)
  useEffect(() => {
    try { localStorage.setItem('tangentry.note-order.v1', order) }
    catch { /* Sorting still works when browser storage is unavailable. */ }
  }, [order])
  const [tag, setTag] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyAttempt = useRef(0)
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTarget = useRef<NoteTarget | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const actionsButton = useRef<HTMLButtonElement>(null)
  const actionsId = useId()
  const count = Array.from(draft.body).length
  const excerpt = draft.textAnchor?.quote ?? draft.pdfAnchor?.quote ?? draft.subtitleReferences?.[0]?.text ?? ''
  const saveBody = draft.body.trim() ? draft.body : excerpt ? '> ' + excerpt.replaceAll('\n', '\n> ') : ''
  const saveCount = Array.from(saveBody).length
  const unavailable = notes.loading || Boolean(notes.readError) || notes.pending
  const showTime = Boolean(playbackHint || playbackPosition !== null || draft.positionSeconds !== null || /^(bilibili|youtube|douyin|xiaoyuzhou):/.test(contentId))
  const hasDraft = Boolean(draft.body || draft.tags || draft.positionSeconds !== null || draft.editingId || draft.textAnchor || draft.pdfAnchor || draft.subtitleReferences?.length || draft.images?.length)
  const [capturing, setCapturing] = useState(false)
  const visibleNotes = useMemo(() => filterNotes(notes.notes, query, filter, tag, order, unresolvedAnchorIds), [notes.notes, query, filter, tag, order, unresolvedAnchorIds])
  const linkedCount = notes.notes.filter(linkedNote).length
  const resetFilters = useCallback(() => { setQuery(''); setFilter('all'); setTag('') }, [])

  useLayoutEffect(() => {
    const node = editor.current
    if (!composerOpen || preview || !focusComposer.current || !node) return
    const request = focusComposer.current
    focusComposer.current = null
    node.focus({ preventScroll: true })
    if (request === 'capture') node.scrollIntoView({ block: 'center' })
  }, [composerOpen, preview, draft])

  useEffect(() => {
    if (!editRequest || handledEditRequest.current === editRequest || unavailable) return
    handledEditRequest.current = editRequest
    const note = notes.notes.find(value => value.id === editRequest.id && value.contentId === contentId)
    if (!note) {
      setNotice('这条笔记已删除或不属于当前内容，其他笔记仍可查看。')
      return
    }
    if (hasDraft) {
      focusComposer.current = 'capture'
      setComposerOpen(true)
      setPreview(false)
      if (draft.editingId !== note.id) setNotice('当前草稿已保留，请先保存或清空，再选择要编辑的笔记。')
      requestAnimationFrame(() => {
        editor.current?.focus({ preventScroll: true })
        editor.current?.scrollIntoView({ block: 'center' })
      })
      return
    }
    edit(note)
  }, [editRequest, unavailable, notes.notes, contentId, hasDraft, draft.editingId])

  useLayoutEffect(() => {
    if (!focusTags.current || !tagsOpen) return
    focusTags.current = false
    document.getElementById('note-tags')?.focus({ preventScroll: true })
  }, [tagsOpen])

  useEffect(() => () => { ++copyAttempt.current; if (copyTimeout.current) clearTimeout(copyTimeout.current) }, [])
  useEffect(() => {
    try { sessionStorage.setItem(composerKey, composerOpen ? 'open' : 'closed'); sessionStorage.setItem(composerKey + '.expanded', String(expandedWriting)) }
    catch { /* Notebook visibility must not depend on optional browser storage. */ }
  }, [composerKey, composerOpen, expandedWriting])

  useEffect(() => { onNotesChange?.(notes.notes) }, [notes.notes, onNotesChange])
  const { linkedHighlight } = useNoteNavigation({
    contentId,
    linkedNoteId,
    notes: notes.notes,
    loading: notes.loading,
    readError: notes.readError,
    visibleNotes,
    activeNoteIds,
    resetFilters,
    onNotice: setNotice,
    onJumpText,
    onJumpPDF,
    onSeek,
    onPreparePlayback,
  })

  function clearDraft() {
    setConflictVersion(null)
    setExpandedWriting(false)
    document.getElementById('note-composer')?.scrollTo({ top: 0 })
    clearStoredDraft()
  }

  useEffect(() => {
    if (target?.contentId !== contentId || lastTarget.current === target || notes.pending) return
    lastTarget.current = target
    notebook?.showNotes()
    if (notebook && window.matchMedia('(max-width:760px)').matches) setExpandedWriting(true)
    focusComposer.current = 'capture'
    setComposerOpen(true)
    if (target.subtitleReference) {
      const references = currentDraft.current.subtitleReferences ?? []
      const reference = target.subtitleReference
      if (!subtitleReferenceValid(reference) || references.length >= 20 && !references.some(other => sameSubtitleReference(other, reference)) || references.reduce((total, value) => total + Array.from(value.text).length, 0) + (references.some(other => sameSubtitleReference(other, reference)) ? 0 : Array.from(reference.text).length) > 8000 || currentDraft.current.textAnchor || currentDraft.current.pdfAnchor) {
        setNotice('这段无法加入：每条最多 20 段、共 8000 字，且不能混合文章或 PDF 摘录。')
        return
      }
    }
    if (currentDraft.current.subtitleReferences?.length && (target.textAnchor || target.pdfAnchor)) {
      setNotice('请先保存字幕摘录，再新建文章或 PDF 批注。')
      return
    }
    const keepTime = currentDraft.current.positionSeconds !== null || currentDraft.current.timeDetached || Boolean(currentDraft.current.editingId)
    setDraft(current => {
      const currentQuote = current.textAnchor?.quote ?? current.pdfAnchor?.quote
      const separateExcerpt = Boolean(target.textAnchor || target.pdfAnchor) && (!currentQuote || currentQuote === target.quote)
      const timeProtected = current.positionSeconds !== null || current.timeDetached || Boolean(current.editingId)
      const positionSeconds = timeProtected ? current.positionSeconds : capturePosition(target.positionSeconds ?? getPosition?.())
      const references = current.subtitleReferences ?? []
      const subtitleReferences = target.subtitleReference && !references.some(reference => sameSubtitleReference(reference, target.subtitleReference!)) ? [...references, target.subtitleReference] : references
      return { ...current, subtitleReferences, textAnchor:current.textAnchor??(current.pdfAnchor?null:target.textAnchor??null), pdfAnchor:current.pdfAnchor??(current.textAnchor?null:target.pdfAnchor??null), positionSeconds, body:target.quote && !separateExcerpt?[current.body, '> '+target.quote.replaceAll('\n','\n> ')+'\n\n'].filter(Boolean).join('\n\n'):current.body }
    })
    setPreview(false)
    setValidationError('')
    setNotice(target.subtitleReference ? '已保留字幕原句与时间，已有正文和关联时间不变。' : target.quote?((draft.textAnchor||draft.pdfAnchor)&&(target.textAnchor||target.pdfAnchor)?'原文关联保留在第一处选区。':''):keepTime?'草稿与原关联时间已保留。需要换时间时，请主动关联当前播放时间。':'已关联播放时间，正文草稿保留。')
  }, [target, contentId, notes.pending, getPosition, notebook])

  async function save() {
    if (unavailable) return
    setValidationError('')
    setNotice('')
    if (tagValidation(draft.tags ?? '')) {
      document.getElementById('note-tags')?.focus()
      return
    }
    if (!saveBody.trim() || saveCount > 8000) {
      setValidationError('请填写 1–8000 字的笔记。')
      editor.current?.focus()
      return
    }
    if (draft.editingId && draft.expectedUpdatedAt === undefined) {
      setValidationError('这份旧草稿没有编辑版本，请另存为新笔记以保留内容。')
      return
    }
    const position = draft.positionSeconds ?? (draft.editingId || draft.timeDetached ? null : capturePosition(getPosition?.()))
    let prepared = draft
    if (!draft.editingId) {
      const seconds = position ?? draft.subtitleReferences?.[0]?.start
      let frameSpec = draft.captureFrame && !draft.images?.length ? draft.frameSpec : undefined
      if (draft.captureFrame && !draft.images?.length && !frameSpec) {
        const downloadId = getDownloadID?.()
        if (!downloadId || seconds === undefined || seconds === null) {
          setValidationError('请先选择本机视频并关联时间，或取消保存画面。')
          return
        }
        frameSpec = { downloadId, positionSeconds: seconds }
      }
      prepared = { ...draft, createId: draft.createId ?? crypto.randomUUID().replaceAll('-', ''), positionSeconds: position, timeDetached: true, frameSpec }
      // Persist the retry identity before sending, including the selected file/time.
      currentDraft.current = prepared
      setDraft(prepared)
      persistRetry(prepared)
    }
    const images = prepared.images ?? []
    const firstImage = images[0]
    const image = firstImage ? { data: firstImage.data, positionSeconds: firstImage.positionSeconds } : undefined
    const creationImages = !prepared.editingId ? images.map(item => ({ data: item.data, positionSeconds: item.positionSeconds })) : undefined
    const saved = await notes.save(saveBody, position, prepared.editingId, prepared.textAnchor ?? null, prepared.pdfAnchor ?? null, prepared.tags === undefined && prepared.editingId ? undefined : parseTags(prepared.tags ?? ''), prepared.expectedUpdatedAt, 'save', prepared.subtitleReferences ?? [], !prepared.editingId && prepared.createId ? { createId: prepared.createId, frame: prepared.captureFrame && !image ? prepared.frameSpec : undefined, image, images: creationImages } : undefined)
    if (saved) {
      // New notes send every draft capture atomically; only edits need append calls.
      let attached = true
      let remaining = prepared.editingId ? images : []
      let latestNote = saved
      for (const pendingImage of remaining) {
        if (!attached) break
        const updated = await notes.frame(latestNote, undefined, { data: pendingImage.data, positionSeconds: pendingImage.positionSeconds })
        attached = Boolean(updated)
        if (updated) {
          latestNote = updated
          prepared = { ...prepared, images: remaining.slice(remaining.indexOf(pendingImage) + 1), expectedUpdatedAt: updated.updatedAt }
          remaining = prepared.images ?? []
        }
      }
      if (attached) clearDraft()
      else {
        const unsavedImages = remaining
        prepared = { ...prepared, images: unsavedImages }
        currentDraft.current = prepared
        setDraft(prepared)
      }
      if (notebook && window.matchMedia('(max-width:760px)').matches) setExpandedWriting(false)
      setPreview(false)
      setQuery('')
      setFilter('all')
      setTag('')
      setNotice(attached ? images.length ? '笔记和截屏已保存。' : '笔记已保存。' : '笔记已保存，部分截屏没有保存；剩余截屏仍保留在草稿中。')
      requestAnimationFrame(() => {
        const node = editor.current
        if (document.activeElement === document.body || node?.closest('form')?.contains(document.activeElement)) node?.focus({ preventScroll: true })
      })
    }
  }

  function edit(note: ReadingNote) {
    focusComposer.current = 'capture'
    setComposerOpen(true)
    if (notebook && window.matchMedia('(max-width:760px)').matches) setExpandedWriting(true)
    setConflictVersion(null)
    setDraft({ expectedUpdatedAt: note.updatedAt, tags: (note.tags ?? []).join(', '), body: notePresentation(note).body, positionSeconds: note.positionSeconds, editingId: note.id, textAnchor: note.textAnchor ?? null, pdfAnchor: note.pdfAnchor ?? null, subtitleReferences: note.subtitleReferences ?? [] })
    setPreview(false)
    setNotice('')
    setValidationError('')
  }

  function changeBody(body: string) {
    setDraft(current => ({ ...current, body, positionSeconds: !current.editingId && !current.timeDetached && !current.body.trim() && current.positionSeconds === null ? capturePosition(getPosition?.()) : current.positionSeconds }))
    setNotice(''); setValidationError('')
  }

  async function reviewConflict() {
    const requestedDraft = currentDraft.current
    setNotice('')
    setConflictVersion(null)
    const latest = await notes.reload()
    if (!latest || currentDraft.current !== requestedDraft) return
    const saved = latest.find(note => note.id === requestedDraft.editingId)
    setConflictVersion(saved ?? null)
    setNotice(saved ? '已读取最新笔记，当前草稿仍保留。' : '这条笔记已不存在，可将草稿另存为新笔记。')
  }

  async function copyText(text: string, id: string, message: string) {
    const attempt = ++copyAttempt.current
    try {
      await navigator.clipboard.writeText(text)
      if (attempt !== copyAttempt.current) return
      setCopiedId(id)
      setNotice(message)
      if (copyTimeout.current) clearTimeout(copyTimeout.current)
      copyTimeout.current = setTimeout(() => setCopiedId(null), 2000)
    } catch {
      if (attempt === copyAttempt.current) setNotice('无法复制笔记，请选中文字复制。')
    }
  }

  function copyNote(note: ReadingNote) {
    return copyText(noteCopyText(note), note.id, '笔记已复制。')
  }

  function copySourceNotes() {
    const text = '# 本篇笔记\n\n' + notes.notes.map((note, index) => {
      const position = note.positionSeconds === null ? '' : ' · ' + formatPosition(note.positionSeconds)
      const page = note.pdfAnchor ? ' · PDF 第 ' + note.pdfAnchor.page + ' 页' : ''
      const tags = note.tags?.length ? '\n\n标签：' + note.tags.map(value => '#' + value).join(' ') : ''
      return `## 笔记 ${index + 1}${position}${page}\n\n${noteCopyText(note)}${tags}`
    }).join('\n\n---\n\n')
    return copyText(text, 'source', `已复制本篇 ${notes.notes.length} 条笔记。`)
  }

  function openComposer() {
    notebook?.showNotes()
    if (notebook && window.matchMedia('(max-width:760px)').matches) setExpandedWriting(true)
    focusComposer.current = 'open'
    setComposerOpen(true)
    setPreview(false)
  }

  function closeComposer() {
    focusComposer.current = null
    setComposerOpen(false)
    setExpandedWriting(false)
    composeButton.current?.focus({ preventScroll: true })
  }

  function openTags() {
    focusTags.current = true
    setTagsOpen(true)
  }

  function discardDraft() {
    focusComposer.current = 'open'
    clearDraft()
    setTagsOpen(false)
    setValidationError('')
    setNotice('')
  }

  async function screenshot() {
    if (!captureScreen || capturing || notes.pending) return
    setCapturing(true); setNotice(''); setValidationError('')
    try {
      const { frame, context } = await captureScreen()
      const image = { data: frame.data, width: frame.width, height: frame.height, positionSeconds: frame.positionSeconds }
      const current = currentDraft.current
      const images = current.images ?? (current.image ? [current.image] : [])
      if (images.length >= 10) { setNotice('一个草稿最多保存 10 张截屏。'); return }
      const references = current.subtitleReferences ?? []
      const total = references.reduce((sum, reference) => sum + Array.from(reference.text).length, 0)
      const contextAdded = Boolean(!current.textAnchor && !current.pdfAnchor && context && subtitleReferenceValid(context) && !references.some(reference => sameSubtitleReference(reference, context)) && references.length < 20 && total + Array.from(context.text).length <= 8000)
      const keepTime = current.positionSeconds !== null || Boolean(current.editingId)
      const next = { ...current, image: undefined, images: [...images, image], captureFrame: false, frameSpec: undefined, subtitleReferences: contextAdded && context ? [...references, context] : references, positionSeconds: keepTime ? current.positionSeconds : Math.floor(frame.positionSeconds), timeDetached: false }
      currentDraft.current = next
      setDraft(next)
      notebook?.showNotes()
      focusComposer.current = 'capture'
      setComposerOpen(true)
      setPreview(false)
      setNotice(`已将第 ${images.length + 1} 张截屏加入草稿 · ${formatPosition(frame.positionSeconds)}${contextAdded ? '，并带上了当时的字幕原句' : ''}。写下想法后保存。`)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '暂时无法截屏，请稍后重试。')
    } finally { setCapturing(false) }
  }
  const screenshotRef = useRef(screenshot)
  screenshotRef.current = screenshot
  useEffect(() => {
    if (!captureActionRef) return
    captureActionRef.current = () => { void screenshotRef.current() }
    return () => { if (captureActionRef.current) captureActionRef.current = null }
  }, [captureActionRef])
  useEffect(() => {
    if (!captureScreen) return
    const shortcut = (event: KeyboardEvent) => {
      if (event.altKey && !event.metaKey && !event.ctrlKey && event.code === 'KeyS') { event.preventDefault(); void screenshotRef.current() }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [captureScreen])

  function attachCurrentTime() {
    const position = capturePosition(getPosition?.())
    if (position === null) {
      setNotice(playbackHint || '播放器就绪后才能关联当前时间。')
      return
    }
    setDraft(current => ({ ...current, positionSeconds: position, timeDetached: false }))
    setNotice('')
  }

  function detachExcerpt() {
    setDraft(current => ({ ...current, body: noteCopyText(current), textAnchor: null, pdfAnchor: null }))
  }

  const composer = <NoteComposer open={composerOpen} draft={draft} setDraft={setDraft} contentId={contentId} sourceVersion={sourceVersion} pending={notes.pending} unavailable={unavailable} excerpt={excerpt} saveBody={saveBody} saveCount={saveCount} count={count} backupFailed={backupFailed} validationError={validationError} preview={preview} onPreviewChange={setPreview} editor={editor} onChangeBody={changeBody} onSave={() => void save()} showTime={showTime} playbackPosition={playbackPosition} onAttachCurrentTime={attachCurrentTime} playbackHint={playbackHint} hasDownload={Boolean(getDownloadID)} captureScreen={Boolean(captureScreen)} capturing={capturing} onScreenshot={() => void screenshot()} expandedWriting={expandedWriting} onToggleExpanded={() => setExpandedWriting(value => !value)} tagsOpen={tagsOpen} onOpenTags={openTags} onDiscardDraft={discardDraft} onDetachExcerpt={detachExcerpt} onRemoveTime={() => setDraft(current => ({ ...current, positionSeconds: null, timeDetached: true }))} onSaveAsNew={() => setDraft(current => ({ ...current, editingId: null, createId: undefined, frameSpec: undefined }))}/>

  return <section className="notes-panel notes-workspace" data-media-notebook={Boolean(notebook)} data-expanded-writing={composerOpen && expandedWriting} aria-labelledby="notes-title" onKeyDown={event => {
    if (event.key === 'Escape' && actionsOpen && !event.defaultPrevented) {
      event.preventDefault()
      event.stopPropagation()
      setActionsOpen(false)
      actionsButton.current?.focus()
    }
  }}>
    <div className="notes-panel-heading">
      <h2 id="notes-title" aria-label="我的笔记"><StickyNote size={16} aria-hidden="true" />我的笔记<span className="count">{notes.notes.length}</span></h2>
      <div className="notes-panel-tools">
        <a className="icon-button" href="/notes" title="全部笔记" aria-label="查看全部笔记"><BookOpen size={16}/></a>
        <Button variant="quiet" iconOnly ref={composeButton} className="icon-button note-compose-toggle" aria-label={composerOpen ? '收起写作区' : hasDraft ? '继续草稿' : '写笔记'} title={composerOpen ? '收起写作区' : hasDraft ? '继续草稿' : '写笔记'} aria-expanded={composerOpen} aria-controls="note-composer" onClick={composerOpen ? closeComposer : openComposer}>{composerOpen ? <ChevronUp size={17}/> : <Plus size={17}/>}</Button>
        <Button variant="quiet" iconOnly className="icon-button" title="重新加载笔记" aria-label="重新加载笔记" disabled={notes.pending || notes.loading} onClick={() => void notes.reload()}><RotateCw size={15} /></Button>
        <Button variant="quiet" iconOnly ref={actionsButton} className="icon-button" aria-label="笔记操作" title="笔记操作" aria-expanded={actionsOpen} aria-controls={actionsId} onClick={() => setActionsOpen(value => !value)}><MoreHorizontal size={17} aria-hidden="true"/></Button>
      </div>
    </div>
    <div id={actionsId} className="note-source-tools" role="region" aria-label="笔记复制与导出" hidden={!actionsOpen}>
      <Button variant="quiet" type="button" className="note-copy-source" disabled={unavailable || notes.notes.length === 0} onClick={() => void copySourceNotes()}>{copiedId === 'source' ? <Check size={14}/> : <Copy size={14}/>}复制本篇全部笔记</Button>
      <NoteExport selection={{contentId}} label="导出来源笔记" disabled={notes.loading || Boolean(notes.readError) || notes.pending || notes.notes.length === 0}/>
    </div>
    {playbackPosition !== null && <p className="note-playback-clock"><Clock3 size={13}/><span>当前播放</span><output aria-label="当前播放时间">{formatPosition(Math.floor(playbackPosition))}</output></p>}
    {notes.loading && <p className="notes-hint" role="status"><LoaderCircle size={16} className="spin" />正在打开笔记…</p>}
    {notes.pending && notes.writeOperation === 'frame' && <div className="notes-hint" role="status"><LoaderCircle size={16} className="spin"/>正在保存画面…<Button variant="quiet" iconOnly className="icon-button" title="取消截图" aria-label="取消截图" onClick={() => { notes.cancelFrame(); setNotice('已停止等待，正在核对已保存画面。') }}><X size={15}/></Button></div>}
    {notes.readError && <div className="notes-error" role="alert"><p>{notes.readError}</p></div>}
    {backupNotice && <p className="notes-hint" role="status">{backupNotice}</p>}
    {recoverable.length > 0 && <details className="note-recovery"><summary>可恢复草稿 · {recoverable.length}</summary>{recoverable.map(backup => {
      const value = readDraft('', backup.raw)
      return <div key={backup.key}><p>{value.body.slice(0, 100) || value.textAnchor?.quote || value.pdfAnchor?.quote || value.tags || '关联位置草稿'}</p><time>{new Date(backup.updatedAt).toLocaleString('zh-CN')}</time><div><Button variant="secondary" type="button" className="button button-secondary" disabled={hasDraft || notes.pending} title={hasDraft ? '先保存或清空当前草稿' : '恢复此草稿'} onClick={() => { restoreDraft(backup); setComposerOpen(true); setPreview(false); setNotice('草稿已恢复，尚未保存为笔记。') }}>恢复草稿</Button><Button variant="quiet" iconOnly type="button" className="icon-button" title="删除备份草稿" aria-label={`删除备份草稿 ${value.body.slice(0, 24)}`} disabled={notes.pending} onClick={() => deleteBackup(backup)}><Trash2 size={14}/></Button></div></div>
    })}</details>}
    {backupFailed && hasDraft && <p className="notes-error" role="status">无法备份草稿到此浏览器，请保存笔记后再关闭页面。</p>}
    {!composerOpen && hasDraft && <Button variant="quiet" className="note-draft-resume" type="button" onClick={openComposer}><Pencil size={14}/><span>{draft.body.trim().slice(0, 64) || '继续草稿'}</span><span className="note-draft-status">未保存</span></Button>}
    {!notebook && composer}
    {notes.writeError && <div className="notes-error" role="alert"><p>{notes.writeError}{notes.writeOperation === 'save' && ' 正文草稿保留，请重试。'}{notes.writeOperation === 'task' && ' 待办未更新，请重新加载笔记后再试。'}</p>{notes.writeErrorCode === 'note_conflict' && draft.editingId && <><Button variant="secondary" className="button button-secondary" type="button" disabled={notes.pending || notes.loading} onClick={() => void reviewConflict()}>读取最新笔记</Button>{conflictVersion && conflictVersion.id === draft.editingId && conflictVersion.updatedAt !== draft.expectedUpdatedAt && <div className="note-conflict-review"><h3>最新保存版本</h3><div className="note-meta"><NoteLocation note={conflictVersion} contentId={contentId} showTime={showTime} unresolved={false} onSeek={onSeek} onJumpText={onJumpText} onJumpPDF={onJumpPDF} onNotice={setNotice}/></div>{(conflictVersion.textAnchor || conflictVersion.pdfAnchor) && <blockquote className="note-source-excerpt">{conflictVersion.textAnchor?.quote ?? conflictVersion.pdfAnchor?.quote}</blockquote>}<MarkdownBody className="note-body">{conflictVersion.body}</MarkdownBody><div className="note-tags">{conflictVersion.tags?.length ? conflictVersion.tags.map(tag => <span key={tag}>#{tag}</span>) : <span>无标签</span>}</div><p>保存修改将替换正文、标签和关联位置。</p><Button variant="secondary" className="button button-secondary" type="button" disabled={notes.pending || notes.loading} onClick={() => { setDraft(value => value.editingId === conflictVersion.id ? { ...value, expectedUpdatedAt: conflictVersion.updatedAt } : value); setConflictVersion(null); setNotice('已确认此版本，点击保存修改将替换它；草稿仍保留。') }}>确认以草稿替换此版本</Button></div>}</>}</div>}
    {['note_creation_conflict', 'note_creation_deleted'].includes(notes.writeErrorCode) && !draft.editingId && <Button variant="secondary" className="button button-secondary" type="button" disabled={unavailable} onClick={() => { setDraft(current => ({ ...current, createId: undefined, frameSpec: undefined })); setNotice('草稿已保留，点击保存将另存一条笔记。') }}>另存草稿</Button>}
    {notes.writeErrorCode === 'note_conflict' && conflictVersion?.id === draft.editingId && Boolean(conflictVersion?.subtitleReferences?.length) && <section className="note-conflict-review" aria-label="最新保存的字幕摘录"><h3>最新字幕摘录</h3><SubtitleReferences references={conflictVersion!.subtitleReferences} contentId={contentId} sourceVersion={sourceVersion}/></section>}
    {notice && <p className="notes-feedback" role="status">{notice}</p>}
    <div className="note-records-workspace">
      {(notes.notes.length > 0 || query.trim() || tag || filter !== 'all') && <>
        <div className="note-library-heading">
          <h3>本篇记录{(query.trim() || tag || filter !== 'all') && <span className="note-search-count" aria-label="笔记筛选数量">{visibleNotes.length}/{notes.notes.length}</span>}</h3>
          <Select className="note-sort" aria-label="笔记排序" value={order} onChange={event => setOrder(event.target.value as NoteOrder)}>
            <option value="latest">最新记录</option>
            <option value="updated">最近修改</option>
            <option value="source">原文顺序</option>
          </Select>
          <label className="note-search">
            <Search size={14} aria-hidden="true"/>
            <Input aria-label="搜索当前内容笔记" type="search" value={query} placeholder="搜索笔记或摘录" onChange={event => setQuery(event.target.value)}/>
            {query && <Button variant="quiet" type="button" aria-label="清除笔记筛选" title="清除筛选" onClick={() => setQuery('')}><X size={13}/></Button>}
          </label>
        </div>
        <div className="note-library-filters" role="group" aria-label="笔记分类">
          {([['all', '全部', notes.notes.length], ['linked', '摘录', linkedCount], ['free', '随记', notes.notes.length - linkedCount]] as const).map(([value, label, total]) => <Button variant="quiet" key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{total}</span></Button>)}
        </div>
        {tag && <div className="note-active-tag"><span>#{tag}</span><Button variant="quiet" type="button" title="清除标签筛选" aria-label="清除标签筛选" onClick={() => setTag('')}><X size={13}/></Button></div>}
      </>}
      {(query.trim() || tag || filter !== 'all') && visibleNotes.length === 0 && <div className="note-no-results"><p className="notes-hint" role="status">没有匹配的笔记。</p><Button variant="secondary" type="button" className="button button-secondary" onClick={() => { setQuery(''); setTag(''); setFilter('all') }}>显示全部笔记</Button></div>}
      <NoteRecords notes={visibleNotes} contentId={contentId} sourceVersion={sourceVersion} showTime={showTime} unavailable={unavailable} hasDraft={hasDraft} editingId={draft.editingId} copiedId={copiedId} activeNoteIds={activeNoteIds} linkedHighlight={linkedHighlight} unresolvedAnchorIds={unresolvedAnchorIds} captureScreen={Boolean(captureScreen)} capturePending={capturing} selectedTag={tag} getDownloadID={getDownloadID} onSeek={onSeek} onJumpText={onJumpText} onJumpPDF={onJumpPDF} onCapture={captureFrame} onCaptureNote={captureNoteFrame} onCaptureCurrent={note => void captureCurrentFrame(note)} onRemoveFrame={(note, frameId) => void notes.frame(note, undefined, undefined, frameId).then(saved => { if (saved) setNotice('画面已移除。') })} onCopy={note => void copyNote(note)} onEdit={edit} onRemove={(note, version) => notes.remove(note.id, version)} onTaskChange={(note, offset, checked) => { if (!unavailable && draft.editingId !== note.id) void notes.toggleTask(note, offset, checked).then(saved => { if (saved) setNotice('待办已更新。') }) }} onTagChange={value => setTag(current => current === value ? '' : value)} onNotice={setNotice} onDeleted={() => editor.current?.focus({ preventScroll: true })}/>
      {!notes.loading && !notes.readError && notes.notes.length === 0 && !composerOpen && <Button variant="quiet" type="button" className="note-empty-capture" onClick={openComposer}><Plus size={16}/>记下第一个想法</Button>}
    </div>
    {notebook && composer}
  </section>
}
