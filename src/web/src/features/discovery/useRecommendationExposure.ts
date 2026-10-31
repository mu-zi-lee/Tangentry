import { useEffect, useRef, type RefObject } from 'react'
import { request } from '../../shared/api/client'

export function useRecommendationExposure(active: boolean, sentinel: RefObject<HTMLElement | null>) {
  const marked = useRef(new Set<string>())
  useEffect(() => {
    if (!active) return
    const root = sentinel.current?.parentElement
    if (!root) return
    const timers = new Map<Element, number>()
    const visible = new Set<Element>()
    const observed = new Set<Element>()
    const cancel = (node: Element) => {
      const timer = timers.get(node)
      if (timer !== undefined) window.clearTimeout(timer)
      timers.delete(node)
    }
    const schedule = (node: Element) => {
      const id = node.querySelector<HTMLElement>('[data-content-id]')?.dataset.contentId
      const platform = id?.split(':')[0]
      if (!id || !platform || !['bilibili', 'youtube', 'xiaohongshu', 'linuxdo', 'xiaoyuzhou', 'douyin'].includes(platform) || document.hidden || marked.current.has(id) || timers.has(node)) return
      timers.set(node, window.setTimeout(() => {
        timers.delete(node)
        if (document.hidden || !visible.has(node)) return
        marked.current.add(id)
        void request(`/recommendations/${platform}/marks`, { method: 'PUT', keepalive: true, body: JSON.stringify({ contentId: id, opened: false }) })
          .catch(() => { marked.current.delete(id) })
      }, 1000))
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= .5) {
          visible.add(entry.target)
          schedule(entry.target)
        } else {
          visible.delete(entry.target)
          cancel(entry.target)
        }
      }
    }, { threshold: [.5] })
    const observeCard = (node: Element) => {
      if (!(node instanceof HTMLElement) || observed.has(node)) return
      observed.add(node)
      observer.observe(node)
    }
    const observeCards = (parent: ParentNode) => parent.querySelectorAll('[data-testid="content-card"]').forEach(observeCard)
    const removeCard = (node: Element) => {
      if (!observed.delete(node)) return
      observer.unobserve(node)
      visible.delete(node)
      cancel(node)
    }
    observeCards(root)
    const mutations = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue
          removeCard(node)
          node.querySelectorAll('[data-testid="content-card"]').forEach(removeCard)
        }
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          if (node.matches('[data-testid="content-card"]')) observeCard(node)
          observeCards(node)
        }
      }
    })
    mutations.observe(root, { childList: true, subtree: true })
    const visibility = () => {
      for (const node of visible) {
        cancel(node)
        if (!document.hidden) schedule(node)
      }
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      observer.disconnect()
      mutations.disconnect()
      for (const node of timers.keys()) cancel(node)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [active, sentinel])
}
