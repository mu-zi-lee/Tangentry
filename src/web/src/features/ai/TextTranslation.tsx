import { Button } from '../../components/ui'
import { Eye, EyeOff, Languages, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSubtitleTranslation } from './useSubtitleTranslation'
import { isChineseText } from '../../shared/text/chineseText'
import type { CardTextRendererProps } from '../../shared/ui/CardText'
import './ai.css'

let cardTranslationQueue: Promise<void> = Promise.resolve()

export function useTextTranslation(contentId: string, texts: string[], source: 'title' | 'article', enabled = true) {
  const track = useMemo(() => enabled && contentId && texts.length ? {
    language: `text-${source}`, label: source, automatic: false,
    cues: texts.map((text, index) => ({ start: index, end: index + 1, text })),
  } : undefined, [contentId, texts, source, enabled])
  return useSubtitleTranslation(contentId, track, source)
}

export function TextTranslationControl({ translation, label, iconOnly = false }: { translation: ReturnType<typeof useTextTranslation>; label: string; iconOnly?: boolean }) {
  const { inspection, pending, loading, error, notice } = translation
  const done = inspection?.result.texts.length ?? 0
  const complete = Boolean(inspection && done === inspection.result.total)
  const action = pending ? '取消翻译' : complete ? translation.show ? '隐藏译文' : '显示译文' : error ? '重新读取译文' : done > 0 ? '继续翻译' : label
  const visibilityAction = translation.show ? '隐藏译文' : '显示译文'
  const needsSettings = inspection && !inspection.settings.ready && !complete && !pending
  const busy = !complete && Boolean(inspection?.settings.translating || inspection?.active)
  if (translation.alreadyChinese) return null
  return <div className={`text-translation-control${iconOnly ? ' text-translation-icon' : ''}`}>
    <Button variant="quiet" iconOnly={iconOnly} className={iconOnly ? 'icon-button' : 'text-button'} aria-label={action} disabled={!pending && !complete && (loading || (!inspection && !error) || busy && !error)}
      title={error ? action : needsSettings ? '请在工具设置配置 AI 接口和模型' : busy && !pending ? 'AI 正在处理其他任务' : action}
      aria-pressed={complete ? translation.show : undefined}
      onClick={() => { if (pending) translation.cancel(); else if (complete) translation.setShow(!translation.show); else if (error || !inspection?.settings.ready) void translation.reload(); else void translation.translate() }}>
      {pending ? <X size={14}/> : <Languages size={14}/>}{!iconOnly && (pending ? `取消翻译 ${done}/${inspection?.result.total ?? 0}` : action)}
    </Button>
    {done > 0 && !complete && <Button variant="quiet" iconOnly className="icon-button translation-visibility" aria-label={visibilityAction} title={visibilityAction} aria-pressed={translation.show} onClick={() => translation.setShow(!translation.show)}>{translation.show ? <EyeOff size={14}/> : <Eye size={14}/>}</Button>}
    {needsSettings && <a href="/tools#translation">配置 AI</a>}
    {pending && iconOnly && <span role="status">{done}/{inspection?.result.total ?? 0}</span>}
    {!pending && notice && <span role="status">{notice}</span>}
    {error && <span role="alert">{error}</span>}
  </div>
}

export function BilingualTitle({ contentId, text, compact = false, source = 'title', heading = false, children }: { contentId: string; text: string; compact?: boolean; heading?: boolean; source?: 'title' | 'article'; children?: (text: string, original?: string) => ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(!compact)
  useEffect(() => {
    if (!compact || visible) return
    if (!window.IntersectionObserver) { setVisible(true); return }
    const node = root.current
    if (!node) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '200px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [compact, visible])
  const texts = useMemo(() => [text], [text])
  const translation = useTextTranslation(contentId, texts, source, !compact || visible)
  const attempted = useRef('')
  const latest = useRef(translation); latest.current = translation
  const inspection = translation.inspection
  const key = inspection?.result.key ?? ''
  useEffect(() => {
    if (!compact || !visible || !/[a-zA-Z]{3}/.test(text) || isChineseText(text) || !inspection?.settings.ready || inspection.settings.translating || inspection.active || translation.loading || translation.pending || translation.error || inspection.result.texts.length === inspection.result.total || attempted.current === key) return
    let canceled = false
    cardTranslationQueue = cardTranslationQueue.catch(() => {}).then(async () => {
      if (canceled || latest.current.inspection?.result.key !== key || latest.current.inspection.active || latest.current.inspection.settings.translating) return
      attempted.current = key
      await latest.current.translate()
    })
    return () => { canceled = true }
  }, [compact, visible, text, key, inspection, translation.loading, translation.pending, translation.error])
  const translated = translation.show ? translation.inspection?.result.texts[0] : undefined
  const complete = Boolean(inspection && inspection.result.texts.length === inspection.result.total)
  const titleAction = translation.pending ? '取消标题翻译' : complete ? translated ? '显示原标题' : '显示译文' : '翻译标题'
  const toggleTitle = () => {
    if (translation.pending) translation.cancel()
    else if (complete) translation.setShow(!translation.show)
    else if (translation.error || !inspection?.settings.ready) void translation.reload()
    else void translation.translate()
  }
  return <div ref={root} className={`bilingual-title${compact ? ' bilingual-title-compact' : ''}${heading ? ' bilingual-reader-heading' : ''}`}>
    {heading && <h1 aria-label={translated || text}>{translation.alreadyChinese ? text : <button type="button" className="reader-title-toggle" aria-label={`${titleAction}：${translated || text}`} aria-pressed={Boolean(translated)} aria-busy={translation.pending} disabled={!complete && !translation.pending && (translation.loading || !inspection && !translation.error)} title={translation.error || (translated ? text : titleAction)} onClick={toggleTitle}>{translated || text}</button>}</h1>}
    {!compact && !heading && <TextTranslationControl translation={translation} label="翻译标题" iconOnly/>}
    {heading && translation.error && <span className="visually-hidden" role="alert">{translation.error}</span>}
    {!heading && (children ? children(translated || text, translated ? text : undefined) : translated && <p lang="zh-Hans">{translated}</p>)}
  </div>
}

// Compact card translation: translates when the card scrolls into view.
export function CardTranslation(props: CardTextRendererProps) {
  return <BilingualTitle compact {...props}/>
}
