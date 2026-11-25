import { ChevronDown, ChevronUp } from 'lucide-react'
import { useId } from 'react'

export interface NumberStepperProps {
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  label: string
  hint?: string
  onChange: (value: number) => void
}

/** Clamps a stepped value into range and kills float drift from 0.05 steps. */
export function stepValue(current: number, delta: number, min: number, max: number): number {
  const base = Number.isFinite(current) ? current : min
  const next = Math.round((base + delta) * 1000) / 1000
  return Math.min(max, Math.max(min, next))
}

/**
 * Moves to the neighbouring allowed choice, ordered by numeric value. Used for
 * enumerated settings such as the embedding dimension, where an arbitrary step
 * would produce a value the provider rejects.
 */
export function stepChoice(choices: readonly number[], current: number, direction: 1 | -1): number {
  const sorted = Array.from(new Set(choices)).sort((a, b) => a - b)
  if (sorted.length === 0) return current
  const index = sorted.indexOf(current)
  if (index === -1) {
    // Unknown current value: snap to the nearest allowed one in the direction.
    const next = direction > 0
      ? sorted.find(value => value > current) ?? sorted[sorted.length - 1]
      : [...sorted].reverse().find(value => value < current) ?? sorted[0]
    return next
  }
  const target = Math.min(sorted.length - 1, Math.max(0, index + direction))
  return sorted[target]
}

/**
 * NumberStepper is a numeric field with always-visible up/down controls, so the
 * fact that a value can be adjusted is visible without hovering or guessing.
 * Native spinners are hidden in CSS to avoid a second, inconsistent affordance;
 * the arrow keys still work because the control stays a real number input.
 */
export function NumberStepper({ value, min, max, step = 1, disabled = false, label, hint, onChange }: NumberStepperProps) {
  const id = useId()
  const atMin = value <= min
  const atMax = value >= max
  const apply = (delta: number) => onChange(stepValue(value, delta, min, max))

  return (
    <span className={`number-stepper${disabled ? ' is-disabled' : ''}`}>
      <span className="number-stepper-box">
      <input
        id={id}
        className="ui-input number-stepper-input"
        type="number"
        inputMode="numeric"
        value={String(value)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={event => onChange(Number(event.target.value))}
      />
      <span className="number-stepper-buttons">
        <button
          type="button"
          className="number-stepper-button"
          tabIndex={-1}
          aria-label={`增加${label}`}
          title={`增加${label}`}
          disabled={disabled || atMax}
          onClick={() => apply(step)}
        >
          <ChevronUp size={12} strokeWidth={2.4} aria-hidden="true"/>
        </button>
        <button
          type="button"
          className="number-stepper-button"
          tabIndex={-1}
          aria-label={`减少${label}`}
          title={`减少${label}`}
          disabled={disabled || atMin}
          onClick={() => apply(-step)}
        >
          <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true"/>
        </button>
      </span>
      </span>
      {hint && <span className="number-stepper-hint" id={`${id}-hint`}>{hint}</span>}
    </span>
  )
}