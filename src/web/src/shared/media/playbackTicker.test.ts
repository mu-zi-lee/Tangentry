import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPlaybackTicker } from './playbackTicker'

let visibility: EventTarget & { hidden: boolean }
beforeEach(() => {
  vi.useFakeTimers()
  visibility = Object.assign(new EventTarget(), { hidden: false })
  vi.stubGlobal('document', visibility)
  vi.stubGlobal('window', globalThis)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('has no idle timer and stops all sampling immediately on pause', () => {
  const sample = vi.fn()
  const ticker = createPlaybackTicker(sample)
  expect(vi.getTimerCount()).toBe(0)
  ticker.setRunning(true)
  ticker.setRunning(true)
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(350)
  expect(sample).toHaveBeenCalledTimes(3)
  ticker.setRunning(false)
  expect(vi.getTimerCount()).toBe(0)
  vi.advanceTimersByTime(60_000)
  expect(sample).toHaveBeenCalledTimes(3)
  ticker.stop()
})

it('removes the timer while hidden and resamples the real clock on reveal', () => {
  const sample = vi.fn()
  const ticker = createPlaybackTicker(sample)
  ticker.setRunning(true)
  visibility.hidden = true
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(0)
  vi.advanceTimersByTime(60_000)
  expect(sample).not.toHaveBeenCalled()
  visibility.hidden = false
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(sample).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(1)
  ticker.stop()
})

it('does not wake a paused or disposed clock when visibility changes', () => {
  const sample = vi.fn()
  const ticker = createPlaybackTicker(sample)
  ticker.setRunning(true)
  visibility.hidden = true
  visibility.dispatchEvent(new Event('visibilitychange'))
  ticker.setRunning(false)
  visibility.hidden = false
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(sample).not.toHaveBeenCalled()
  ticker.stop()
  ticker.setRunning(true)
  visibility.dispatchEvent(new Event('visibilitychange'))
  expect(vi.getTimerCount()).toBe(0)
  expect(sample).not.toHaveBeenCalled()
})

it('does not reschedule when sampling reaches an ended or failed state', () => {
  const ticker = createPlaybackTicker(() => ticker.setRunning(false))
  ticker.setRunning(true)
  vi.advanceTimersByTime(100)
  expect(vi.getTimerCount()).toBe(0)
  ticker.stop()
  ticker.stop()
})
