// Explicit retrieval status rendering (B-T25). Each status has distinct copy
// and tone; semantic_sweep_limited is a coverage limitation, never rendered as
// no_match, and never suppresses valid passages. The frontend renders the
// server's status; it never fabricates a passage or locator.

import type { RetrievalPassageRef, RetrievalResponse } from './retrieval'

export type RetrievalTone = 'ok' | 'info' | 'warning' | 'error'

export interface RetrievalStatusView {
  label: string
  tone: RetrievalTone
  // hint offers a next step (e.g. PDF retry) without hiding the status.
  hint?: string
}

// retrievalStatusView maps a machine status to distinct user-facing copy.
export function retrievalStatusView(status: string): RetrievalStatusView {
  switch (status) {
    case 'ok':
      return { label: '已检索到相关原文', tone: 'ok' }
    case 'lexical_only':
      return { label: '仅词汇检索（嵌入不可用或未启用）', tone: 'info' }
    case 'semantic_sweep_limited':
      return { label: '语义扫描覆盖有限', tone: 'warning', hint: '采样未覆盖全文，零重叠召回受覆盖率限制；这不是“无匹配”。' }
    case 'degraded_budget':
      return { label: '预算降级（已省略摘要/历史）', tone: 'warning' }
    case 'no_match':
      return { label: '未找到相关原文片段', tone: 'info' }
    case 'no_verified_passages':
      return { label: '候选片段均未通过原文校验', tone: 'warning' }
    case 'source_unverified':
      return { label: '部分片段未通过原文校验', tone: 'warning' }
    case 'stale_source':
      return { label: '原文已更新，引用已失效', tone: 'warning', hint: '请重新检索以获取最新原文。' }
    case 'invalid_budget':
      return { label: '检索预算无效', tone: 'error' }
    case 'context_budget_exceeded':
      return { label: '上下文超出预算', tone: 'error' }
    case 'pdf_extracting':
      return { label: 'PDF 文本提取中', tone: 'info', hint: '请稍后重试。' }
    case 'pdf_no_text':
      return { label: 'PDF 没有可用文本', tone: 'warning', hint: '可能为扫描件；请配置本地 OCR 后重试。' }
    case 'pdf_ocr_unavailable':
      return { label: '本地 OCR 不可用', tone: 'warning', hint: '请安装并配置本地 PaddleOCR；不会自动上传云端。' }
    case 'pdf_extract_failed':
      return { label: 'PDF 文本提取失败', tone: 'error', hint: '请重试或检查文件。' }
    case 'embedding_unavailable':
      return { label: '嵌入服务不可用', tone: 'warning' }
    case 'empty':
      return { label: '问题为空', tone: 'info' }
    case 'invalid_input':
      return { label: '输入包含非法字符', tone: 'error' }
    default:
      return { label: `检索状态：${status}`, tone: 'info' }
  }
}

// isCoverageLimited reports whether the status is a semantic-sweep coverage
// limitation (distinct from no_match).
export function isCoverageLimited(status: string): boolean {
  return status === 'semantic_sweep_limited'
}

// passageChipLabel renders a stable, human-readable locator label for a chip.
export function passageChipLabel(passage: RetrievalPassageRef): string {
  switch (passage.source) {
    case 'subtitle':
      return `字幕 ${passage.locator.replace(/^subtitle:/, '')}`
    case 'pdf': {
      const parts = passage.locator.split(':')
      return `PDF 第 ${parts[2] ?? '?'} 页`
    }
    case 'discussion':
      return `讨论 ${passage.locator.replace(/^discussion:/, '')}`
    default:
      return `段落 ${passage.locator.replace(/^article:/, '')}`
  }
}

// hasPassages reports whether the response carries verifiable passages (a
// coverage-limited response still has passages and must not be treated as
// no_match).
export function hasPassages(response?: RetrievalResponse | null): boolean {
  return !!response && Array.isArray(response.passages) && response.passages.length > 0
}