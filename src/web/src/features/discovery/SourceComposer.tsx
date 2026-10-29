import { Button, Input } from '../../components/ui'
import { ArrowRight, FileUp, Link2, LoaderCircle } from 'lucide-react'
import type { RefObject } from 'react'
import type { ContentItem } from '../../shared/api/types'
import { PDFImport } from '../documents/PDFImport'
import { isPaperQuery } from '../documents/paperIdentity'
import { discoverySources, type DiscoverySource } from './sources'

export function detectSource(value: string): DiscoverySource | null {
  const text = value.trim()
  if (isPaperQuery(text)) return 'paper'
  if (/youtube\.com|youtu\.be/i.test(text)) return 'youtube'
  if (/xiaohongshu\.com|xhslink\.com/i.test(text)) return 'xiaohongshu'
  if (/douyin\.com/i.test(text)) return 'douyin'
  if (/xiaoyuzhoufm\.com/i.test(text)) return 'xiaoyuzhou'
  if (/bilibili\.com|^BV[0-9a-z]{10}$|^[1-9][0-9]{0,19}$/i.test(text)) return 'bilibili'
  if (/\.pdf(?:[?#].*)?$/i.test(text)) return 'pdf'
  if (/\.xml(?:[?#].*)?$|\/(?:rss|feed|atom)(?:[/.?#]|$)/i.test(text)) return 'rss'
  return null
}

export function SourceComposer({ source, onSource, draft, onDraft, loading, input, onSubmit, onImported }: {
  source: DiscoverySource
  onSource: (source: DiscoverySource) => void
  draft: string
  onDraft: (value: string) => void
  loading: boolean
  input: RefObject<HTMLInputElement | null>
  onSubmit: () => void
  onImported: (item: ContentItem) => void
}) {
  const selected = discoverySources[source]
  return <section className="source-composer" aria-label="内容来源">
    <div className="source-options" role="group" aria-label="搜索来源">{Object.entries(discoverySources).map(([id, entry]) => <Button variant="quiet" key={id} type="button" aria-pressed={source === id} onClick={() => onSource(id as DiscoverySource)}>{entry.label}</Button>)}</div>
    <form onSubmit={event => { event.preventDefault(); onSubmit() }}><label className="source-input"><Link2 size={19} aria-hidden="true"/><Input ref={input} data-add-content-input aria-label={selected.inputLabel} placeholder={selected.placeholder} value={draft} onChange={event => {
      const next = event.target.value
      const detected = detectSource(next)
      if (detected && detected !== source) onSource(detected)
      onDraft(next)
    }} required maxLength={2048}/></label><Button variant="primary" type="submit" className="button button-primary" disabled={loading || !draft.trim()}>{loading ? <LoaderCircle size={16} className="spin"/> : <ArrowRight size={16}/>}<span>{loading ? '正在获取' : '获取内容'}</span></Button></form>
    <div className="source-composer-footer"><span>{selected.description}</span>{source === 'pdf' && <span className="source-import"><FileUp size={15}/><PDFImport onImported={onImported}/></span>}</div>
  </section>
}
