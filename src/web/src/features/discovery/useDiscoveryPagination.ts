import { useEffect, useRef, type RefObject } from 'react'

/** One automatic page per approach or downward gesture, never per response. */
export function useDiscoveryPagination(target: RefObject<HTMLElement | null>, {
  active, session, hasMore, loading, error, nextBatch,
}: {
  active: boolean
  session?: string
  hasMore: boolean
  loading: boolean
  error: string
  nextBatch: () => void
}) {
  const latest = useRef({ loading, error, nextBatch })
  latest.current = { loading, error, nextBatch }

  useEffect(() => {
    const node = target.current
    if (!active || !session || !hasMore || !node) return
    let nearBottom = false
    let armed = true
    let touchY: number | undefined
    const requestNext = () => {
      if (!armed || !nearBottom || document.hidden || latest.current.loading || latest.current.error) return
      armed = false
      latest.current.nextBatch()
    }
    const observer = new IntersectionObserver(entries => {
      nearBottom = entries.some(entry => entry.isIntersecting)
      if (!nearBottom) armed = true
      else requestNext()
    }, { rootMargin: '360px 0px' })
    observer.observe(node)
    const approach = () => { armed = true; requestNext() }
    const wheel = (event: WheelEvent) => { if (event.deltaY > 0 && !event.ctrlKey) approach() }
    const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY }
    const touchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY
      if (y !== undefined && touchY !== undefined && y < touchY) approach()
      touchY = y
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) return
      if ((event.target as Element | null)?.closest('input, textarea, select, button, a, [contenteditable], [role="button"], [role="group"][tabindex]')) return
      approach()
    }
    window.addEventListener('wheel', wheel, { passive: true })
    window.addEventListener('touchstart', touchStart, { passive: true })
    window.addEventListener('touchmove', touchMove, { passive: true })
    window.addEventListener('keydown', keyDown)
    return () => {
      observer.disconnect()
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('touchstart', touchStart)
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('keydown', keyDown)
    }
  }, [active, session, hasMore, target])
}
