import type { RetrievalResponse } from './retrieval'
import { retrievalStatusView, passageChipLabel, hasPassages } from './retrievalPresentation'

// RetrievalStatus renders the server's explicit retrieval status and the
// verifiable passage chips. It never fabricates a passage or locator, and a
// coverage-limited status (semantic_sweep_limited) is shown as a coverage
// limitation — never as no_match — keeping any valid passages visible.
export function RetrievalStatus({ response }: { response?: RetrievalResponse | null }) {
  if (!response) return null
  const view = retrievalStatusView(response.status)
  return (
    <div className={`ai-retrieval-status ai-retrieval-${view.tone}`} role="status" aria-label="检索状态" data-status={response.status}>
      <span className="ai-retrieval-label">{view.label}</span>
      {view.hint && <span className="ai-retrieval-hint">{view.hint}</span>}
      {hasPassages(response) && (
        <ul className="ai-retrieval-passages" aria-label="检索到的原文片段">
          {response.passages.map(passage => (
            <li key={passage.passageId} className="ai-retrieval-chip" data-passage-id={passage.passageId} title={passage.locator}>
              {passageChipLabel(passage)}
            </li>
          ))}
        </ul>
      )}
      {response.embedding.model && (
        <span className="ai-retrieval-embedding">嵌入：{response.embedding.model} · {response.embedding.requests} 次请求</span>
      )}
    </div>
  )
}