import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'

import type { PlaybackHandle } from './types'
import { loadYouTubeAPI, type YouTubePlayer } from './youtubeIframeAPI'
import { captureDisplayedElement } from './captureFrame'
import { createPlaybackTicker } from './playbackTicker'

// Load the official API only after the user starts playback. Its real clock is
// shared with notes and subtitles; failed/blocked API reads remain null.
export const YouTubeEmbedPlayer = forwardRef<PlaybackHandle, {
  id: string; title: string; start?: number; autoplay?: boolean; onPosition?: (seconds: number | null) => void; onReady?: (ready: boolean) => void
  onProgress?: (position: number, duration: number, immediate?: boolean) => void; onPlaying?: (playing: boolean) => void; onEnded?: () => void
}>(function YouTubeEmbedPlayer({ id, title, start = 0, autoplay = true, onPosition, onReady, onProgress, onPlaying, onEnded }, ref) {
  const container = useRef<HTMLDivElement>(null), player = useRef<YouTubePlayer | null>(null), ready = useRef(false)
  const [unavailable, setUnavailable] = useState(false)
  const [target, setTarget] = useState({ seconds: Math.max(0, Math.floor(start)), revision: 0 })
  const fallback = useRef(false)
  const engaged = useRef(false)
  const seekRequest = useRef<{ target: number; expires: number } | null>(null)
  const wakeClock = useRef<(() => void) | null>(null)
  const callbacks = useRef({ onPosition, onReady, onProgress, onPlaying, onEnded })
  useLayoutEffect(() => { callbacks.current = { onPosition, onReady, onProgress, onPlaying, onEnded } }, [onPosition, onReady, onProgress, onPlaying, onEnded])
  const getPosition = () => {
    if (!ready.current || !player.current) return null
    try {
      const value = player.current.getCurrentTime()
      if (!Number.isFinite(value) || value < 0) return null
      return value
    } catch { return null }
  }
  useImperativeHandle(ref, () => ({ getPosition, captureFrame: () => {
    const frame = container.current?.querySelector('iframe')
    // controls=0 keeps the captured rectangle free of YouTube's control bar;
    // subtitles and in-player overlays remain part of the rendered frame.
    return captureDisplayedElement(frame, getPosition(), 0)
  }, seek: seconds => {
    if (!Number.isFinite(seconds) || seconds < 0) return false
    if (fallback.current) {
      setTarget(value => ({ seconds: Math.floor(seconds), revision: value.revision + 1 }))
      return true
    }
    if (!ready.current || !player.current) return false
    try {
      const duration = player.current.getDuration()
      if (!Number.isFinite(duration) || duration <= 0 || seconds > duration) return false
      player.current.seekTo(seconds, true)
      engaged.current = true
      seekRequest.current = { target: seconds, expires: performance.now() + 10000 }
      onPosition?.(getPosition())
      wakeClock.current?.()
      return true
    } catch { return false }
  } }), [onPosition])
  useEffect(() => {
    const node = container.current
    if (!node || !/^[A-Za-z0-9_-]{11}$/.test(id)) return
    let active = true, readyTimeout: number | undefined
    let lastSample: { position: number; duration: number } | null = null
    const flush = () => { if (lastSample) callbacks.current.onProgress?.(lastSample.position, lastSample.duration, true) }
    const report = (immediate = false) => {
      const position = getPosition()
      callbacks.current.onPosition?.(position)
      if (!player.current) return
      let state: number | undefined
      try { state = player.current.getPlayerState?.() }
      catch { ticker.setRunning(false); return }
      if (seekRequest.current && performance.now() >= seekRequest.current.expires) { seekRequest.current = null; immediate = true }
      ticker.setRunning(state === 1 || Boolean(seekRequest.current))
      callbacks.current.onPlaying?.(state === 1)
      if (state === 1) engaged.current = true
      if (position === null) return
      try {
        const requested = seekRequest.current
        // Display the observed clock while seeking, but do not overwrite saved
        // progress until the target is acknowledged or the bounded wait expires.
        if (requested && Math.abs(position - requested.target) > 1 && performance.now() < requested.expires) return
        if (requested) { seekRequest.current = null; ticker.setRunning(state === 1); immediate = true }
        if (!engaged.current) return
        const duration = player.current.getDuration()
        if (!Number.isFinite(duration) || duration <= 0 || duration > 604800 || position > duration) return
        lastSample = { position, duration }
        callbacks.current.onProgress?.(position, duration, immediate)
      } catch { /* An unavailable duration must not invent a resumable position. */ }
    }
    const ticker = createPlaybackTicker(() => report())
    wakeClock.current = () => ticker.setRunning(true)
    const degrade = () => {
      if (!active) return
      flush()
      clearTimeout(readyTimeout)
      ready.current = false; fallback.current = true; ticker.setRunning(false)
      seekRequest.current = null
      callbacks.current.onPlaying?.(false)
      setUnavailable(true); callbacks.current.onReady?.(true); callbacks.current.onPosition?.(null)
    }
    const frame = document.createElement('iframe')
    frame.className = 'platform-video'
    frame.title = '在线视频播放器 ' + title
    frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=${autoplay ? 1 : 0}&playsinline=1&controls=0&rel=0&enablejsapi=1&start=${target.seconds}&origin=${encodeURIComponent(location.origin)}`
    frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media'
    frame.allowFullscreen = true
    frame.referrerPolicy = 'strict-origin-when-cross-origin'
    node.append(frame)
    fallback.current = false
    engaged.current = false
    seekRequest.current = null
    setUnavailable(false); callbacks.current.onReady?.(false); callbacks.current.onPosition?.(null)
    void loadYouTubeAPI().then(api => {
      if (!active) return
      readyTimeout = window.setTimeout(degrade, 12000)
      player.current = new api.Player(frame, { events: {
        onReady: () => {
          if (!active) return
          clearTimeout(readyTimeout)
          ready.current = true; fallback.current = false; setUnavailable(false); callbacks.current.onReady?.(true)
          if (target.revision === 0 && start > 0 && player.current) {
            try {
              const duration = player.current.getDuration()
              if (Number.isFinite(duration) && start <= duration) {
                player.current.seekTo(start, true)
                engaged.current = true
                seekRequest.current = { target: start, expires: performance.now() + 10000 }
              }
            } catch { /* Initial URL seeking remains available if the control API rejects the request. */ }
          }
          report()
        },
        onError: degrade,
        onStateChange: event => {
          if (!active || !ready.current || fallback.current) return
          if (event.data === 1) engaged.current = true
          if (event.data === 0) callbacks.current.onEnded?.()
          report(event.data === 0 || event.data === 2)
        },
      } })
    }).catch(degrade)
    return () => {
      active = false; ready.current = false; ticker.stop(); clearTimeout(readyTimeout)
      wakeClock.current = null
      flush()
      seekRequest.current = null
      try { player.current?.destroy() } catch { /* Remove failed players as well. */ }
      finally { player.current = null; frame.src = 'about:blank'; node.replaceChildren() }
      callbacks.current.onPlaying?.(false)
      callbacks.current.onReady?.(false); callbacks.current.onPosition?.(null)
    }
  }, [id, title, autoplay, target])
  return <div className="youtube-embed"><div ref={container}/>{unavailable && <p className="field-hint" role="status">YouTube 播放时间暂不可用，笔记不自动关联时间；仍可点击字幕跳转。<a href={`https://www.youtube.com/watch?v=${id}&t=${target.seconds}s`} target="_blank" rel="noreferrer">打开原视频</a></p>}</div>
})
