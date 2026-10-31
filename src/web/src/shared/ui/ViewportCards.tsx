import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { borderBoxDimensions } from './CardCollection'

type Slot = {
  node: HTMLDivElement
  render: (mounted: boolean) => void
  mounted: boolean
  near?: boolean
  width: number
  height: number
}

// Keep the masonry box in the grid, but release distant card subtrees, images
// and their subscriptions. One observer pair serves the whole collection.
class CardViewport {
  private slots = new Map<HTMLDivElement, Slot>()
  private intersection?: IntersectionObserver
  private resize?: ResizeObserver

  start() {
    this.intersection = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const slot = this.slots.get(entry.target as HTMLDivElement)
        if (!slot) continue
        slot.near = entry.isIntersecting
        if (slot.near) this.wake(slot.node)
        else this.park(slot)
      }
    }, { rootMargin: '1200px 0px' })
    this.resize = new ResizeObserver(entries => {
      for (const entry of entries) {
        const slot = this.slots.get(entry.target as HTMLDivElement)
        if (!slot) continue
        const box = borderBoxDimensions(entry, () => slot.node.getBoundingClientRect())
        if (!slot.mounted) {
          // A column-width change invalidates the cached height. Measure the
          // real content again before putting it back to sleep.
          if (Math.abs(box.width - slot.width) > .5) this.wake(slot.node)
          continue
        }
        slot.width = box.width
        slot.height = box.height
        this.park(slot)
      }
    })
    for (const slot of this.slots.values()) {
      slot.near = undefined
      this.intersection.observe(slot.node)
      this.resize.observe(slot.node)
    }
  }

  stop() {
    this.intersection?.disconnect()
    this.resize?.disconnect()
    this.intersection = undefined
    this.resize = undefined
  }

  register(node: HTMLDivElement, render: Slot['render'], mounted: boolean) {
    const slot: Slot = { node, render, mounted, width: node.getBoundingClientRect().width, height: parseFloat(node.style.height) || 0 }
    this.slots.set(node, slot)
    this.intersection?.observe(node)
    this.resize?.observe(node)
    return () => {
      this.intersection?.unobserve(node)
      this.resize?.unobserve(node)
      this.slots.delete(node)
    }
  }

  wake(node: HTMLDivElement) {
    const slot = this.slots.get(node)
    if (!slot || slot.mounted) return
    slot.mounted = true
    slot.render(true)
  }

  rendered(node: HTMLDivElement) {
    node.style.removeProperty('height')
  }

  revealAll() {
    for (const slot of this.slots.values()) this.wake(slot.node)
  }

  private park(slot: Slot) {
    if (!slot.mounted || slot.near !== false || slot.height <= 0) return
    if (slot.node.contains(document.activeElement) || slot.node.querySelector(':popover-open')) return
    if (Array.from(slot.node.querySelectorAll<HTMLMediaElement>('audio, video')).some(media => !media.paused && !media.ended)) return
    slot.node.style.height = `${slot.height}px`
    slot.mounted = false
    slot.render(false)
  }
}

const Viewport = createContext<CardViewport | null>(null)

export function ViewportCards({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const viewport = useMemo(() => new CardViewport(), [])
  useLayoutEffect(() => {
    if (enabled) viewport.start()
    else viewport.revealAll()
    return () => viewport.stop()
  }, [enabled, viewport])
  return <Viewport value={viewport}>{children}</Viewport>
}

export function ViewportCard({ label, children }: { label: string; children: ReactNode }) {
  const viewport = useContext(Viewport)
  const node = useRef<HTMLDivElement | null>(null)
  const unregister = useRef<(() => void) | undefined>(undefined)
  const focusAfterMount = useRef(false)
  const [mounted, setMounted] = useState(true)
  const mountedRef = useRef(mounted)
  mountedRef.current = mounted
  const attach = useCallback((element: HTMLDivElement | null) => {
    unregister.current?.()
    node.current = element
    unregister.current = element ? viewport?.register(element, setMounted, mountedRef.current) : undefined
  }, [viewport])
  useLayoutEffect(() => {
    if (!mounted || !node.current) return
    viewport?.rendered(node.current)
    if (focusAfterMount.current) {
      focusAfterMount.current = false
      node.current.querySelector<HTMLElement>('[data-testid="content-card"]')?.focus({ preventScroll: true })
    }
  }, [mounted, viewport])
  return <div ref={attach} className="discovery-card-slot" data-card-label={label} data-card-mounted={mounted}
    role={mounted ? undefined : 'article'} aria-label={mounted ? undefined : label} tabIndex={mounted ? undefined : 0}
    onFocus={() => {
      if (!mounted && node.current) { focusAfterMount.current = true; viewport?.wake(node.current) }
    }}>
    {mounted ? children : null}
  </div>
}
