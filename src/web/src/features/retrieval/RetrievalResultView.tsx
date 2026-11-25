import { useEffect, useState } from 'react'
import { Check, CircleCheck, Copy, Info, TriangleAlert } from 'lucide-react'
import { Button } from '../../components/ui'
import type { ContentItem } from '../../shared/api/types'
import { passageChipLabel, retrievalStatusView, type RetrievalTone } from '../ai/retrievalPresentation'
import {
  compactLocator,
  defaultWorkbenchOptions,
  highlightSegments,
  passagePage,
  noResultGuidance,
  sortPassages,
  type PassageSort,
  passagePosition,
  type NoResultAction,
  type WorkbenchOptions,
  queryTerms,
  workbenchScoreLabel,
  workbenchScoreWidth,
  type WorkbenchPassage,
  type WorkbenchResult,
} from './workbench'
import { PassageContext } from './PassageContext'
import { paginate } from './workbenchPrefs'

const toneIcon: Record<RetrievalTone, typeof Info> = {
  ok: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: TriangleAlert,
}

function ScoreBar({ label, value, kind, title }: { label: string; value: number; kind: string; title?: string }) {
  return (
    <span className={`retrieval-score retrieval-score-${kind}`} title={title ?? `${label}得分 ${workbenchScoreLabel(value)}`}>
      <span className="retrieval-score-label">{label}</span>
      <span className="retrieval-score-track" aria-hidden="true">
        <span className="retrieval-score-fill" style={{ width: `${workbenchScoreWidth(value)}%` }}/>
      </span>
      <span className="retrieval-score-value">{workbenchScoreLabel(value)}</span>
    </span>
  )
}

function PassageText({ text, terms, highlight }: { text: string; terms: readonly string[]; highlight: boolean }) {
  if (!highlight) return <p className="retrieval-text">{text}</p>
  const segments = highlightSegments(text, terms)
  return (
    <p className="retrieval-text">
      {segments.map((segment, index) => segment.match
        ? <mark key={index} className="retrieval-mark">{segment.text}</mark>
        : <span key={index}>{segment.text}</span>)}
    </p>
  )
}

/**
 * RetrievalResultView renders the server's retrieval outcome: the distinct
 * status, budget metrics and the selected passages with their exact text,
 * locators and scores. It never fabricates a passage, and a coverage-limited
 * status keeps its passages visible (B-T25). Long result lists are paginated for
 * readability, and the remaining count is always shown so a short list is never
 * mistaken for the whole result.
 */
const noResultLabels: Record<NoResultAction, string> = {
  'enable-sweep': '开启语义扫描',
  'widen-budget': '扩大到 120,000 字符',
  'try-hybrid': '改用混合检索',
  clear: '清空问题',
}

export function RetrievalResultView({ result, selected, onRead, question = '', highlight = true, pageSize = 10, options, onNoResultAction, sort = 'relevance', onSortChange, elapsedMs }: {
  result: WorkbenchResult
  selected?: ContentItem
  onRead: (item: ContentItem, page?: number) => void
  question?: string
  highlight?: boolean
  pageSize?: number
  options?: WorkbenchOptions
  onNoResultAction?: (action: NoResultAction) => void
  sort?: PassageSort
  onSortChange?: (sort: PassageSort) => void
  elapsedMs?: number
}) {
  const [copied, setCopied] = useState('')
  const [moreMetrics, setMoreMetrics] = useState(false)
  const [shown, setShown] = useState(pageSize)
  // A new search or a changed page size restarts from the first page.
  useEffect(() => { setShown(pageSize) }, [result, pageSize])
  const view = retrievalStatusView(result.retrieval.status)
  const ToneIcon = toneIcon[view.tone]
  const terms = highlight ? queryTerms(question) : []
  const ordered = sortPassages(result.passages, sort)
  const { visible, remaining } = paginate(ordered, shown)

  const copy = async (locator: string) => {
    try {
      await navigator.clipboard.writeText(locator)
      setCopied(locator)
    } catch {
      // Clipboard access can be refused; the locator stays visible on screen.
    }
  }

  return (
    <div className="retrieval-result" id="retrieval-results" tabIndex={-1} aria-label="检索结果">
      <div className={`retrieval-status retrieval-status-${view.tone}`} role="status" aria-label="检索状态" data-status={result.retrieval.status}>
        <span className="retrieval-status-icon" aria-hidden="true"><ToneIcon size={16} strokeWidth={1.9}/></span>
        <span className="retrieval-status-body">
          <span className="retrieval-status-label">{view.label}</span>
          {view.hint && <span className="retrieval-status-hint">{view.hint}</span>}
        </span>
      </div>

      <dl className="retrieval-metrics">
        <div><dt>命中片段</dt><dd>{result.passages.length}</dd></div>
        <div><dt>检索方式</dt><dd>{result.retrieval.mode || '—'}</dd></div>
        <div><dt>重排</dt><dd>{result.retrieval.rerank.enabled ? (result.retrieval.rerank.model || '已启用') : '未启用'}</dd></div>
        {(typeof result.elapsedMs === 'number' || typeof elapsedMs === 'number') && (
          <div>
            <dt>检索耗时</dt>
            <dd title={typeof result.elapsedMs === 'number' ? '服务端选取耗时' : '客户端计时（服务端未返回耗时）'}>
              {typeof result.elapsedMs === 'number' ? result.elapsedMs : elapsedMs} ms
            </dd>
          </div>
        )}
        {moreMetrics && (
          <>
            <div><dt>上下文字符</dt><dd>{result.contextChars.toLocaleString('en-US')}</dd></div>
            <div><dt>嵌入模型</dt><dd>{result.retrieval.embedding.model || '未启用'}</dd></div>
            <div><dt>嵌入请求</dt><dd>{result.retrieval.embedding.requests}</dd></div>
            <div><dt>缓存命中</dt><dd>{result.retrieval.embedding.cacheHits ?? 0}</dd></div>
            <div><dt>预算状态</dt><dd>{result.retrieval.embedding.budgetStatus || '—'}</dd></div>
          </>
        )}
      </dl>
      <div className="retrieval-result-bar">
        {onSortChange && (
          <div className="retrieval-segmented retrieval-sort" role="group" aria-label="结果排序">
            <button type="button" className={`retrieval-segment${sort !== 'source' ? ' is-active' : ''}`} aria-pressed={sort !== 'source'} onClick={() => onSortChange('relevance')}>按相关度</button>
            <button type="button" className={`retrieval-segment${sort === 'source' ? ' is-active' : ''}`} aria-pressed={sort === 'source'} onClick={() => onSortChange('source')}>按原文顺序</button>
          </div>
        )}
        <button type="button" className="retrieval-more-metrics" aria-expanded={moreMetrics} onClick={() => setMoreMetrics(value => !value)}>
          {moreMetrics ? '收起指标' : '更多指标'}
        </button>
      </div>

      {result.passages.length > visible.length && (
        <p className="retrieval-hidden" role="note">
          已显示 {visible.length} / 共 {result.passages.length} 条片段，其余 {remaining} 条尚未展开——它们同样被服务端选中。
        </p>
      )}

      {visible.length > 0 ? (
        <ol className="retrieval-passages" aria-label="检索到的原文片段">
          {visible.map((passage: WorkbenchPassage, index) => (
            <li key={passage.passageId} className="retrieval-passage" data-passage-id={passage.passageId}>
              <div className="retrieval-passage-head">
                <span className="retrieval-rank" aria-hidden="true">{index + 1}</span>
                <span className="retrieval-chip">{passageChipLabel(passage)}</span>
                <span className="retrieval-position" title={passage.locator}>{passagePosition(passage)}</span>
                <code className="retrieval-locator" title={passage.locator}>{compactLocator(passage.locator)}</code>
                <button
                  type="button"
                  className="retrieval-copy"
                  onClick={() => void copy(passage.locator)}
                  title="复制定位符"
                  aria-label={`复制定位符 ${passage.locator}`}
                >
                  {copied === passage.locator ? <Check size={13} strokeWidth={2}/> : <Copy size={13} strokeWidth={1.8}/>}
                </button>
              </div>

              <div className="retrieval-scores">
                <ScoreBar label="混合" value={passage.score} kind="hybrid" title={`混合得分 ${workbenchScoreLabel(passage.score)}（相对本次最佳片段归一化）`}/>
                <ScoreBar label="词汇" value={passage.lexicalScore} kind="lexical" title={`词汇得分 ${workbenchScoreLabel(passage.lexicalScore)}（绝对分）`}/>
                <ScoreBar label="语义" value={passage.cosineScore} kind="semantic" title={`语义余弦 ${workbenchScoreLabel(passage.cosineScore)}`}/>
                {(passage.rerankScore ?? 0) > 0 && (
                  <ScoreBar label="重排" value={passage.rerankScore ?? 0} kind="rerank" title={`重排得分 ${workbenchScoreLabel(passage.rerankScore ?? 0)}（相对本次请求）`}/>
                )}
              </div>

              <PassageText text={passage.text} terms={terms} highlight={highlight}/>

              {passage.source === 'pdf' && passagePage(passage.locator) !== null && (
                <PassageContext
                  contentId={passage.contentId}
                  page={passagePage(passage.locator)!}
                  startRune={passage.startRune}
                  endRune={passage.endRune}
                />
              )}

              <div className="retrieval-passage-foot">
                <span title="来源版本">版本 <code>{passage.sourceVersion || '—'}</code></span>
                <span title="原文文本 SHA-256">校验 <code>{passage.textSha256 ? `${passage.textSha256.slice(0, 12)}…` : '—'}</code></span>
                <span title="原文字符区间">区间 <code>{passage.startRune}–{passage.endRune}</code></span>
                {selected && selected.id === passage.contentId && (
                  <Button
                    variant="quiet"
                    type="button"
                    onClick={() => onRead(selected, passagePage(passage.locator) ?? undefined)}
                  >
                    {passagePage(passage.locator) !== null ? `跳到第 ${passagePage(passage.locator)} 页` : '打开原文'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <section className="empty-state retrieval-noresult">
          <h2>{noResultGuidance(result.retrieval.status, options ?? defaultWorkbenchOptions()).title}</h2>
          <p>{noResultGuidance(result.retrieval.status, options ?? defaultWorkbenchOptions()).reason}</p>
          {onNoResultAction && (
            <div className="retrieval-noresult-actions">
              {noResultGuidance(result.retrieval.status, options ?? defaultWorkbenchOptions()).actions.map(action => (
                <Button key={action} variant="secondary" type="button" onClick={() => onNoResultAction(action)}>
                  {noResultLabels[action]}
                </Button>
              ))}
            </div>
          )}
        </section>
      )}

      {remaining > 0 && (
        <div className="retrieval-more">
          <Button variant="secondary" type="button" onClick={() => setShown(current => current + pageSize)}>
            加载更多（还有 {remaining} 条）
          </Button>
          <Button variant="quiet" type="button" onClick={() => setShown(result.passages.length)}>
            全部展开
          </Button>
        </div>
      )}
    </div>
  )
}
