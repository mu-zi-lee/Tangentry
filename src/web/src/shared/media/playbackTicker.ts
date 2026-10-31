/** Keep clock sampling dormant while paused, hidden, buffering, or unmounted. */
export function createPlaybackTicker(sample: () => void, interval = 100) {
  let running = false
  let disposed = false
  let timer: number | undefined
  const clear = () => { window.clearTimeout(timer); timer = undefined }
  const schedule = () => {
    if (!disposed && running && !document.hidden && timer === undefined) timer = window.setTimeout(tick, interval)
  }
  const tick = () => {
    timer = undefined
    if (disposed || !running || document.hidden) return
    sample()
    schedule()
  }
  const visibility = () => {
    clear()
    if (!document.hidden && running && !disposed) { sample(); schedule() }
  }
  document.addEventListener('visibilitychange', visibility)
  return {
    setRunning(value: boolean) {
      running = value
      if (!value) clear()
      else schedule()
    },
    stop() {
      disposed = true
      running = false
      clear()
      document.removeEventListener('visibilitychange', visibility)
    },
  }
}
