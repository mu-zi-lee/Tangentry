import { lazy, Suspense } from 'react'
import { CircleAlert, Info, Sparkles } from 'lucide-react'
import { compactCitationIds } from './workbench'

const MarkdownRenderer = lazy(() => import('../notes/MarkdownRenderer'))

/**
 * RetrievalAnswer shows a model answer grounded in the retrieved passages. It
 * states provenance plainly: the answer is generated from the selection, the
 * locators are positions rather than proof, and OCR-derived text may contain
 * recognition errors. It never renders an empty answer as if it were real.
 */
export function RetrievalAnswer({ question, answer, passageCount, maxContextRunes, ocrDerived, pending, error, onSettings }: {
  question: string
  answer: string | null
  passageCount: number
  maxContextRunes: number
  ocrDerived: boolean
  pending: boolean
  error: string
  onSettings: () => void
}) {
  if (error) {
    return (
      <div className="retrieval-answer is-error" role="alert">
        <span className="retrieval-answer-head"><CircleAlert size={16} strokeWidth={1.9} aria-hidden="true"/>未能生成回答</span>
        <p className="retrieval-answer-error">{error}</p>
        <button type="button" className="retrieval-answer-link" onClick={onSettings}>检查对话模型设置</button>
      </div>
    )
  }

  if (pending && !answer) {
    return (
      <div className="retrieval-answer" role="status" aria-live="polite">
        <span className="retrieval-answer-head"><Sparkles size={16} strokeWidth={1.9} aria-hidden="true"/>正在根据原文生成回答…</span>
        <p className="retrieval-answer-hint">模型会读取本次检索到的 {passageCount} 条原文，通常需要几秒。</p>
      </div>
    )
  }

  if (!answer) return null

  return (
    <div className="retrieval-answer" aria-label="模型回答">
      <header className="retrieval-answer-head">
        <Sparkles size={16} strokeWidth={1.9} aria-hidden="true"/>
        <span>根据原文生成的回答</span>
        <span className="retrieval-answer-badge">AI</span>
      </header>
      {question && <p className="retrieval-answer-question">问题：{question}</p>}
      <div className="retrieval-answer-body">
        <Suspense fallback={<p className="retrieval-answer-hint">{compactCitationIds(answer)}</p>}>
          <MarkdownRenderer>{compactCitationIds(answer)}</MarkdownRenderer>
        </Suspense>
      </div>
      <p className="retrieval-answer-provenance">
        <Info size={13} strokeWidth={1.8} aria-hidden="true"/>
        回答基于 {passageCount} 条原文生成（最多读取 {maxContextRunes.toLocaleString('en-US')} 字符）。定位符只表示位置，不代表结论正确；请对照下列原文核对。
        {ocrDerived && ' 本次原文含 OCR 识别文本，可能存在识别错误。'}
      </p>
    </div>
  )
}