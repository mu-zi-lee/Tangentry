import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { createPlaybackTicker } from '../../shared/media/playbackTicker'

// Read the media clock, never extrapolate it: buffering and seeks must remain
// truthful. Poll only while visible playback is advancing.
export function useNativePlaybackClock(media: RefObject<HTMLMediaElement | null>, identity: unknown, report?: (seconds: number | null) => void) {
  const callback = useRef(report)
  useLayoutEffect(() => { callback.current = report }, [report])
  useEffect(() => {
    const node = media.current
    if (!node) return
    const sample = () => {
      if (!node.seeking && node.readyState >= 1 && !node.error && (!(node instanceof HTMLVideoElement) || node.videoWidth > 0) && Number.isFinite(node.currentTime)) callback.current?.(node.currentTime)
    }
    const ticker = createPlaybackTicker(sample)
    const checkpoint = () => { sample(); ticker.setRunning(!node.paused && !node.ended && !node.error && !node.seeking) }
    const waiting = () => { ticker.setRunning(false); sample() }
    const seeking = () => { ticker.setRunning(false); callback.current?.(null) }
    const error = () => { ticker.setRunning(false); callback.current?.(null) }
    node.addEventListener('playing', checkpoint)
    node.addEventListener('waiting', waiting)
    node.addEventListener('error', error)
    node.addEventListener('pause', checkpoint)
    node.addEventListener('ended', checkpoint)
    node.addEventListener('seeked', checkpoint)
    node.addEventListener('seeking', seeking)
    checkpoint()
    return () => {
      ticker.stop()
      node.removeEventListener('playing', checkpoint)
      node.removeEventListener('waiting', waiting)
      node.removeEventListener('error', error)
      node.removeEventListener('pause', checkpoint)
      node.removeEventListener('ended', checkpoint)
      node.removeEventListener('seeked', checkpoint)
      node.removeEventListener('seeking', seeking)
    }
  }, [media, identity])
}
