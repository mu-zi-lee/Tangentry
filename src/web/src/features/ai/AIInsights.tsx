import { Button, Select } from '../../components/ui'
import { ArrowUp, ChevronDown, ChevronRight, Clipboard, Copy, LoaderCircle, MessageCircle, RotateCcw, Square, Trash2, ListTree, NotebookPen, Pencil } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type WheelEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SummaryEvidence, SummaryOutline, SummaryResult, SummarySection, SummarySentence, SummaryUnit } from './summaryTypes'
import type { useSummary } from './useSummary'
import { request } from '../../shared/api/client'
import { buildChatContext } from './chatContext'
import { rememberedChatModel, rememberChatModel, selectedChatModel } from './chatPresentation'
import { mergeModelLists, modelsForTask } from './modelPicker'
import './ai.css'

function clock(seconds: number) { const total = Math.max(0, Math.floor(seconds)); const m = Math.floor(total / 60); return `${m}:${String(total % 60).padStart(2, '0')}` }

export type SummaryLevel = 0 | 1 | 2 | 3 | 4
const SUMMARY_LEVELS = ['Topic', 'Takeaway', 'Key', 'Brief', 'Full'] as const
const SUMMARY_LEVEL_LABELS = ['主题', '结论', '关键点', '原文摘句', '原文'] as const

function evidenceFor(unit: SummaryUnit): SummaryEvidence[] {
  const values = [...(unit.evidence ?? []), ...(unit.source ?? []), ...(unit.sentences ?? []).flatMap(sentence => sentence.evidence ?? [])]
  const seen = new Set<string>()
  return values.filter(value => {
    if (!value?.quote?.trim()) return false
    const key = value.id ?? `${value.index ?? ''}|${value.quote}|${value.start ?? ''}|${value.end ?? ''}|${value.page ?? ''}|${(value.cueIds ?? []).join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function evidenceForSection(section: SummarySection): SummaryEvidence[] {
  const values = [...(section.evidence ?? []), ...(section.source ?? [])]
  const seen = new Set<string>()
  return values.filter(value => {
    if (!value?.quote?.trim()) return false
    const key = value.id ?? `${value.index ?? ''}|${value.quote}|${value.start ?? ''}|${value.end ?? ''}|${value.page ?? ''}|${(value.cueIds ?? []).join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sentenceText(sentence: SummarySentence): string { return sentence.text?.trim() ?? '' }

function briefSentences(unit: SummaryUnit): SummarySentence[] {
  const sentences = unit.sentences ?? []
  if (!unit.briefSentenceIds?.length) return sentences.slice(0, 3)
  const selected = new Set(unit.briefSentenceIds)
  return sentences.filter(sentence => sentence.id && selected.has(sentence.id)).slice(0, 3)
}

function distinctUnitKey(unit: SummaryUnit): string {
  return keyParts(unit).claim
}

function keyParts(unit: SummaryUnit): { claim: string; reason: string } {
  const takeaway = unit.takeaway?.trim() || ''
  const key = unit.key?.trim() || ''
  const reason = unit.reason?.trim() || ''
  if (!key || key === takeaway) return { claim: '', reason: reason !== takeaway ? reason : '' }
  const marker = '；依据是'
  if (takeaway && key.startsWith(`${takeaway}${marker}`)) {
    // The takeaway is already visible at the previous zoom level. Key should
    // contribute the new rationale instead of repeating the same conclusion.
    return { claim: '', reason: key.slice((takeaway + marker).length).trim() }
  }
  return { claim: key, reason: reason !== takeaway ? reason : '' }
}

function unitText(unit: SummaryUnit, level: SummaryLevel): string {
  if (level === 0) return unit.topic?.trim() || unit.takeaway?.trim() || unit.key?.trim() || ''
  if (level === 1) return unit.takeaway?.trim() || unit.key?.trim() || ''
  if (level === 2) return distinctUnitKey(unit)
  if (level === 3) return briefSentences(unit).map(sentenceText).filter(Boolean).join(' ')
  return unit.full?.trim() || (unit.sentences ?? []).map(sentenceText).filter(Boolean).join('\n')
}

function sectionText(section: SummarySection, level: SummaryLevel): string {
  if (level === 0) return section.topic?.trim() || section.title
  return level === 1 ? section.takeaway?.trim() || '' : ''
}

function findSection(sections: SummarySection[], id: string): SummarySection | undefined {
  for (const section of sections) {
    if (section.sectionId === id) return section
    const match = findSection(section.children ?? [], id)
    if (match) return match
  }
  return undefined
}

function locateEvidence(evidence: SummaryEvidence, onSeek?: (seconds: number) => void, onLocateQuote?: (quote: string) => void, onLocatePage?: (page: number) => void) {
  if (evidence.start !== undefined && onSeek) onSeek(evidence.start)
  else if (evidence.page !== undefined && onLocatePage) onLocatePage(evidence.page)
  else onLocateQuote?.(evidence.quote)
}

function EvidenceList({ evidence, onSeek, onLocateQuote, onLocatePage }: { evidence: SummaryEvidence[]; onSeek?: (seconds: number) => void; onLocateQuote?: (quote: string) => void; onLocatePage?: (page: number) => void }) {
  if (!evidence.length) return null
  return <details className="ai-fold-evidence" aria-label={`证据 ${evidence.length} 条`}><summary>证据 · {evidence.length}</summary><div className="ai-fold-evidence-list">{evidence.map((item, index) => <div className="ai-fold-evidence-item" key={item.id ?? `${item.quote}-${index}`}><blockquote>{item.quote}</blockquote><Button variant="quiet" type="button" className="ai-fold-locate" onClick={() => locateEvidence(item, onSeek, onLocateQuote, onLocatePage)}>{item.start !== undefined && item.end !== undefined ? `${clock(item.start)}–${clock(item.end)}` : item.page !== undefined ? `第 ${item.page} 页` : '定位原文'}</Button></div>)}</div></details>
}

function FoldUnit({ unit, level, onSeek, onLocateQuote, onLocatePage, onRename }: { unit: SummaryUnit; level: SummaryLevel; onSeek?: (seconds: number) => void; onLocateQuote?: (quote: string) => void; onLocatePage?: (page: number) => void; onRename?: (nodeId: string, current: string) => void }) {
  const parts = keyParts(unit)
  const hasDistinctKey = Boolean(parts.claim || parts.reason)
  const text = unitText(unit, level)
  const evidence = evidenceFor(unit)
  if (!text && !evidence.length) return null
  const paragraphs = level === 3 ? briefSentences(unit).map(sentenceText).filter(Boolean) : text.split(/\n+/).map(value => value.trim()).filter(Boolean)
  const showKeyPlaceholder = level === 2 && !hasDistinctKey
  return <article className="ai-fold-unit" data-unit-id={unit.unitId}><div className="ai-fold-unit-label"><span>{SUMMARY_LEVEL_LABELS[level]}</span>{onRename && <Button variant="quiet" iconOnly type="button" className="icon-button ai-fold-rename" title="重命名主题" aria-label="重命名主题" onClick={() => onRename(unit.unitId, unit.topic || unit.takeaway || '内容主题')}><Pencil size={13}/></Button>}</div>{showKeyPlaceholder ? <div className="ai-fold-unit-text is-placeholder"><p>主要依据尚未单独提炼，先查看结论和证据。</p></div> : level === 2 ? <div className="ai-fold-key"><div><span>{parts.reason ? '主要依据' : '关键点'}</span><p>{parts.reason || parts.claim}</p></div></div> : <div className="ai-fold-unit-text">{paragraphs.map((paragraph, index) => <p key={`${unit.unitId}-${index}`}>{paragraph}</p>)}</div>}<EvidenceList evidence={evidence} onSeek={onSeek} onLocateQuote={onLocateQuote} onLocatePage={onLocatePage}/></article>
}

function FoldSection({ section, level, focused, onFocus, onSeek, onLocateQuote, onLocatePage, onRename, parentTakeaway }: { section: SummarySection; level: SummaryLevel; focused: boolean; onFocus: () => void; onSeek?: (seconds: number) => void; onLocateQuote?: (quote: string) => void; onLocatePage?: (page: number) => void; onRename?: (nodeId: string, current: string) => void; parentTakeaway?: string }) {
  const sectionEvidence = evidenceForSection(section)
  const children = section.children ?? []
  const hasUnits = Boolean(section.units?.length)
  const hasChildren = children.length > 0
  const takeaway = sectionText(section, level)
  const distinctTakeaway = !hasChildren && takeaway && takeaway !== parentTakeaway ? takeaway : ''
  const showSectionEvidence = level === 0 || (!hasUnits && !hasChildren)
  const topic = sectionText(section, 0)
  const showTopic = topic && topic !== section.title
  return <section className={`ai-fold-section${focused ? ' is-focused' : ''}`} data-section-id={section.sectionId}>
    <div className="ai-fold-section-head"><button type="button" className="ai-fold-section-card" aria-pressed={focused} onClick={onFocus}><span className="ai-fold-section-title">{section.title}</span>{showTopic && <span className="ai-fold-section-topic">{topic}</span>}{level === 0 && !hasChildren && section.takeaway?.trim() && <span className="ai-fold-section-takeaway-preview">{section.takeaway.trim()}</span>}{section.start !== undefined && section.end !== undefined && <span className="ai-fold-section-meta">{clock(section.start)}–{clock(section.end)}</span>}{section.page !== undefined && <span className="ai-fold-section-meta">第 {section.page} 页</span>}</button>{onRename && <Button variant="quiet" iconOnly type="button" className="icon-button ai-fold-rename" title="重命名章节" aria-label="重命名章节" onClick={() => onRename(section.sectionId, section.title)}><Pencil size={14}/></Button>}</div>
    {level > 0 && <div className="ai-fold-section-body">{distinctTakeaway && <div className="ai-fold-section-summary"><span>章节结论</span><p>{distinctTakeaway}</p></div>}{hasUnits && !hasChildren && <div className="ai-fold-units">{section.units!.map(unit => <FoldUnit key={unit.unitId} unit={unit} level={level} onSeek={onSeek} onLocateQuote={onLocateQuote} onLocatePage={onLocatePage} onRename={onRename}/>)}</div>}{children.map(child => <FoldSection key={child.sectionId} section={child} level={level} focused={focused} onFocus={onFocus} onSeek={onSeek} onLocateQuote={onLocateQuote} onLocatePage={onLocatePage} onRename={onRename} parentTakeaway={section.takeaway?.trim()}/>)}</div>}
    {showSectionEvidence && sectionEvidence.length > 0 && <EvidenceList evidence={sectionEvidence} onSeek={onSeek} onLocateQuote={onLocateQuote} onLocatePage={onLocatePage}/>}
  </section>
}

export function AIFoldReader({ sections, onSeek, onLocateQuote, onLocatePage, onRename }: { sections: SummarySection[]; onSeek?: (seconds: number) => void; onLocateQuote?: (quote: string) => void; onLocatePage?: (page: number) => void; onRename?: (nodeId: string, current: string) => void }) {
  const [level, setLevel] = useState<SummaryLevel>(0)
  const [focused, setFocused] = useState<string | null>(null)
  const [morphing, setMorphing] = useState(false)
  const mapRef = useRef<HTMLDivElement>(null)
  const levelRef = useRef(level)
  const beforeRef = useRef<Map<string, DOMRect> | null>(null)
  const ghostRef = useRef<Array<{ node: HTMLElement; rect: DOMRect }>>([])
  const wheelDeltaRef = useRef(0)
  const wheelTimerRef = useRef<number | null>(null)
  const wheelLockRef = useRef(false)
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const captureGeometry = () => {
    const container = mapRef.current
    if (!container || reducedMotion) return
    const viewportTop = window.scrollY - 320
    const viewportBottom = window.scrollY + window.innerHeight + 320
    const snapshot = new Map<string, DOMRect>()
    const ghosts: Array<{ node: HTMLElement; rect: DOMRect }> = []
    container.querySelectorAll<HTMLElement>('[data-section-id], [data-unit-id]').forEach(element => {
      const rect = element.getBoundingClientRect()
      const absoluteTop = rect.top + window.scrollY
      if (absoluteTop < viewportTop || absoluteTop > viewportBottom) return
      const key = element.dataset.sectionId ? `section:${element.dataset.sectionId}` : `unit:${element.dataset.unitId}`
      snapshot.set(key, rect)
      ghosts.push({ node: element.cloneNode(true) as HTMLElement, rect })
    })
    beforeRef.current = snapshot
    ghostRef.current = ghosts
  }
  const setReaderLevel = (value: number) => {
    const next = Math.max(0, Math.min(4, Math.round(value))) as SummaryLevel
    if (next === levelRef.current) return
    captureGeometry()
    levelRef.current = next
    setLevel(next)
  }
  useLayoutEffect(() => {
    const container = mapRef.current
    const before = beforeRef.current
    if (!container || !before || reducedMotion) {
      beforeRef.current = null
      ghostRef.current = []
      return
    }
    const frame = requestAnimationFrame(() => {
      const current = new Map<string, HTMLElement>()
      container.querySelectorAll<HTMLElement>('[data-section-id], [data-unit-id]').forEach(element => {
        const key = element.dataset.sectionId ? `section:${element.dataset.sectionId}` : `unit:${element.dataset.unitId}`
        current.set(key, element)
      })
      const matched = [...before.keys()].filter(key => current.has(key))
      const budget = 80
      const animateGeometry = matched.length <= budget && before.size <= budget
      if (animateGeometry) {
        for (const key of matched) {
          const element = current.get(key)!
          const from = before.get(key)!
          const to = element.getBoundingClientRect()
          const dx = from.left - to.left
          const dy = from.top - to.top
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
          element.getAnimations().forEach(animation => animation.cancel())
          element.animate(
            [{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0.84 }, { transform: 'none', opacity: 1 }],
            { duration: 180, easing: 'cubic-bezier(.22,.8,.28,1)', fill: 'both' },
          )
        }
      }
      const mapRect = container.getBoundingClientRect()
      const activeGhosts = ghostRef.current.filter(({ node }) => {
        const key = node.dataset.sectionId ? `section:${node.dataset.sectionId}` : `unit:${node.dataset.unitId}`
        return !current.has(key)
      }).slice(0, Math.max(0, budget - matched.length))
      for (const ghost of activeGhosts) {
        const node = ghost.node
        node.style.position = 'absolute'
        node.style.left = `${ghost.rect.left - mapRect.left + container.scrollLeft}px`
        node.style.top = `${ghost.rect.top - mapRect.top + container.scrollTop}px`
        node.style.width = `${ghost.rect.width}px`
        node.style.margin = '0'
        node.style.pointerEvents = 'none'
        node.style.zIndex = '0'
        node.classList.add('ai-fold-ghost')
        container.appendChild(node)
        node.animate([{ opacity: 0.7 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' }).finished.then(() => node.remove()).catch(() => node.remove())
      }
      beforeRef.current = null
      ghostRef.current = []
      setMorphing(true)
      window.setTimeout(() => setMorphing(false), animateGeometry ? 250 : 180)
    })
    return () => cancelAnimationFrame(frame)
  }, [level, reducedMotion])
  useEffect(() => {
    if (reducedMotion) { setMorphing(false); return }
  }, [reducedMotion])
  useEffect(() => {
    if (focused && !findSection(sections, focused)) setFocused(null)
  }, [focused, sections])
  useEffect(() => () => {
    if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current)
  }, [])
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) < 2) return
    event.preventDefault()
    wheelDeltaRef.current += event.deltaY
    if (wheelLockRef.current) return
    const flush = () => {
      wheelTimerRef.current = null
      const delta = wheelDeltaRef.current
      if (Math.abs(delta) < 24) return
      wheelDeltaRef.current = 0
      wheelLockRef.current = true
      setReaderLevel(levelRef.current + (delta > 0 ? 1 : -1))
      wheelTimerRef.current = window.setTimeout(() => { wheelLockRef.current = false }, 180)
    }
    if (Math.abs(wheelDeltaRef.current) >= 24) flush()
    else {
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = window.setTimeout(flush, 110)
    }
  }
  const visibleSections = focused ? (findSection(sections, focused) ? [findSection(sections, focused)!] : sections) : sections
  return <div className={`ai-fold-reader${morphing ? ' is-morphing' : ''}`} data-level={SUMMARY_LEVELS[level].toLowerCase()} onWheel={wheel}>
    <div className="ai-fold-toolbar"><div className="ai-fold-level-label"><strong>{SUMMARY_LEVEL_LABELS[level]}</strong><span>{level === 0 ? '先看主题地图，再逐层展开' : '从主题到原文，证据始终可追溯'}</span></div><label className="ai-fold-slider"><span className="sr-only">摘要阅读层级</span><input type="range" min="0" max="4" step="1" value={level} aria-valuetext={`${SUMMARY_LEVEL_LABELS[level]}（${SUMMARY_LEVELS[level]}）`} onChange={event => setReaderLevel(Number(event.target.value))}/><span className="ai-fold-slider-labels" aria-hidden="true">{SUMMARY_LEVEL_LABELS.map(value => <span key={value}>{value}</span>)}</span></label></div>
    {focused && <Button variant="quiet" type="button" className="ai-fold-back" onClick={() => setFocused(null)}>显示全部主题</Button>}
    <div ref={mapRef} className="ai-fold-map" aria-label={`${SUMMARY_LEVEL_LABELS[level]}内容地图`}>{(level === 0 ? sections : visibleSections).map(section => <FoldSection key={section.sectionId} section={section} level={level} focused={focused === section.sectionId} onFocus={() => setFocused(current => current === section.sectionId ? null : section.sectionId)} onSeek={onSeek} onLocateQuote={onLocateQuote} onLocatePage={onLocatePage} onRename={onRename}/>)}</div>
  </div>
}

function OutlineNode({ node, onSeek, onLocateQuote, onLocatePage, citations, depth = 0, expanded, number = '1' }: { node: SummaryOutline; onSeek?: (seconds: number) => void; onLocateQuote?: (quote: string) => void; onLocatePage?: (page: number) => void; citations: Map<number, { quote: string; page?: number }>; depth?: number; expanded?: boolean; number?: string }) {
  const [open, setOpen] = useState(expanded ?? depth === 0)
  useEffect(() => { if (expanded !== undefined) setOpen(expanded) }, [expanded])
  const children = node.children ?? []
  const citation = node.indices?.map(index => citations.get(index)).find(Boolean)
  return <li className="ai-outline-node" style={{ paddingLeft: depth * 12 }}><div className="ai-outline-row"><Button variant="quiet" type="button" className="ai-outline-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>{children.length ? (open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>) : <span className="ai-outline-dot"/>}<span className="ai-outline-number">{number}</span><span>{node.title}</span></Button>{node.start !== undefined && node.end !== undefined ? <Button variant="quiet" type="button" className="ai-outline-time" onClick={() => onSeek?.(node.start!)}>{clock(node.start)}</Button> : node.page ? <Button variant="quiet" type="button" className="ai-outline-time" onClick={() => onLocatePage?.(node.page!)}>第 {node.page} 页</Button> : citation && onLocateQuote ? <Button variant="quiet" type="button" className="ai-outline-time" onClick={() => onLocateQuote(citation.quote)}>定位</Button> : null}</div>{open && children.length > 0 && <ul>{children.map((child, index) => <OutlineNode key={`${child.title}-${index}`} node={child} onSeek={onSeek} onLocateQuote={onLocateQuote} onLocatePage={onLocatePage} citations={citations} depth={depth + 1} expanded={expanded} number={`${number}.${index + 1}`}/>)}</ul>}</li>
}

export function AIOutlinePanel({ summary, onSeek, onLocateQuote, onLocatePage }: { summary: ReturnType<typeof useSummary>; onSeek?: (seconds: number) => void; onLocateQuote?: (quote: string) => void; onLocatePage?: (page: number) => void }) {
  const [expanded, setExpanded] = useState<boolean | undefined>(undefined)
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({})
  const result = summary.inspection?.result
  const outline = result?.outline ?? []
  useEffect(() => { setTitleOverrides({}) }, [result?.key])
  const rename = async (nodeId: string, current: string) => {
    if (!result?.key) return
    const next = window.prompt('重命名主题或章节', current)?.trim()
    if (!next || next === current) return
    try {
      await request(`/ai/summaries/${result.key}/titles`, { method: 'PUT', body: JSON.stringify({ nodeId, title: next }) })
      setTitleOverrides(value => ({ ...value, [nodeId]: next }))
    } catch { /* keep the original title when persistence fails */ }
  }
  if (!summary.hasInput && !summary.inspection) {
    return <p className="ai-insight-empty" role="status">当前没有可用于摘要的可信字幕或正文。若字幕标记为“疑似错位”，请切换到正确字幕或先转录后再生成。</p>
  }
  if (!summary.inspection?.result.complete) {
    const result = summary.inspection?.result
    const progress = result?.progress
    const completedSections = progress?.completedSections ?? 0
    const totalSections = progress?.totalSections ?? 0
    const completedCalls = progress?.completedCalls ?? result?.completedCalls ?? 0
    const totalCalls = progress?.totalCalls ?? result?.totalCalls ?? 0
    const currentCall = progress?.currentCall
    const isRequesting = Boolean(currentCall && progress?.phase !== 'error')
    const canResume = !summary.inspection?.active && completedCalls > 0
    const message = progress?.error || (isRequesting
      ? `已完成 ${completedCalls}/${totalCalls || '—'} 步，正在请求第 ${currentCall} 步，通常需要几十秒。`
      : canResume
        ? `已完成 ${completedCalls}/${totalCalls || '—'} 步，已完成内容已保留；点击“AI 摘要”可继续整理。`
        : '摘要正在整理，完整主题地图会在校验通过后显示。')
    const hasProgress = totalSections > 0 || totalCalls > 0
    return <div className={`ai-fold-progress${progress?.error ? ' has-error' : ''}`} role="status"><p className="ai-insight-empty">{message}</p>{hasProgress && <><div className="ai-fold-progress-copy"><span>章节 {completedSections}/{totalSections || '—'}</span><span>步骤 {completedCalls}/{totalCalls || '—'}</span></div><progress max={totalSections || totalCalls || 1} value={totalSections ? completedSections : completedCalls} aria-label="摘要生成进度" /></>}</div>
  }
  if (result) {
    const sections = foldSections(result)
    const visibleSections = applyTitleOverrides(sections, titleOverrides)
    if (result.document?.sections?.length) return visibleSections.length ? <AIFoldReader sections={visibleSections} onSeek={onSeek} onLocateQuote={onLocateQuote} onLocatePage={onLocatePage} onRename={rename}/> : <p className="ai-insight-empty">摘要暂时没有可显示的主题。</p>
  }
  if (outline.length === 0) return <p className="ai-insight-empty">这份旧摘要没有大纲，请点击上方 AI 摘要重新生成。</p>
  const citations = new Map((summary.inspection.result.citations ?? []).map(value => [value.index, value]))
  return <><div className="ai-outline-actions"><Button variant="quiet" type="button" className="text-button" onClick={() => setExpanded(true)}>全部展开</Button><Button variant="quiet" type="button" className="text-button" onClick={() => setExpanded(false)}>全部折叠</Button></div><ul className="ai-outline-tree">{outline.map((node, index) => <OutlineNode key={`${node.title}-${index}`} node={node} onSeek={onSeek} onLocateQuote={onLocateQuote} onLocatePage={onLocatePage} citations={citations} expanded={expanded}/>)}</ul></>
}

function foldSections(result: SummaryResult): SummarySection[] {
  if (result.document?.sections?.length) return result.document.sections
  const citations = new Map((result.citations ?? []).map(value => [value.index, value]))
  const convert = (node: SummaryOutline, path: string): SummarySection => {
    const evidence = (node.indices ?? []).map(index => citations.get(index)).filter((value): value is NonNullable<typeof value> => Boolean(value)).map(value => ({ index: value.index, quote: value.quote, start: value.start, end: value.end, page: value.page }))
    const unit: SummaryUnit | undefined = evidence.length ? { unitId: `${path}-unit`, type: 'legacy', key: node.title, evidence } : undefined
    return { sectionId: path, title: node.title, level: node.level, topic: node.title, takeaway: node.title, start: node.start, end: node.end, page: node.page, evidence, units: unit ? [unit] : undefined, children: node.children?.map((child, index) => convert(child, `${path}.${index + 1}`)) }
  }
  if (result.outline?.length) return result.outline.map((node, index) => convert(node, String(index + 1)))
  if (result.overview?.trim() || result.points?.length) {
    return [{ sectionId: 'summary', title: '内容摘要', topic: '内容摘要', takeaway: result.overview, units: result.points?.map((point, index) => ({ unitId: `point-${index + 1}`, type: 'legacy-point', key: point.text, evidence: point.indices.map(value => citations.get(value)).filter((value): value is NonNullable<typeof value> => Boolean(value)).map(value => ({ index: value.index, quote: value.quote, start: value.start, end: value.end, page: value.page })) })) }]
  }
  return []
}

function applyTitleOverrides(sections: SummarySection[], overrides: Record<string, string>): SummarySection[] {
  return sections.map(section => ({
    ...section,
    title: overrides[section.sectionId] ?? section.title,
    units: section.units?.map(unit => ({ ...unit, topic: overrides[unit.unitId] ?? unit.topic })),
    children: section.children ? applyTitleOverrides(section.children, overrides) : section.children,
  }))
}

type ChatMessage = { role: 'user' | 'assistant'; content: string; model?: string }
export function AIChatPanel({ contentId, context, revision }: { contentId: string; context: string; revision: number }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [chatRevision, setChatRevision] = useState(revision)
  const abort = useRef<AbortController | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const conversation = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    setMessages([]); setModels([]); setModel(''); setError(''); setInput(''); setReady(false)
    follow.current = true
    void Promise.all([
      request<{ messages: ChatMessage[] }>(`/ai/chat?contentId=${encodeURIComponent(contentId)}`, { signal: controller.signal }),
      request<{ enabledModels?: string[]; availableModels?: string[]; chatModel?: string; revision: number }>('/ai/settings', { signal: controller.signal }),
    ]).then(([history, settings]) => {
      if (!alive) return
      setMessages(history.messages)
      const enabled = [...new Set((settings.enabledModels ?? []).filter(Boolean))]
      const chatModels = modelsForTask(mergeModelLists(settings.availableModels ?? [], enabled), enabled, 'chat')
      setModels(chatModels)
      setModel(rememberedChatModel(chatModels) || selectedChatModel(settings))
      setChatRevision(settings.revision)
      setReady(true)
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : '对话读取失败，请重新打开。') })
    return () => { alive = false; controller.abort(); abort.current?.abort() }
  }, [contentId])
  const suggestions = ['这个讲了什么', '列出关键观点', '有哪些值得记下的地方']
  useLayoutEffect(() => {
    const element = composer.current
    if (element) { element.style.height = 'auto'; element.style.height = `${Math.min(element.scrollHeight, 180)}px` }
  }, [input])
  useLayoutEffect(() => {
    const element = conversation.current
    if (element && follow.current) element.scrollTop = element.scrollHeight
  }, [messages, pending, error])
  const send = async (question = input.trim(), conversation = messages) => {
    const value = question.trim(); if (!value || pending || !model || !ready) return
    const next = [...conversation, { role: 'user' as const, content: value }]
    follow.current = true
    setMessages(next); setInput(''); setPending(true); setError('')
    const controller = new AbortController(); abort.current = controller
    try {
      const response = await fetch('/api/ai/chat', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ contentId, context, messages: next.filter(message => message.content.trim()).slice(-39), model, revision: chatRevision }) })
      if (!response.ok || !response.body) { const body = await response.json().catch(() => ({})) as { message?: string }; throw new Error(body.message ?? '对话暂时不可用。') }
      if (!response.headers.get('Content-Type')?.includes('text/event-stream')) {
        const result = await response.json() as { messages: ChatMessage[] }
        setMessages(result.messages)
        return
      }
      const reader = response.body.getReader(), decoder = new TextDecoder()
      let buffer = '', answer = ''
      setMessages([...next, { role: 'assistant', content: '', model }])
      const consume = (event: string) => {
        const payload = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!payload) return
        const data = JSON.parse(payload) as { delta?: string; error?: string }
        if (data.error) throw new Error(data.error)
        if (data.delta) { answer += data.delta; setMessages([...next, { role: 'assistant', content: answer, model }]) }
      }
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() ?? ''
        for (const event of events) consume(event)
      }
      buffer += decoder.decode()
      if (buffer.trim()) consume(buffer)
      if (!answer) throw new Error('对话暂时不可用。')
    }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : '对话暂时不可用。') }
    finally {
      if (abort.current === controller) {
        setPending(false)
        setMessages(current => current.filter(message => message.content.trim()))
        abort.current = null
        composer.current?.focus({ preventScroll: true })
      }
    }
  }
  const clear = async () => {
    if (pending) return
    try {
      await request('/ai/chat', { method: 'POST', body: JSON.stringify({ contentId, context, messages: [], revision: chatRevision, clear: true }) })
      setMessages([]); setError(''); composer.current?.focus()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '清空对话失败。') }
  }
  const copy = async (text: string) => { await navigator.clipboard?.writeText(text) }
  const saveNote = async (text: string) => { try { await request('/notes', { method: 'POST', body: JSON.stringify({ contentId, body: text, tags: ['AI对话'], subtitleReferences: [] }) }) } catch (cause) { setError(cause instanceof Error ? cause.message : '保存笔记失败。') } }
  const regenerate = (index: number) => { const previous = messages[index - 1]; if (previous?.role !== 'user' || pending) return; void send(previous.content, messages.slice(0, index - 1)) }
  const retry = () => {
    const index = messages.map(message => message.role).lastIndexOf('user')
    if (index >= 0) void send(messages[index].content, messages.slice(0, index))
  }
  return <div className="ai-chat-panel">
    <div className="ai-chat-actions"><span>{pending ? '正在回答' : messages.length ? '当前内容的对话' : '新对话'}</span><Button variant="quiet" iconOnly type="button" className="icon-button" title="清空对话" aria-label="清空对话" disabled={pending || messages.length === 0} onClick={() => void clear()}><Trash2 size={15}/></Button></div>
    <div ref={conversation} className="ai-chat-messages" role="log" aria-label="对话记录" aria-live="polite" onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48 }}>
      {messages.length === 0 && <div className="ai-chat-empty"><MessageCircle size={23} strokeWidth={1.5} aria-hidden="true"/><h3>关于这篇内容，想了解什么？</h3><div className="ai-chat-suggestions">{suggestions.map(value => <Button variant="quiet" key={value} type="button" disabled={pending || !model || !ready} onClick={() => void send(value)}>{value}<ArrowUp size={14} aria-hidden="true"/></Button>)}</div></div>}
      {messages.map((message, index) => <article key={`${message.role}-${index}`} className={`ai-chat-message ai-chat-${message.role}`} aria-label={message.role === 'user' ? '你的提问' : 'AI 回答'}>
        <span className="visually-hidden">{message.role === 'user' ? '你' : 'AI'}</span>
        {message.role === 'assistant' ? <div className="ai-chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          pre({ children }) { return <div className="ai-code"><pre>{children}</pre></div> },
          code({ children, className }) {
            const text = String(children).replace(/\n$/, '')
            return <><code className={className}>{children}</code>{String(children).includes('\n') && <Button variant="quiet" iconOnly type="button" className="icon-button ai-code-copy" title="复制代码" aria-label="复制代码" onClick={() => void copy(text)}><Clipboard size={14}/></Button>}</>
          },
        }}>{message.content}</ReactMarkdown></div> : <p>{message.content}</p>}
        {message.role === 'assistant' && message.content && !pending && <div className="ai-chat-message-actions"><Button variant="quiet" iconOnly type="button" className="icon-button" title="复制回答" aria-label="复制回答" onClick={() => void copy(message.content)}><Copy size={14}/></Button><Button variant="quiet" iconOnly type="button" className="icon-button" title="重新生成" aria-label="重新生成" onClick={() => regenerate(index)}><RotateCcw size={14}/></Button><Button variant="quiet" iconOnly type="button" className="icon-button" title="存为笔记" aria-label="存为笔记" onClick={() => void saveNote(message.content)}><NotebookPen size={14}/></Button>{message.model && <small title={message.model}>{message.model.split('/').pop()}</small>}</div>}
      </article>)}
      {pending && <p className="ai-chat-pending" role="status"><LoaderCircle size={14} className="spin"/>正在生成…</p>}
      {error && <div className="ai-chat-error" role="alert"><p>{error}</p>{messages.some(message => message.role === 'user') && <Button variant="quiet" type="button" disabled={pending || !ready} onClick={retry}><RotateCcw size={14}/>重新尝试</Button>}</div>}
    </div>
    {ready && !model && <p className="ai-chat-setup" role="status">请在<a href="/tools#translation">AI 设置</a>中选择对话模型。</p>}
    <form className="ai-chat-composer" onSubmit={event => { event.preventDefault(); void send() }}>
      <textarea ref={composer} aria-label="输入问题" value={input} maxLength={12000} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} placeholder="围绕这篇内容提问…" rows={2}/>
      <div className="ai-chat-toolbar">
        <Select aria-label="对话模型" title={model || '选择模型'} value={model} onChange={event => { setModel(event.target.value); rememberChatModel(event.target.value) }} disabled={pending || models.length === 0}><option value="">选择模型</option>{models.map(value => <option key={value} value={value}>{value.split('/').pop()}</option>)}</Select>
        {pending ? <Button variant="quiet" iconOnly type="button" className="icon-button ai-chat-send" title="停止生成" aria-label="停止生成" onClick={() => abort.current?.abort()}><Square size={14} fill="currentColor"/></Button> : <Button variant="quiet" iconOnly type="submit" className="icon-button ai-chat-send" title="发送" aria-label="发送" disabled={!input.trim() || !model || !ready}><ArrowUp size={18}/></Button>}
      </div>
    </form>
  </div>
}

export function AIInsights({ summary, onSeek, onLocateQuote, onLocatePage, contentId, context, revision }: { summary: ReturnType<typeof useSummary>; onSeek?: (seconds: number) => void; onLocateQuote?: (quote: string) => void; onLocatePage?: (page: number) => void; contentId: string; context: string; revision: number }) {
  const [tab, setTab] = useState<'outline' | 'chat'>('outline')
  const hasOutline = Boolean(summary.inspection?.result.document?.sections?.length || summary.inspection?.result.outline?.length)
  const summaryContext = useMemo(() => {
    const result = summary.inspection?.result
    const documentText = result?.document?.sections.flatMap(section => [section.title, section.topic, section.takeaway, ...(section.units ?? []).flatMap(unit => [unit.topic, unit.takeaway, unit.key, unit.full])]).filter(Boolean).join('\n')
    return buildChatContext(context, documentText || result?.overview, result?.points?.map(point => point.text))
  }, [context, summary.inspection?.result])
  return <section className="ai-insights" aria-label="AI 辅助"><div className="ai-insights-tabs" role="tablist"><Button variant="quiet" type="button" role="tab" aria-selected={tab === 'outline'} onClick={() => setTab('outline')}><ListTree size={15}/>主题地图{hasOutline ? ` · ${summary.inspection?.result.document?.sections.length ?? summary.inspection?.result.outline?.length ?? 0}` : ''}</Button><Button variant="quiet" type="button" role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}><MessageCircle size={15}/>AI 对话</Button></div>{tab === 'outline' ? <AIOutlinePanel summary={summary} onSeek={onSeek} onLocateQuote={onLocateQuote} onLocatePage={onLocatePage}/> : <AIChatPanel contentId={contentId} context={summaryContext} revision={revision}/>}</section>
}
