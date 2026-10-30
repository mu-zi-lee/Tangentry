import { useEffect, useRef, useState } from 'react'
import type { RefCallback } from 'react'
import type { ContentItem } from '../api/types'
import { request } from '../api/client'
import { formatDuration } from './ContentCard'
import { announcePlayback, mediaStartEvent } from '../media/playback'
import { podcastAudioSource } from '../media/audioSource'

interface CardPlayback {
  owner: string
  playing: boolean
  toggle: () => void
  setPlaying: (playing: boolean) => void
}

/** Owns the asynchronous and native-audio lifecycle for a gallery card. */
export function useCardAudio(item: ContentItem, playback: CardPlayback) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const lastAudio = useRef<HTMLAudioElement | null>(null)
  const [audioDetail, setAudioDetail] = useState<{ id: string; url: string } | null>(null)
  const audioURL = podcastAudioSource(item.platform, item.mediaUrl || (audioDetail?.id === item.id ? audioDetail.url : undefined))
  const audioSource = useRef({ id: item.id, url: audioURL, kind: item.kind })
  const audioRequest = useRef<AbortController | null>(null)
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioError, setAudioError] = useState('')
  const [audioPosition, setAudioPosition] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const audioTotal = audioDuration || item.durationSeconds || 0
  const audioTime = (seconds: number) => formatDuration(seconds) || '0:00'

  useEffect(() => {
    setAudioDetail(null)
    setAudioLoading(false)
    const cancel = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== playback.owner) {
        audioRequest.current?.abort()
        audioRequest.current = null
        setAudioLoading(false)
      }
    }
    window.addEventListener(mediaStartEvent, cancel)
    return () => {
      audioRequest.current?.abort()
      audioRequest.current = null
      window.removeEventListener(mediaStartEvent, cancel)
    }
  }, [item.id, playback.owner])

  const toggleAudio = async () => {
    if (audioLoading) return
    setAudioError('')
    if (audioURL) {
      if (audio.current?.error) audio.current.load()
      playback.toggle()
      return
    }
    if (item.platform !== 'xiaoyuzhou') return
    announcePlayback(playback.owner)
    const controller = new AbortController()
    audioRequest.current = controller
    setAudioLoading(true)
    try {
      const feed = await request<{ items: ContentItem[] }>('/discovery/xiaoyuzhou?q=' +
        encodeURIComponent('https://www.xiaoyuzhoufm.com/episode/' + item.platformId), { signal: controller.signal })
      if (controller.signal.aborted || audioRequest.current !== controller) return
      const detail = feed.items.find(value => value.id === item.id)
      if (!detail?.mediaUrl) throw new Error('这个单集暂未提供可播放音频，可打开原内容收听。')
      setAudioDetail({ id: item.id, url: detail.mediaUrl })
      playback.setPlaying(true)
    } catch (cause) {
      if (!controller.signal.aborted) setAudioError(cause instanceof Error ? cause.message : '音频地址暂时无法获取，请重试。')
    } finally {
      if (audioRequest.current === controller) {
        audioRequest.current = null
        setAudioLoading(false)
      }
    }
  }

  useEffect(() => {
    const node = audio.current
    const previous = audioSource.current
    audioSource.current = { id: item.id, url: audioURL, kind: item.kind }
    if (previous.id !== item.id || previous.kind !== item.kind ||
      previous.url !== audioURL && Boolean(previous.url)) {
      node?.pause()
      node?.load()
      playback.setPlaying(false)
      setAudioPosition(0)
      setAudioDuration(0)
      setAudioError('')
      return
    }
    if (!node || item.kind !== 'audio') return
    let active = true
    if (playback.playing) {
      void node.play().catch(() => {
        if (active) {
          setAudioError(current => current || '暂时无法播放')
          playback.setPlaying(false)
        }
      })
    } else {
      node.pause()
    }
    return () => { active = false }
  }, [playback.playing, item.id, audioURL, item.kind])

  useEffect(() => {
    return () => {
      const node = lastAudio.current
      node?.pause()
      if (node && !node.isConnected) {
        node.removeAttribute('src')
        node.load()
      }
    }
  }, [])

  const audioRef: RefCallback<HTMLAudioElement> = node => {
    audio.current = node
    if (node) lastAudio.current = node
  }

  return {
    audio,
    audioRef,
    audioURL,
    audioLoading,
    audioError,
    audioPosition,
    audioDuration,
    audioTotal,
    audioTime,
    toggleAudio,
    setAudioPosition,
    setAudioDuration,
    setAudioError,
    setPlaying: playback.setPlaying,
  }
}
