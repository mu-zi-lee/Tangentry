import { Check, ChevronDown, Quote } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '../../components/ui'
import type { ExcerptRadius } from './subtitleExcerpt'

export function SubtitleExcerptAction({ time, paragraph = false, radius, onExcerpt }: {
  time: string; paragraph?: boolean; radius: ExcerptRadius; onExcerpt: (radius: ExcerptRadius) => void
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const choices = [[0, paragraph ? '本段' : '本句'], [1, '前后一句'], [2, '前后两句']] as const
  useEffect(() => {
    if (!open) return
    const reposition = () => {
      if (!trigger.current || !panel.current) return
      const rect = trigger.current.getBoundingClientRect()
      const menu = panel.current
      menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, rect.right - menu.offsetWidth))}px`
      menu.style.top = `${Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, rect.bottom + menu.offsetHeight + 4 > innerHeight ? rect.top - menu.offsetHeight - 4 : rect.bottom + 4))}px`
    }
    reposition()
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true) }
  }, [open])
  return <div className="subtitle-excerpt-action">
    <Button variant="quiet" type="button" className="subtitle-excerpt-button" aria-label={`摘录字幕原句 ${time}`} title={`摘录${choices[radius][1]}到笔记`} onClick={() => onExcerpt(radius)}><Quote size={14} aria-hidden="true"/><span>摘录</span></Button>
    <Button ref={trigger} variant="quiet" type="button" className="subtitle-excerpt-options" aria-label={`选择摘录范围 ${time}`} title="选择摘录范围" aria-controls={id} aria-expanded={open} popoverTarget={id}><ChevronDown size={12} aria-hidden="true"/></Button>
    <div ref={panel} id={id} popover="auto" className="subtitle-excerpt-menu" role="group" aria-label={`摘录范围 ${time}`} onToggle={event => setOpen(event.newState === 'open')}>
      <span>摘录到笔记</span>
      {choices.map(([value, label]) => <Button key={value} variant="quiet" type="button" onClick={() => { panel.current?.hidePopover(); onExcerpt(value) }}><span>{label}</span>{radius === value && <Check size={14} aria-hidden="true"/>}</Button>)}
    </div>
  </div>
}
