import { Button } from '../../../components/ui'
import { LoaderCircle, Pause, Play } from 'lucide-react'
import type { GalleryCardContentProps } from './types'
import { GalleryCardFrame } from './GalleryCardFrame'
import { GalleryCardTitle } from './GalleryCardText'
import { AudioCardActions } from './GalleryCardActions'
import { useGalleryPlayback } from './playback'
import { PodcastArtwork } from '../PodcastArtwork'
import { useCardAudio } from '../useCardAudio'
import { announcePlayback } from '../../media/playback'
import { AuthorLink } from '../CardAuthor'

export function AudioGalleryCard({ item, origin, discoveryReason, discoveryType, saved, pending, onRead, onSave, onCreator, onDownload, status, excerpt, discovery = false, onFeedback }: GalleryCardContentProps) {
  const playback = useGalleryPlayback()
  const { audio, audioRef, audioURL, audioLoading, audioError, audioPosition, audioDuration, audioTotal, audioTime, toggleAudio,
    setAudioPosition, setAudioDuration, setAudioError, setPlaying } = useCardAudio(item, playback)

  return (
    <GalleryCardFrame item={item} origin={origin} discoveryReason={discoveryReason} className="card-audio" onRead={onRead} onFeedback={discovery ? onFeedback : undefined}>
      <PodcastArtwork key={item.id + item.thumbnailUrl} item={item} resolveMissing={!discovery} />
      <div className="card-audio-info">
        <GalleryCardTitle item={item} onRead={onRead} />
        {excerpt}
      </div>
      <div className="card-audio-meta">
        <AuthorLink item={item} onCreator={onCreator} showAvatar={false} discoveryType={discovery ? discoveryType : undefined} discoveryReason={discoveryReason} />
        <AudioCardActions item={item} saved={saved} pending={pending} onSave={onSave} onDownload={onDownload} />
      </div>
      <div className="card-audio-controls">
        <Button variant="quiet"
          className="card-audio-play-btn"
          disabled={audioLoading || (!audioURL && item.platform !== 'xiaoyuzhou')}
          aria-busy={audioLoading}
          onClick={() => void toggleAudio()}
          title={audioError ? '重新加载并播放音频' : playback.playing ? '暂停音频' : '播放音频'}
          aria-label={`${playback.playing ? '暂停音频' : '播放音频'} ${item.title}`}
        >
          {audioLoading ? <LoaderCircle size={18} /> : playback.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </Button>
        <div className="card-audio-timeline">
          <input type="range" aria-label={'音频播放进度 ' + item.title}
            aria-valuetext={`${audioTime(audioPosition)} / ${audioTotal ? audioTime(audioTotal) : '--:--'}`}
            min={0} max={audioTotal || 1} step={0.1} value={Math.min(audioPosition, audioTotal || 1)} disabled={!audioDuration || Boolean(audioError)}
            onChange={event => {
              const seconds = Number(event.target.value)
              if (audio.current && audioDuration) { audio.current.currentTime = seconds; setAudioPosition(seconds) }
            }} />
          <span className="card-audio-time"><span>{audioTime(audioPosition)}</span><span>{audioTotal ? audioTime(audioTotal) : '--:--'}</span></span>
        </div>
      </div>
      {audioURL && (
        <audio
          ref={audioRef}
          src={audioURL}
          preload="none"
          aria-label={'卡片音频播放器 ' + item.title}
          onLoadedMetadata={() => {
            const duration = audio.current?.duration
            setAudioDuration(duration && Number.isFinite(duration) && duration > 0 ? duration : 0)
          }}
          onDurationChange={() => {
            const duration = audio.current?.duration
            setAudioDuration(duration && Number.isFinite(duration) && duration > 0 ? duration : 0)
          }}
          onTimeUpdate={() => setAudioPosition(audio.current?.currentTime ?? 0)}
          onSeeking={() => setAudioPosition(audio.current?.currentTime ?? 0)}
          onEnded={() => setPlaying(false)}
          onPause={() => setPlaying(false)}
          onPlay={() => {
            announcePlayback(playback.owner)
            setPlaying(true)
          }}
          onError={() => {
            setAudioError('音频不可播放')
            audio.current?.pause()
            setAudioDuration(0)
            setPlaying(false)
          }}
        />
      )}
      {audioError && <p className="audio-error" role="status">{audioError}</p>}
      {status && <div className="audio-card-status">{status}</div>}
    </GalleryCardFrame>
  )
}
