import { Button } from '../../components/ui'
import { AlertCircle, Check, LoaderCircle, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import type { useSummary } from './useSummary'
import type { SummarySource } from './summaryMarkdown'
import { summaryControlState, summaryEmptyInputPresentation, summaryNeedsOutlineRegeneration, summaryStatusPresentation } from './summaryPresentation'
import { ToolbarPopover } from '../../shared/ui/ToolbarPopover'
import './ai.css'

export function openTranscription() {
  const toggle = document.querySelector<HTMLButtonElement>('[data-subtitle-settings-toggle]')
  const needsPanel = toggle?.getAttribute('aria-expanded') !== 'true'
  if (needsPanel) toggle?.click()
  const focusControl = () => {
    const management = document.querySelector<HTMLDetailsElement>('[data-subtitle-management]')
    if (management) management.open = true
    const control = document.querySelector<HTMLElement>('[data-transcription-control]')
    if (!control) {
      document.querySelector<HTMLElement>('#subtitle-title')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    control.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    const button = control.querySelector<HTMLElement>('button:not([disabled])')
    if (button) button.focus({ preventScroll: true })
    else { control.tabIndex = -1; control.focus({ preventScroll: true }) }
  }
  if (needsPanel) window.setTimeout(focusControl, 0)
  else focusControl()
}

export function SummaryControl({ summary, source: _source, onLocateQuote: _onLocateQuote, emptyMessage, emptyAction }: {
  summary: ReturnType<typeof useSummary>; onLocateQuote?: (quote: string) => string | null; source?: SummarySource
  emptyMessage?: string; emptyAction?: ReactNode
}) {
  const { inspection, loading, pending, error, notice, generate, cancel, reload, hasInput } = summary
  const result = inspection?.result
  const { availability, ...presentation } = summaryControlState({ input: hasInput, inspection, loading, pending, error })
  const status = summaryStatusPresentation(availability)
  const emptyInput = summaryEmptyInputPresentation()
  const retry = () => { if (availability === 'error' && inspection) void generate(summaryNeedsOutlineRegeneration(result)); else if (availability === 'error') void reload() }
  const activate = () => {
    if (presentation.action === 'retry') retry()
    else if (presentation.action === 'generate') void generate(availability === 'saved' || summaryNeedsOutlineRegeneration(result))
  }
  return <div className="ai-summary-control">
    {emptyMessage && presentation.action !== 'transcribe' && <ToolbarPopover label="字幕状态提醒" title={emptyMessage} tone={availability === 'error' ? 'danger' : 'warning'} announcement={emptyMessage}><p role={availability === 'error' ? 'alert' : 'status'}>{emptyMessage}</p></ToolbarPopover>}
    {presentation.action === 'transcribe' ? <ToolbarPopover label={presentation.label} title={presentation.title} tone={status.tone} showLabel icon={<Sparkles size={14} aria-hidden="true" />} announcement={emptyMessage || status.message}>
      <p role="status">{emptyMessage || status.message || emptyInput.message}</p>
      {emptyAction !== undefined ? emptyAction : <Button variant="quiet" type="button" className="text-button" onClick={openTranscription}>{status.actionLabel || emptyInput.actionLabel}</Button>}
    </ToolbarPopover> : presentation.action === 'settings' ? <a className="ai-inline-trigger" href="/tools#ai/text" title={presentation.title}><Sparkles size={14} aria-hidden="true" />{presentation.label}</a> : <Button variant="quiet" type="button" className="ai-inline-trigger" aria-busy={pending || loading} disabled={presentation.disabled} title={presentation.title} onClick={activate}>{pending ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}{presentation.label}</Button>}
    {availability === 'busy' && <ToolbarPopover label="摘要暂时不可用" title={status.message} tone={status.tone} announcement={status.message}><p role="status">{status.message}</p></ToolbarPopover>}
    {pending && <ToolbarPopover label="摘要生成进度" title="查看摘要生成进度" announcement={`正在生成，已完成 ${result?.progress?.completedCalls ?? result?.completedCalls ?? 0} / ${result?.progress?.totalCalls ?? result?.totalCalls ?? 0} 次`}><p role="status">{result?.progress?.currentCall ? `已完成 ${result.progress.completedCalls} / ${result.progress.totalCalls} 步，正在请求第 ${result.progress.currentCall} 步` : `正在生成，已完成 ${result?.progress?.completedCalls ?? result?.completedCalls ?? 0} / ${result?.progress?.totalCalls ?? result?.totalCalls ?? 0} 次`}</p><Button variant="quiet" type="button" className="text-button" onClick={cancel}>取消</Button></ToolbarPopover>}
    {notice && <ToolbarPopover label="摘要已更新" title={notice} tone="success" icon={<Check size={15} aria-hidden="true" />} announcement={notice}><p role="status">{notice}</p></ToolbarPopover>}
    {error && <ToolbarPopover label="摘要操作失败" title="查看摘要错误" tone="danger" icon={<AlertCircle size={15} aria-hidden="true" />} announcement={error}><p role="alert">{error}</p><Button variant="quiet" type="button" className="text-button" onClick={retry}>{inspection ? '重试生成' : '重新读取摘要状态'}</Button></ToolbarPopover>}
  </div>
}
