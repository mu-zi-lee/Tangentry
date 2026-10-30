import { expect, test } from 'vitest'
import { borderBoxDimensions, cardSizeChanged, masonryNeedsMeasurement, masonrySpan } from './CardCollection'

test('reuses a card measurement when its box is unchanged', () => {
  expect(cardSizeChanged(undefined, 240, 320)).toBe(true)
  expect(cardSizeChanged({ width: 240, height: 320 }, 240, 320)).toBe(false)
  expect(cardSizeChanged({ width: 240, height: 320 }, 241, 320)).toBe(true)
  expect(cardSizeChanged({ width: 240, height: 320 }, 240, 321)).toBe(true)
})

test('only measures cards missing geometry or when spacing changes', () => {
  expect(masonryNeedsMeasurement(120, 0, false)).toBe(true)
  expect(masonryNeedsMeasurement(120, 120, false)).toBe(false)
  expect(masonryNeedsMeasurement(120, 119, false)).toBe(true)
  expect(masonryNeedsMeasurement(120, 120, true)).toBe(true)
})

test('uses border-box measurements consistently for padded cards', () => {
  const border = { borderBoxSize: [{ inlineSize: 260, blockSize: 354 }] }
  const fallback = () => ({ width: 260, height: 354 })
  expect(borderBoxDimensions(border, fallback)).toEqual({ width: 260, height: 354 })
  expect(borderBoxDimensions({}, fallback)).toEqual({ width: 260, height: 354 })
  expect(masonrySpan(borderBoxDimensions(border, fallback).height, 20)).toBe(masonrySpan(fallback().height, 20))
})
