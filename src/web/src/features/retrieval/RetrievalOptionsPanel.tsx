import { ChevronDown, ChevronUp, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button, Checkbox, Select } from '../../components/ui'
import { NumberStepper, stepChoice } from './NumberStepper'
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
        {typeof ceiling === 'number' && <em className="retrieval-knob-ceiling">Saved ceiling {ceiling}</em>}
      </span>
      <NumberStepper
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        label={label}
        onChange={onChange}
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
    <section className={`retrieval-options${open ? ' is-open' : ''}`} aria-label="Advanced options">
      <button type="button" className="retrieval-options-toggle" onClick={onToggle} aria-expanded={open} aria-controls="retrieval-options-body">
        <SlidersHorizontal size={15} strokeWidth={1.8} aria-hidden="true"/>
        <span className="retrieval-options-title">Advanced options</span>
        <span className="retrieval-options-summary">
          {workbenchModes.find(item => item.value === options.mode)?.label}
          {' · '}{options.maxChars.toLocaleString('en-US')} chars
          {' · '}{options.batchingMode === 'split' ? 'split' : 'shared'}
          {sweepOff && ' · sweep off'}
          {embeddingOff && ' · embedding off'}
        </span>
        <ChevronDown size={16} strokeWidth={2} className="retrieval-options-chevron" aria-hidden="true"/>
      </button>

      {open && (
        <div className="retrieval-options-body" id="retrieval-options-body">
          <div className="retrieval-knob-group">
            <h3>Retrieval and budget</h3>
            <div className="retrieval-knobs">
              <NumberField
                label="Context budget (chars)"
                hint={`${MIN_CONTEXT_RUNES.toLocaleString('en-US')}–${MAX_CONTEXT_RUNES.toLocaleString('en-US')}; out of range falls back to 120,000`}
                value={options.maxChars}
                min={MIN_CONTEXT_RUNES}
                max={MAX_CONTEXT_RUNES}
                disabled={pending}
                onChange={value => onOptions({ maxChars: value })}
              />

              <label className="retrieval-knob">
                <span className="retrieval-knob-label">Batch mode</span>
                <Select
                  value={options.batchingMode}
                  onChange={event => onOptions({ batchingMode: event.target.value as WorkbenchOptions['batchingMode'] })}
                  options={batchingModes.map(item => ({ value: item.value, label: item.label }))}
                  disabled={pending}
                  aria-label="Batch mode"
                />
                <span className="retrieval-knob-hint">{batchingModes.find(item => item.value === options.batchingMode)?.hint}</span>
              </label>

              <NumberField
                label="Embedding request limit"
                hint="0 turns embedding off; can only tighten the saved ceiling"
                value={options.maxEmbeddingRequests}
                min={0}
                max={ceilings?.maxEmbeddingRequests ?? 1000}
                ceiling={ceilings?.maxEmbeddingRequests}
                disabled={pending}
                onChange={value => onOptions({ maxEmbeddingRequests: value })}
              />

              <NumberField
                label="Embedding character limit"
                hint="Total characters sent to the embedding service; tightening only"
                value={options.maxEmbeddingChars}
                min={0}
                max={ceilings?.maxEmbeddingChars ?? 1000000}
                ceiling={ceilings?.maxEmbeddingChars}
                disabled={pending}
                onChange={value => onOptions({ maxEmbeddingChars: value })}
              />

              <NumberField
                label="Positional sweep candidates"
                hint={`0 disables the sweep; max ${MAX_SWEEP_CANDIDATES}. The sweep is what still recalls zero-overlap paraphrases`}
                value={options.sweepCandidates}
                min={0}
                max={MAX_SWEEP_CANDIDATES}
                disabled={pending}
                onChange={value => onOptions({ sweepCandidates: value })}
              />

            </div>

            {sweepOff && (
              <p className="retrieval-knob-warning" role="note">
                The positional sweep is off. The embedding request limit is not sent, so the saved setting applies — otherwise the server would restore the default 90 candidates.
              </p>
            )}
            {embeddingOff && (
              <p className="retrieval-knob-warning" role="note">
                The embedding request limit is 0, so this run makes no embedding calls — equivalent to Lexical only.
              </p>
            )}
          </div>

          <div className="retrieval-knob-group">
            <h3>Display preferences</h3>
            <div className="retrieval-display-prefs">
              <Checkbox
                label="Highlight words that overlap with the question"
                checked={prefs.highlight}
                onChange={event => onPrefs({ highlight: event.target.checked })}
              />
              <label className="retrieval-knob retrieval-knob-inline">
                <span className="retrieval-knob-label">Passages per page</span>
                <span className="number-stepper number-stepper-select retrieval-page-size">
                  <span className="number-stepper-box">
                    <Select
                      value={String(prefs.pageSize)}
                      onChange={event => onPrefs({ pageSize: Number(event.target.value) })}
                      options={PAGE_SIZES.map(size => ({ value: String(size), label: `${size}` }))}
                      aria-label="Passages per page"
                    />
                    <span className="number-stepper-buttons">
                      <button type="button" className="number-stepper-button" tabIndex={-1}
                        aria-label="Increase passages per page" title="Increase passages per page"
                        disabled={prefs.pageSize >= Math.max(...PAGE_SIZES)}
                        onClick={() => onPrefs({ pageSize: stepChoice(PAGE_SIZES, prefs.pageSize, 1) })}>
                        <ChevronUp size={12} strokeWidth={2.4} aria-hidden="true"/>
                      </button>
                      <button type="button" className="number-stepper-button" tabIndex={-1}
                        aria-label="Decrease passages per page" title="Decrease passages per page"
                        disabled={prefs.pageSize <= Math.min(...PAGE_SIZES)}
                        onClick={() => onPrefs({ pageSize: stepChoice(PAGE_SIZES, prefs.pageSize, -1) })}>
                        <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true"/>
                      </button>
                    </span>
                  </span>
                </span>
              </label>
              <p className="retrieval-knob-hint">
                The server can return up to topK passages. Paging only controls how many cards render at once; the rest expand with one click and nothing is discarded.
              </p>
            </div>
          </div>

          <div className="retrieval-options-actions">
            <span className="retrieval-options-note">Hybrid weights, topK, batch size, the embedding model and the rerank switch live under Retrieval settings above.</span>
            <Button variant="quiet" type="button" onClick={onOpenSettings}>Open retrieval settings</Button>
            <Button variant="quiet" type="button" onClick={onReset} disabled={pending || isDefault}>
              <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true"/>Reset to defaults
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
