import { useCallback, useEffect, useRef, useState } from 'react'
import { APIError, request } from '../../shared/api/client'
import type { SubtitleTrack } from '../../shared/api/types'

type AutomaticSession = {
  id: string
  contentId: string
  language: string
  capability: string
  state: string
  durationSeconds: number
  furthestPosition: number
  jobId?: string
  errorMessage?: string
}

function automaticTrack(value: SubtitleTrack | undefined) {
  if (!value?.cues?.length) return null
  return { ...value, automatic: true, source: 'automatic' as const, label: value.label || '自动字幕' }
}

export function useAutomaticSubtitles({ contentId, enabled = true, hasFormalTrack, playing, ended = false, position, duration, audioStream, onFinalized }: {
  contentId: string
  enabled?: boolean
  hasFormalTrack: boolean
  playing: boolean
  ended?: boolean
  position: number | null
  duration?: number
  audioStream?: MediaStream | null
  onFinalized?: () => void
}) {
  const [session, setSession] = useState<AutomaticSession | null>(null)
  const [draft, setDraft] = useState<SubtitleTrack | null>(null)
  const [preference, setPreference] = useState(true)
  const [language, setLanguage] = useState('zh')
  const [error, setError] = useState('')
  const starting = useRef(false)
  const finalized = useRef(false)
  const sessionRef = useRef<AutomaticSession | null>(null)
  const positionRef = useRef<number | null>(position)
  const durationRef = useRef(duration)
  const playingRef = useRef(playing)
  const audioStreamRef = useRef<MediaStream | null>(audioStream ?? null)
  const audioStopRef = useRef<((final?: boolean, discard?: boolean) => Promise<void>) | null>(null)
  const audioFlushRef = useRef<Promise<void>>(Promise.resolve())
  const captureGenerationRef = useRef(0)
  const lastPlaybackPositionRef = useRef<number | null>(null)
  const seekPendingRef = useRef(false)
  useEffect(() => { audioStreamRef.current = audioStream ?? null }, [audioStream])

  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => {
    const previous = lastPlaybackPositionRef.current
    if (previous !== null && position !== null && Math.abs(position - previous) > 1.5) seekPendingRef.current = true
    if (position !== null) lastPlaybackPositionRef.current = position
    positionRef.current = position; durationRef.current = duration; playingRef.current = playing
  }, [duration, playing, position])
  useEffect(() => {
    finalized.current = false
    setSession(null)
    setDraft(null)
    setError('')
    captureGenerationRef.current += 1
    lastPlaybackPositionRef.current = null
    seekPendingRef.current = false
    const flush = audioStopRef.current?.(true)
    audioStopRef.current = null
    audioFlushRef.current = Promise.resolve(flush).catch(() => undefined)
  }, [contentId])

  useEffect(() => {
    const controller = new AbortController()
    void request<{ value?: string }>('/preferences/automatic_subtitles', { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted && value.value) setPreference(value.value !== 'false')
    }).catch(() => {})
    return () => controller.abort()
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void request<{ config?: { language?: string } }>('/transcription/settings', { signal: controller.signal }).then(value => {
      const configured = value.config?.language?.trim()
      if (!controller.signal.aborted && configured) setLanguage(configured)
    }).catch(() => {})
    return () => controller.abort()
  }, [])

  const refresh = useCallback(async (id: string, signal?: AbortSignal) => {
    const value = await request<AutomaticSession>(`/transcription/automatic/${encodeURIComponent(id)}`, { signal })
    if (signal?.aborted) return value
    setSession(value)
    if (value.state !== 'failed' && value.state !== 'canceled') {
      const result = await request<{ track?: SubtitleTrack }>(`/transcription/automatic/${encodeURIComponent(id)}/draft`, { signal })
      const track = automaticTrack(result.track)
      if (track) setDraft(track)
      // Playback can finalize the session on the server before the next
      // browser poll (for example when the ended event races the final
      // upload). Treat an observed completed state like a local finalize so
      // the freshly saved subtitle is loaded without requiring a page reload.
      if (value.state === 'completed' && !finalized.current) {
        finalized.current = true
        onFinalized?.()
      }
      if (value.state === 'finalizing' && track && !finalized.current) {
        finalized.current = true
        try {
          await request(`/transcription/automatic/${encodeURIComponent(id)}/finalize`, { method: 'POST', signal })
          onFinalized?.()
        } catch (cause) {
          finalized.current = false
          throw cause
        }
      }
    }
    return value
  }, [onFinalized])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void request<{ session: AutomaticSession | null }>(`/transcription/automatic?contentId=${encodeURIComponent(contentId)}`, { signal: controller.signal }).then(async value => {
      if (active && value.session) { setSession(value.session); await refresh(value.session.id, controller.signal) }
    }).catch(() => {})
    return () => { active = false; controller.abort() }
  }, [contentId, refresh])

  useEffect(() => {
    if (!preference || !enabled || hasFormalTrack || !playing || starting.current || (session && session.state !== 'paused')) return
    starting.current = true
    setError('')
    const capability = audioStreamRef.current ? 'streamable' : 'batch-only'
    void request<AutomaticSession>('/transcription/automatic', {
      method: 'POST',
      body: JSON.stringify({ contentId, language, capability, startSeconds: position ?? 0, durationSeconds: duration ?? 0 }),
    }).then(value => {
      setSession(value)
      if (value.capability !== 'streamable' || !audioStreamRef.current) return
      const generation = captureGenerationRef.current
      void audioFlushRef.current.then(() => {
        if (generation !== captureGenerationRef.current || !playingRef.current || !audioStreamRef.current) return
        startAudioCapture(value.id, audioStreamRef.current, position ?? 0, audioStopRef)
      })
    }).catch(cause => setError(cause instanceof Error ? cause.message : '自动字幕暂时无法启动。')).finally(() => { starting.current = false })
  }, [audioStream, contentId, duration, enabled, hasFormalTrack, language, playing, position, preference, session])

  useEffect(() => {
    if (playing) return
    const current = sessionRef.current
    if (!current || current.capability !== 'streamable') return
    // Native players often report their final `timeupdate` a fraction before
    // the declared duration. Keep the explicit ended signal authoritative,
    // while allowing that small clock gap to complete the session as well.
    const playbackEnded = ended || durationRef.current !== undefined && durationRef.current > 0 && (positionRef.current ?? 0) >= Math.max(0, durationRef.current - 1.5)
    captureGenerationRef.current += 1
    const seeked = seekPendingRef.current
    const flush = audioStopRef.current?.(playbackEnded, seeked)
    audioStopRef.current = null
    audioFlushRef.current = Promise.resolve(flush).catch(() => undefined)
    const playbackPosition = positionRef.current
    if (playbackPosition === null) return
    void audioFlushRef.current.then(() => request(`/transcription/automatic/${encodeURIComponent(current.id)}/playback`, {
      method: 'PATCH',
      body: JSON.stringify({ positionSeconds: playbackPosition, durationSeconds: durationRef.current ?? 0, playing: false, ended: playbackEnded, seeked }),
    })).then(value => {
      if (seeked) seekPendingRef.current = false
      setSession(value as AutomaticSession)
    }).catch(() => {})
  }, [ended, playing, contentId])

  useEffect(() => () => {
    const current = sessionRef.current
    const currentPosition = positionRef.current
    captureGenerationRef.current += 1
    const flush = audioStopRef.current?.(true)
    audioStopRef.current = null
    audioFlushRef.current = Promise.resolve(flush).catch(() => undefined)
    if (!current || currentPosition === null || ['completed', 'failed', 'canceled'].includes(current.state)) return
    void audioFlushRef.current.then(() => request(`/transcription/automatic/${encodeURIComponent(current.id)}/playback`, {
      method: 'PATCH',
      body: JSON.stringify({ positionSeconds: currentPosition, durationSeconds: durationRef.current ?? 0, playing: false }),
      keepalive: true,
    })).catch(() => {})
  }, [contentId])

  useEffect(() => {
    if (!session || session.state === 'completed' || session.state === 'failed' || session.state === 'canceled') return
    const timer = window.setInterval(() => {
      void refresh(session.id).catch(cause => setError(cause instanceof Error ? cause.message : '自动字幕状态暂时无法读取。'))
    }, 1800)
    return () => window.clearInterval(timer)
  }, [refresh, session])

  useEffect(() => {
    if (!session || !playing || position === null) return
    const timer = window.setTimeout(() => {
      const seeked = seekPendingRef.current
      let flush = Promise.resolve()
      if (seeked && session.capability === 'streamable') {
        captureGenerationRef.current += 1
        const stopped = audioStopRef.current?.(false, true)
        audioStopRef.current = null
        flush = Promise.resolve(stopped).catch(() => undefined)
        audioFlushRef.current = flush
      }
      const playbackEnded = ended || !playing && duration !== undefined && duration > 0 && position >= Math.max(0, duration - 0.5)
      void flush.then(() => request(`/transcription/automatic/${encodeURIComponent(session.id)}/playback`, {
        method: 'PATCH',
        body: JSON.stringify({ positionSeconds: position, durationSeconds: duration ?? 0, playing, ended: playbackEnded, seeked }),
      })).then(value => {
        if (seeked) {
          seekPendingRef.current = false
          setSession(value as AutomaticSession)
        }
      }).catch(() => {})
    }, 350)
    return () => window.clearTimeout(timer)
  }, [duration, ended, playing, position, session])

  useEffect(() => {
    if (!session || session.capability === 'streamable' || playing || position === null || ['completed', 'failed', 'canceled'].includes(session.state)) return
    void request(`/transcription/automatic/${encodeURIComponent(session.id)}/playback`, {
      method: 'PATCH',
        body: JSON.stringify({ positionSeconds: position, durationSeconds: duration ?? 0, playing: false, ended: ended || duration !== undefined && duration > 0 && position >= Math.max(0, duration - 1.5) }),
    }).then(value => setSession(value as AutomaticSession)).catch(() => {})
  }, [duration, ended, playing, position, session?.id])

  const reset = useCallback(async () => {
    const current = sessionRef.current
    captureGenerationRef.current += 1
    const flush = audioStopRef.current?.(true)
    audioStopRef.current = null
    audioFlushRef.current = Promise.resolve(flush).catch(() => undefined)
    if (current) {
      await audioFlushRef.current
      await request(`/transcription/automatic/${encodeURIComponent(current.id)}/cancel`, { method: 'POST' })
    }
    finalized.current = false
    setSession(null)
    setDraft(null)
    setError('')
    lastPlaybackPositionRef.current = null
    seekPendingRef.current = false
  }, [])

  return { session, track: draft, error, reset }
}

function startAudioCapture(id: string, stream: MediaStream, offset: number, stopRef: { current: ((final?: boolean, discard?: boolean) => Promise<void>) | null }) {
  stopRef.current?.()
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(16384, 1, 1)
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(processor)
  processor.connect(mute)
  mute.connect(context.destination)
  let cursor = offset
  let stopped = false
  const abortController = new AbortController()
  let pending = new Float32Array(0)
  let sendChain: Promise<void> = Promise.resolve()
  const send = (samples: Float32Array, final = false) => {
    if (!samples.length) return
    const outputLength = Math.max(1, Math.floor(samples.length * 16000 / context.sampleRate))
    const pcm = new ArrayBuffer(outputLength * 2)
    const view = new DataView(pcm)
    for (let index = 0; index < outputLength; index++) {
      const sourceIndex = Math.min(samples.length - 1, Math.floor(index * context.sampleRate / 16000))
      const value = Math.max(-1, Math.min(1, samples[sourceIndex]))
      view.setInt16(index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
    }
    const startSeconds = cursor
    cursor += outputLength / 16000
    sendChain = sendChain.then(async () => {
      const path = `/transcription/automatic/${encodeURIComponent(id)}/audio`
      const metadata = JSON.stringify({ startSeconds, sampleRate: 16000, channels: 1, final })
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          await request(path, {
            method: 'POST',
            body: pcm,
            headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Metadata': metadata },
            keepalive: final,
            signal: abortController.signal,
          })
          return
        } catch (cause) {
          const retryable = cause instanceof APIError && (cause.status === 0 || cause.status === 409 || cause.status === 429 || cause.code === 'automatic_subtitle_busy')
          if (!retryable || attempt === 7) throw cause
          await new Promise(resolve => window.setTimeout(resolve, Math.min(1500, 150 * 2 ** attempt)))
        }
      }
    }).catch(() => undefined)
  }
  processor.onaudioprocess = event => {
    if (stopped) return
    const incoming = event.inputBuffer.getChannelData(0)
    const combined = new Float32Array(pending.length + incoming.length)
    combined.set(pending)
    combined.set(incoming, pending.length)
    pending = combined
    // Two-second frames keep the model context bounded while making the
    // on-screen draft feel continuous instead of waiting for long batches.
    if (pending.length >= context.sampleRate * 2) {
      send(pending)
      pending = new Float32Array(0)
    }
  }
  void context.resume().catch(() => {})
  stopRef.current = (final = false, discard = false) => {
    if (stopped) return sendChain
    stopped = true
    processor.onaudioprocess = null
    if (!discard && pending.length) {
      send(pending, final)
      pending = new Float32Array(0)
    }
    if (discard) abortController.abort()
    source.disconnect(); processor.disconnect(); mute.disconnect()
    return sendChain.finally(() => { void context.close().catch(() => {}) }).then(() => undefined)
  }
}
