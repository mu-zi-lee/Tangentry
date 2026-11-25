import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NumberStepper, stepChoice, stepValue } from './NumberStepper'

const render = (over: Partial<React.ComponentProps<typeof NumberStepper>> = {}) =>
  renderToStaticMarkup(createElement(NumberStepper, {
    value: 24, min: 0, max: 100, label: 'Embedding request limit', onChange: () => {}, ...over,
  }))

describe('stepValue', () => {
  it('steps by the given delta', () => {
    expect(stepValue(24, 1, 0, 100)).toBe(25)
    expect(stepValue(24, -1, 0, 100)).toBe(23)
  })

  it('clamps at both bounds', () => {
    expect(stepValue(100, 1, 0, 100)).toBe(100)
    expect(stepValue(0, -1, 0, 100)).toBe(0)
  })

  it('keeps fractional steps free of float drift', () => {
    expect(stepValue(0.35, 0.05, 0, 1)).toBe(0.4)
    expect(stepValue(0.3, 0.05, 0, 1)).toBe(0.35)
  })

  it('recovers from a non-finite current value', () => {
    expect(stepValue(Number.NaN, 1, 5, 9)).toBe(6)
  })
})

describe('stepChoice', () => {
  const choices = [2560, 2048, 1536, 1024, 768, 512, 256]

  it('moves to the next larger allowed value', () => {
    expect(stepChoice(choices, 1024, 1)).toBe(1536)
  })

  it('moves to the next smaller allowed value', () => {
    expect(stepChoice(choices, 1024, -1)).toBe(768)
  })

  it('clamps at both ends instead of leaving the allowed set', () => {
    expect(stepChoice(choices, 2560, 1)).toBe(2560)
    expect(stepChoice(choices, 256, -1)).toBe(256)
  })

  it('snaps an unknown value into the set', () => {
    expect(stepChoice(choices, 1000, 1)).toBe(1024)
    expect(stepChoice(choices, 1000, -1)).toBe(768)
  })

  it('tolerates an empty choice list', () => {
    expect(stepChoice([], 1024, 1)).toBe(1024)
  })
})

describe('NumberStepper', () => {
  it('shows an up and a down control by default', () => {
    const html = render()
    expect(html).toContain('aria-label="Increase Embedding request limit"')
    expect(html).toContain('aria-label="Decrease Embedding request limit"')
  })

  it('keeps a real number input for typing and arrow keys', () => {
    const html = render()
    expect(html).toContain('type="number"')
    expect(html).toContain('aria-label="Embedding request limit"')
    expect(html).toContain('step="1"')
  })

  it('disables the control that would leave the range', () => {
    const atMax = render({ value: 100, max: 100 })
    const atMin = render({ value: 0, min: 0 })
    expect(atMax).toMatch(/aria-label="Increase Embedding request limit"[^>]*disabled/)
    expect(atMin).toMatch(/aria-label="Decrease Embedding request limit"[^>]*disabled/)
  })

  it('disables both controls when the field is disabled', () => {
    const html = render({ disabled: true })
    expect(html).toMatch(/aria-label="Increase Embedding request limit"[^>]*disabled/)
    expect(html).toMatch(/aria-label="Decrease Embedding request limit"[^>]*disabled/)
  })

  it('exposes the hint through aria-describedby', () => {
    const html = render({ hint: 'Tightening only, never above the saved ceiling' })
    expect(html).toContain('Tightening only')
    expect(html).toContain('aria-describedby=')
  })
})