import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button, Checkbox, Input, Select } from '../../components/ui'
import {
  MAX_CONTEXT_RUNES,
  MAX_SWEEP_CANDIDATES,
  MIN_CONTEXT_RUNES,
  batchingModes,
  defaultWorkbenchOptions,
  workbenchModes,
  type WorkbenchCeilings,
  type WorkbenchOptions,
} from './workbench'
import { PAGE_SIZES, type WorkbenchPrefs } from './workbenchPrefs'

function NumberField({ label, hint, value, min, max, ceiling, disabled, onChange }: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  ceiling?: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="retrieval-knob">
      <span className="retrieval-knob-label">
        {label}
        {typeof ceiling === 'number' && <em className="retrieval-knob-ceiling">已保存上限 {ceiling}</em>}
      </span>
      <Input
        type="number"
        value={String(value)}
        min={min}
        max={max}
        step={1}
        disabled={disabled}
        onChange={event => onChange(Number(event.target.value))}
        aria-label={label}
      />
      {hint && <span className="retrieval-knob-hint">{hint}</span>}
    </label>
  )
}

/**
 * RetrievalOptionsPanel exposes every per-run knob the engine honours, plus
 * display-only preferences. Request budgets can only tighten the saved ceilings
 * (retrieval.resolveRunBudget); weights, topK, batch size and the model are
 * settings-owned and are linked rather than duplicated here.
 */
export function RetrievalOptionsPanel({ open, onToggle, prefs, ceilings, pending, onOptions, onPrefs, onReset, onOpenSettings }: {
  open: boolean
  onToggle: () => void
  prefs: WorkbenchPrefs
  ceilings?: WorkbenchCeilings
  pending: boolean
  onOptions: (patch: Partial<WorkbenchOptions>) => void
  onPrefs: (patch: Partial<WorkbenchPrefs>) => void
  onReset: () => void
  onOpenSettings: () => void
}) {
  const options = prefs.options
  const sweepOff = options.sweepCandidates === 0
  const embeddingOff = options.maxEmbeddingRequests === 0
  const defaults = defaultWorkbenchOptions()
  // Compare field by field: key order differs between the two constructors, so
  // a JSON string comparison would never report "already default".
  const isDefault = (Object.keys(defaults) as (keyof WorkbenchOptions)[]).every(key => options[key] === defaults[key])

  return (
    <section className={`retrieval-options${open ? ' is-open' : ''}`} aria-label="高级选项">
      <button type="button" className="retrieval-options-toggle" onClick={onToggle} aria-expanded={open} aria-controls="retrieval-options-body">
        <SlidersHorizontal size={15} strokeWidth={1.8} aria-hidden="true"/>
        <span className="retrieval-options-title">高级选项</span>
        <span className="retrieval-options-summary">
          {workbenchModes.find(item => item.value === options.mode)?.label}
          {' · '}{options.maxChars.toLocaleString('en-US')} 字符
          {' · '}{options.batchingMode === 'split' ? '分离批' : '合并批'}
          {sweepOff && ' · 扫描关闭'}
          {embeddingOff && ' · 嵌入关闭'}
        </span>
        <ChevronDown size={16} strokeWidth={2} className="retrieval-options-chevron" aria-hidden="true"/>
      </button>

      {open && (
        <div className="retrieval-options-body" id="retrieval-options-body">
          <div className="retrieval-knob-group">
            <h3>检索与预算</h3>
            <div className="retrieval-knobs">
              <NumberField
                label="上下文预算（字符）"
                hint={`${MIN_CONTEXT_RUNES.toLocaleString('en-US')}–${MAX_CONTEXT_RUNES.toLocaleString('en-US')}；超出范围回到默认 120,000`}
                value={options.maxChars}
                min={MIN_CONTEXT_RUNES}
                max={MAX_CONTEXT_RUNES}
                disabled={pending}
                onChange={value => onOptions({ maxChars: value })}
              />

              <label className="retrieval-knob">
                <span className="retrieval-knob-label">批处理模式</span>
                <Select
                  value={options.batchingMode}
                  onChange={event => onOptions({ batchingMode: event.target.value as WorkbenchOptions['batchingMode'] })}
                  options={batchingModes.map(item => ({ value: item.value, label: item.label }))}
                  disabled={pending}
                  aria-label="批处理模式"
                />
                <span className="retrieval-knob-hint">{batchingModes.find(item => item.value === options.batchingMode)?.hint}</span>
              </label>

              <NumberField
                label="嵌入请求上限"
                hint="0 表示关闭嵌入；只能比已保存上限更紧"
                value={options.maxEmbeddingRequests}
                min={0}
                max={ceilings?.maxEmbeddingRequests ?? 1000}
                ceiling={ceilings?.maxEmbeddingRequests}
                disabled={pending}
                onChange={value => onOptions({ maxEmbeddingRequests: value })}
              />

              <NumberField
                label="嵌入字符上限"
                hint="送入嵌入服务的字符总量；只能收紧"
                value={options.maxEmbeddingChars}
                min={0}
                max={ceilings?.maxEmbeddingChars ?? 1000000}
                ceiling={ceilings?.maxEmbeddingChars}
                disabled={pending}
                onChange={value => onOptions({ maxEmbeddingChars: value })}
              />

              <NumberField
                label="位置分层扫描候选数"
                hint={`0 表示关闭扫描；上限 ${MAX_SWEEP_CANDIDATES}。扫描是零重叠改写仍能召回的关键`}
                value={options.sweepCandidates}
                min={0}
                max={MAX_SWEEP_CANDIDATES}
                disabled={pending}
                onChange={value => onOptions({ sweepCandidates: value })}
              />

            </div>

            {sweepOff && (
              <p className="retrieval-knob-warning" role="note">
                已关闭位置分层扫描。此时不发送嵌入请求上限，沿用已保存设置——否则服务端会把扫描恢复为默认 90 个候选。
              </p>
            )}
            {embeddingOff && (
              <p className="retrieval-knob-warning" role="note">
                嵌入请求上限为 0，本次不会调用嵌入服务，等价于仅词汇检索。
              </p>
            )}
          </div>

          <div className="retrieval-knob-group">
            <h3>显示偏好</h3>
            <div className="retrieval-display-prefs">
              <Checkbox
                label="高亮片段中与问题重合的词"
                checked={prefs.highlight}
                onChange={event => onPrefs({ highlight: event.target.checked })}
              />
              <label className="retrieval-knob retrieval-knob-inline">
                <span className="retrieval-knob-label">每页显示片段</span>
                <Select
                  value={String(prefs.pageSize)}
                  onChange={event => onPrefs({ pageSize: Number(event.target.value) })}
                  options={PAGE_SIZES.map(size => ({ value: String(size), label: `${size} 条` }))}
                  aria-label="每页显示片段"
                  className="retrieval-page-size"
                />
              </label>
              <p className="retrieval-knob-hint">
                服务端最多可返回 topK 条片段。分页只影响一次渲染多少张卡片，其余可一键展开，不会丢弃任何结果。
              </p>
            </div>
          </div>

          <div className="retrieval-options-actions">
            <span className="retrieval-options-note">混合权重、topK、批大小、嵌入模型与重排开关由上方的「检索设置」统一管理。</span>
            <Button variant="quiet" type="button" onClick={onOpenSettings}>打开检索设置</Button>
            <Button variant="quiet" type="button" onClick={onReset} disabled={pending || isDefault}>
              <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true"/>恢复默认
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
