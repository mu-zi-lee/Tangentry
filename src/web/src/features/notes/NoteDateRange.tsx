import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Button, Input, Select } from '../../components/ui'
import { dateRange, localDay } from './timeline'

function dateOf(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}
const keyOf = (date: Date) => localDay(date.getTime() / 1000)

export function NoteDateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [active, setActive] = useState<'from' | 'to' | null>(null)
  const [month, setMonth] = useState(() => dateOf(from || to || keyOf(new Date())))
  const [draft, setDraft] = useState<{ field: 'from' | 'to'; value: string } | null>(null)
  const [yearDraft, setYearDraft] = useState<string | null>(null)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  const today = keyOf(new Date())
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  first.setDate(1 - (first.getDay() + 6) % 7)
  const days = Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index))
  const focusDay = (day: Date) => {
    const key = keyOf(day)
    if (day.getFullYear() < 1970 || day.getFullYear() > 9998) return
    setMonth(day)
    setYearDraft(null)
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)?.focus())
  }
  const open = (field: 'from' | 'to') => {
    if (active === field) { setActive(null); return }
    setActive(field)
    setError('')
    setDraft(null)
    focusDay(dateOf((field === 'from' ? from : to) || from || to || today))
  }
  const close = () => {
    const field = active
    setActive(null)
    root.current?.querySelector<HTMLButtonElement>(`[data-trigger="${field}"]`)?.focus()
  }
  const choose = (value: string) => {
    setError(''); setDraft(null)
    if (active === 'from') {
      onChange(value, to && to >= value ? to : '')
      setActive('to')
      focusDay(dateOf(value))
    } else if (from && value < from) {
      onChange(value, '')
    } else {
      onChange(from, value)
      close()
    }
  }
  const typeDate = (field: 'from' | 'to', value: string) => {
    if (!dateRange(field === 'from' ? value : '', field === 'to' ? value : '')) {
      setError('请输入有效日期，例如 2026-10-29。')
      return
    }
    const nextFrom = field === 'from' ? value : from
    const nextTo = field === 'to' ? value : to
    if (!dateRange(nextFrom, nextTo)) { setError('结束日期应不早于开始日期。'); return }
    setError(''); setDraft(null)
    onChange(nextFrom, nextTo)
  }
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, date: Date) => {
    const next = new Date(date)
    switch (event.key) {
      case 'ArrowLeft': next.setDate(next.getDate() - 1); break
      case 'ArrowRight': next.setDate(next.getDate() + 1); break
      case 'ArrowUp': next.setDate(next.getDate() - 7); break
      case 'ArrowDown': next.setDate(next.getDate() + 7); break
      case 'Home': next.setDate(next.getDate() - (next.getDay() + 6) % 7); break
      case 'End': next.setDate(next.getDate() + 6 - (next.getDay() + 6) % 7); break
      case 'PageUp': next.setMonth(next.getMonth() - 1, 1); break
      case 'PageDown': next.setMonth(next.getMonth() + 1, 1); break
      default: return
    }
    event.preventDefault()
    focusDay(next)
  }
  const changeMonth = (next: Date) => { setMonth(next); setYearDraft(null) }
  const commitYear = () => {
    const year = Number(yearDraft)
    if (yearDraft !== null && Number.isInteger(year) && year >= 1970 && year <= 9998) setMonth(new Date(year, month.getMonth(), 1))
    setYearDraft(null)
  }
  return <div ref={root} className="note-date-range" onKeyDown={event => { if (event.key === 'Escape' && active) { event.preventDefault(); close() } }}>
    <div className="note-date-fields">{(['from', 'to'] as const).map(field => <label key={field}>
      <span>{field === 'from' ? '开始' : '结束'}</span>
      <div><Input type="text" inputMode="numeric" aria-label={field === 'from' ? '笔记开始日期' : '笔记结束日期'} placeholder="年-月-日" maxLength={10} value={draft?.field === field ? draft.value : field === 'from' ? from : to} aria-invalid={Boolean(error && draft?.field === field)} onChange={event => { setDraft({ field, value: event.target.value }); setError('') }} onBlur={event => { if (draft?.field === field) typeDate(field, event.target.value) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); typeDate(field, event.currentTarget.value) } }}/>
        <Button variant="quiet" iconOnly className="icon-button" data-trigger={field} aria-label={field === 'from' ? '选择开始日期' : '选择结束日期'} title={field === 'from' ? '选择开始日期' : '选择结束日期'} aria-expanded={active === field} aria-controls={id} onClick={() => open(field)}><CalendarDays size={14}/></Button>
      </div>
    </label>)}</div>
    {error && <p className="note-date-error" role="alert">{error}</p>}
    {active && <section id={id} className="note-calendar" aria-label="笔记日期范围">
      <div className="note-calendar-heading"><span>{active === 'from' ? '选择开始日期' : '选择结束日期'}</span><Button variant="quiet" iconOnly className="icon-button" aria-label="收起日期选择" title="收起日期选择" onClick={close}><X size={14}/></Button></div>
      <div className="note-calendar-month">
        <Button variant="quiet" iconOnly className="icon-button" aria-label="上个月" title="上个月" disabled={month.getFullYear() === 1970 && month.getMonth() === 0} onClick={() => changeMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={15}/></Button>
        <Input aria-label="日历年份" type="text" inputMode="numeric" maxLength={4} value={yearDraft ?? month.getFullYear()} onChange={event => setYearDraft(event.target.value)} onBlur={commitYear} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitYear() } }}/>
        <Select aria-label="日历月份" value={month.getMonth()} onChange={event => changeMonth(new Date(month.getFullYear(), Number(event.target.value), 1))}>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index}>{index + 1} 月</option>)}</Select>
        <Button variant="quiet" iconOnly className="icon-button" aria-label="下个月" title="下个月" disabled={month.getFullYear() === 9998 && month.getMonth() === 11} onClick={() => changeMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={15}/></Button>
      </div>
      <div role="grid" aria-label={month.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}>
        <div role="row">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span role="columnheader" key={day}>{day}</span>)}</div>
        {Array.from({ length: 6 }, (_, week) => <div role="row" key={week}>{days.slice(week * 7, week * 7 + 7).map(day => {
          const key = keyOf(day)
          const selected = key === from || key === to
          return <span role="gridcell" key={key} aria-selected={selected} data-between={Boolean(from && to && key > from && key < to)}><button type="button" data-date={key} data-outside={day.getMonth() !== month.getMonth()} tabIndex={key === keyOf(month) ? 0 : -1} aria-current={key === today ? 'date' : undefined} aria-label={day.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })} disabled={day.getFullYear() < 1970 || day.getFullYear() > 9998} onClick={() => choose(key)} onKeyDown={event => navigate(event, day)}>{day.getDate()}</button></span>
        })}</div>)}
      </div>
      <div className="note-calendar-footer"><Button variant="quiet" onClick={() => focusDay(new Date())}>今天</Button><Button variant="quiet" disabled={!from && !to} onClick={() => { setDraft(null); setError(''); onChange('', ''); close() }}>清除日期</Button></div>
    </section>}
  </div>
}
