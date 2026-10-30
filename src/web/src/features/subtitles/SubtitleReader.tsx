import { Button, Checkbox, Input, Select, Tooltip } from '../../components/ui'
import type { SubtitleAssistance } from '../../shared/ui/subtitleAssistance'
import { ArrowDownToLine, Captions, ExternalLink, Info, LoaderCircle, Search, X, HardDrive, Save, ChevronLeft, ChevronRight, Languages, Mic, Trash2, Repeat2, StickyNote, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ContentItem, SubtitleAvailability, SubtitleCue, SubtitleLanguage, SubtitleTrack, SubtitleReference } from '../../shared/api/types'
import { selectedSubtitleAvailability, subtitleDocumentMessage, subtitlePartMessage } from './subtitleAvailability'
import { subtitlePriority, useSubtitles } from './useSubtitles'
import { preferredSubtitleLanguage, subtitleTrackMatchesTarget } from './subtitleLanguageMatch'
import { availableSubtitleLanguages, resolveNativeSubtitleTarget } from './nativeSubtitleTarget'
import { activeSubtitleCue } from './activeCue'
import { TranscriptionControls } from './TranscriptionControls'
import { transcriptParagraphs, transcriptSeparator, transcriptText } from './transcriptParagraphs'
import './subtitles.css'
import { useReaderPlayback } from '../../shared/reader/ReaderActions'
import { subtitleTrackHash } from '../../shared/media/subtitleSource'
import { readExcerptRadius, rememberExcerptRadius, subtitleExcerpt, type ExcerptRadius } from './subtitleExcerpt'
import { useSubtitleExport } from './useSubtitleExport'
import { highlightMatch, timestamp } from './subtitlePresentation'
import { useAutomaticSubtitles } from './useAutomaticSubtitles'
import { SubtitleExcerptAction } from './SubtitleExcerptAction'

const emptySubtitleLanguages: SubtitleLanguage[] = []

function platformSourceLabel(track: SubtitleTrack, platform?: 'bilibili' | 'youtube' | 'podcast' | 'local') {
  if (track.source === 'cc') return platform === 'bilibili' ? 'B 站 CC' : 'CC'
  if (track.source === 'ai') return platform === 'bilibili' ? 'B 站 AI' : 'AI'
  if (track.source === 'youtube' && track.translated) return 'YouTube 平台翻译'
  if (track.source === 'youtube') return 'YouTube'
  if (track.source === 'yt-dlp') return 'yt-dlp'
  if (platform === 'bilibili') return 'B 站'
  if (platform === 'youtube') return 'YouTube'
  return ''
}

function platformLanguageSourceLabel(language: SubtitleLanguage, platform: 'bilibili' | 'youtube' | 'podcast' | 'local') {
  if (language.source === 'cc') return platform === 'bilibili' ? 'B 站 CC' : platform === 'youtube' ? 'YouTube' : 'CC'
  if (language.source === 'ai') return platform === 'bilibili' ? 'B 站 AI' : platform === 'youtube' ? 'YouTube 自动' : 'AI'
  if (language.source === 'youtube' && language.translated) return 'YouTube 平台翻译'
  if (language.source === 'youtube') return 'YouTube'
  if (language.source === 'yt-dlp') return 'yt-dlp'
  if (platform === 'bilibili') return 'B 站'
  if (platform === 'youtube') return 'YouTube'
  return ''
}

function nativePlatformSourceDescription(track: SubtitleTrack, platform: 'bilibili' | 'youtube' | 'podcast' | 'local') {
  const language = track.label || track.language
  if (track.source === 'cc' && platform === 'bilibili') return `B 站 CC 提供的${language}字幕`
  if (track.source === 'ai' && platform === 'bilibili') return `B 站 AI 提供的${language}字幕`
  if (track.source === 'youtube' && track.translated) return `YouTube 平台翻译提供的${language}字幕`
  if (track.source === 'youtube' && track.automatic) return `YouTube 提供的${language}自动字幕`
  if (track.source === 'youtube') return `YouTube 提供的${language}字幕`
  return `${platformSourceLabel(track, platform)}提供的${language}字幕`
}

export function SubtitleReader({ item, source = 'bilibili', position = null, ended = false, onSeek, onTrackChange, onPlatformLanguagesChange, onAvailabilityChange, assistance, onNoteAt, audioStream }: {
  item: Pick<ContentItem, 'platformId' | 'url'> & Partial<Pick<ContentItem,'kind' | 'title' | 'author' | 'durationSeconds'>>; source?: 'bilibili' | 'youtube' | 'podcast' | 'local'; onNoteAt?: (position: number, reference?: SubtitleReference) => void
  assistance?: SubtitleAssistance
  position?: number | null; ended?: boolean; onSeek?: (position: number) => void; onTrackChange?: (track: SubtitleTrack | null) => void; onPlatformLanguagesChange?: (languages: SubtitleLanguage[]) => void; onAvailabilityChange?: (status: SubtitleAvailability | 'available' | 'login_required' | null) => void; audioStream?: MediaStream | null
}) {
  const subtitles = useSubtitles(item.platformId, source)
  const [writeNotice, setWriteNotice] = useState('')
  useEffect(() => {
    setWriteNotice(subtitles.writeError)
    if (!subtitles.writeError) return
    const timer = window.setTimeout(() => setWriteNotice(''), 6000)
    return () => window.clearTimeout(timer)
  }, [subtitles.writeError])
  const { playing } = useReaderPlayback()
  const [activeTool, setActiveTool] = useState<'source' | 'translation' | 'export' | 'transcription' | null>(null)
  const [sourceDetailsOpen, setSourceDetailsOpen] = useState(false)
  const settingsOpen = activeTool !== null
  const settingsId = useId()
  const [exportFormat, setExportFormat] = useState<'srt' | 'markdown'>('srt')
  const reader = useRef<HTMLElement>(null)
  const [language, setLanguage] = useState('')
  const [manualSelection, setManualSelection] = useState(false)
  const [sourceTrackOverride, setSourceTrackOverride] = useState<SubtitleTrack | null>(null)
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(200)
  const [follow, setFollow] = useState(true)
  const [followPaused, setFollowPaused] = useState(false)
  const [viewportRevision, setViewportRevision] = useState(0)
  useEffect(() => {
    const resize = () => setViewportRevision(value => value + 1)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const [confirmSave, setConfirmSave] = useState<SubtitleTrack | null>(null)
  const [deleteLanguage, setDeleteLanguage] = useState<string | null>(null)
  const attemptedLanguage = useRef('')
  const previousTargetLanguage = useRef(assistance?.targetLanguage)
  const [mode, setMode] = useState<'read' | 'article' | 'learn'>('read')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [loop, setLoop] = useState(false)
  const [hideText, setHideText] = useState(false)
  const [excerptRadius, setExcerptRadius] = useState<ExcerptRadius>(readExcerptRadius)
  const [excerptError, setExcerptError] = useState('')
  const [automaticResetting, setAutomaticResetting] = useState(false)
  const [automaticResetError, setAutomaticResetError] = useState('')
  const [automaticResetConfirm, setAutomaticResetConfirm] = useState(false)
  const loopRequested = useRef(false)
  const list = useRef<HTMLOListElement>(null)
  const doc = subtitles.document
  const platformChoices = useMemo(() => source === 'bilibili' || source === 'youtube' ? doc?.languages?.length ? doc.languages : doc?.parts?.[0]?.languages ?? emptySubtitleLanguages : emptySubtitleLanguages, [source, doc?.languages, doc?.parts])
  const choices = useMemo(() => platformChoices.length ? [...platformChoices, ...(doc?.tracks ?? []).filter(track => !platformChoices.some(candidate => candidate.language === track.language))] : doc?.tracks ?? [], [platformChoices, doc?.tracks])
  const defaultChoices = useMemo(() => subtitles.origin === 'saved' ? subtitles.saved.map(value => value.track) : choices, [subtitles.origin, subtitles.saved, choices])
  const savedSelection = subtitles.saved.find(value => value.selected)
  const hasManualSelection = manualSelection || !language && Boolean(savedSelection)
  const defaultLanguage = savedSelection?.track.language ?? defaultChoices.slice().sort((left, right) => subtitlePriority(left) - subtitlePriority(right))[0]?.language
  const selectedLanguage = language || defaultLanguage
  const targetCandidate = assistance?.targetLanguage ? preferredSubtitleLanguage(platformChoices, assistance.targetLanguage) : undefined
  const loadedSourceTrack = subtitles.origin === 'saved'
    ? subtitles.saved.find(candidate => candidate.track.language === selectedLanguage)?.track
    : doc?.tracks.find(candidate => candidate.language === selectedLanguage)
  const sourceTrack = sourceTrackOverride ?? loadedSourceTrack ?? (!selectedLanguage ? doc?.tracks.reduce<SubtitleTrack | undefined>((best, candidate) => !best || subtitlePriority(candidate) < subtitlePriority(best) ? candidate : best, undefined) : undefined)
  const automaticContentID = source === 'podcast' || source === 'local' ? item.platformId : `${source}:${item.platformId}`
  const automatic = useAutomaticSubtitles({
    contentId: automaticContentID,
    enabled: (item.kind === 'audio' || item.kind === 'video') && !subtitles.loading,
    hasFormalTrack: Boolean(sourceTrack?.cues.length || subtitles.saved.some(value => value.track.cues.length)),
    playing,
    ended,
    position,
    duration: item.kind === 'audio' || item.kind === 'video' ? item.durationSeconds : undefined,
    audioStream,
    onFinalized: () => { void subtitles.reloadSaved() },
  })
  const regenerateAutomatic = async () => {
    if (!track?.automatic || track.source !== 'automatic' || automaticResetting) return
    setAutomaticResetting(true)
    setAutomaticResetError('')
    try {
      const savedAutomatic = subtitles.saved.find(value => value.track.language === track.language)
      if (savedAutomatic && subtitles.origin === 'saved' && !await subtitles.remove(track.language)) return
      await automatic.reset()
      setSourceTrackOverride(null)
      setManualSelection(false)
      setLanguage('')
      setVisibleCount(200)
    } catch (cause) {
      setAutomaticResetError(cause instanceof Error ? cause.message : '自动字幕未能重新生成。')
    } finally {
      setAutomaticResetting(false)
    }
  }
  const desiredNative = hasManualSelection || (sourceTrack && assistance?.targetLanguage && subtitleTrackMatchesTarget(sourceTrack, assistance.targetLanguage)) ? undefined : targetCandidate
  const displayLanguage = desiredNative?.language || selectedLanguage
  const nativeRead = resolveNativeSubtitleTarget(desiredNative, subtitles.platformDocument?.tracks ?? [], subtitles.languageRead, sourceTrack)
  const nativeLoaded = nativeRead.track
  // A running automatic session is the freshest source of captions. Keep it
  // ahead of platform/saved tracks so an older local copy cannot hide new
  // draft cues while recognition is still in progress. Once the session is
  // terminal, the saved track becomes authoritative again after reloadSaved.
  const automaticLive = automatic.session && ['preparing', 'streaming', 'finalizing'].includes(automatic.session.state)
    ? automatic.track
    : null
  const track = automaticLive ?? nativeLoaded ?? sourceTrack ?? automatic.track
  const nativeSingleLanguage = Boolean(nativeLoaded && desiredNative)
  const visibleChoices = useMemo(() => availableSubtitleLanguages(choices as SubtitleLanguage[], nativeRead.failed ? desiredNative?.language : undefined), [choices, nativeRead.failed, desiredNative?.language])
  const trackHash = useMemo(() => track ? subtitleTrackHash(track) : '', [track])
  const sourceTrackHash = useMemo(() => sourceTrack ? subtitleTrackHash(sourceTrack) : '', [sourceTrack])
  useEffect(() => { (onPlatformLanguagesChange ?? assistance?.onPlatformLanguagesChange)?.(platformChoices, Boolean(doc), hasManualSelection) }, [platformChoices, onPlatformLanguagesChange, assistance?.onPlatformLanguagesChange, Boolean(doc), hasManualSelection])
  const alreadyTarget = useMemo(() => Boolean(track && assistance?.targetLanguage && subtitleTrackMatchesTarget(track, assistance.targetLanguage)), [track, assistance?.targetLanguage])
  const translated = !alreadyTarget && !nativeSingleLanguage && assistance?.track === sourceTrack ? assistance?.texts : undefined
  const hasTranslations = Boolean(!nativeSingleLanguage && sourceTrack?.cues.some((_, index) => translated?.[index]?.trim()))
  const translationsComplete = Boolean(!nativeSingleLanguage && sourceTrack?.cues.length && sourceTrack.cues.every((_, index) => translated?.[index]?.trim()))
  const {
    exportMode,
    exportNotice,
    exportError,
    selectExportMode,
    exportSRT,
    exportDocument,
  } = useSubtitleExport({ item, source, track: track ?? undefined, translated, hasTranslations, translationsComplete })
  const cueIndices = useMemo(() => new Map(track?.cues.map((cue, index) => [cue, index]) ?? []), [track])
  const atOriginal = (seconds: number) => source === 'podcast' || source === 'local' ? item.url : source === 'youtube' ? `https://www.youtube.com/watch?v=${encodeURIComponent(item.platformId)}&t=${Math.floor(seconds)}s` : `${item.url.split('?')[0]}?p=1&t=${Math.floor(seconds)}`
  const filter = query.trim().toLocaleLowerCase()
  const cues = useMemo(() => track?.cues.filter(cue => !filter || transcriptText(cue.text).toLocaleLowerCase().includes(filter) || transcriptText(translated?.[cueIndices.get(cue) ?? -1] ?? '').toLocaleLowerCase().includes(filter)) ?? [], [track, filter, translated, cueIndices])
  const paragraphs = useMemo(() => transcriptParagraphs(cues.slice(0, visibleCount)), [cues, visibleCount])
  const activeCue = track ? activeSubtitleCue(track.cues, position) : undefined

  useEffect(() => {
    setLanguage(''); setQuery(''); setVisibleCount(200); setActiveTool(null); setExportFormat('srt')
    setManualSelection(false)
  }, [item.platformId, source])
  useEffect(() => {
    if (previousTargetLanguage.current !== assistance?.targetLanguage) {
      previousTargetLanguage.current = assistance?.targetLanguage
      if (sourceTrack) setSourceTrackOverride(sourceTrack)
      attemptedLanguage.current = ''
    }
  }, [assistance?.targetLanguage, sourceTrack])
  useEffect(() => { setExcerptError('') }, [item.platformId, source, trackHash, sourceTrackHash])
  function excerpt(selected: readonly SubtitleCue[], radius = excerptRadius) {
    if (!sourceTrack || !onNoteAt) return
    setExcerptError('')
    setExcerptRadius(radius)
    rememberExcerptRadius(radius)
    try {
      const sourceCues = selected.map(cue => sourceTrack.cues.find(candidate => candidate.start <= cue.start && candidate.end > cue.start) ?? sourceTrack.cues.reduce<SubtitleCue | undefined>((best, candidate) => {
        if (!best) return candidate
        return Math.abs(candidate.start - cue.start) < Math.abs(best.start - cue.start) ? candidate : best
      }, undefined)).filter((cue): cue is SubtitleCue => Boolean(cue))
      const uniqueCues = [...new Map(sourceCues.map(cue => [cue.start, cue])).values()]
      if (!uniqueCues.length) throw new Error('当前源字幕没有对应段落，无法创建引用。')
      const reference = subtitleExcerpt(sourceTrack, uniqueCues, radius, sourceTrackHash)
      onNoteAt(selected[0].start, reference)
    } catch (cause) {
      setExcerptError(cause instanceof Error ? cause.message : '摘录未能加入，请重新选择。')
    }
  }

  useEffect(() => { onTrackChange?.(manualSelection && subtitles.loading ? null : track ?? null) }, [track, manualSelection, subtitles.loading, onTrackChange])
  useEffect(() => {
    if (!subtitles.localKnown || subtitles.loading || subtitles.pending || !sourceTrack?.cues.length) return
    const existing = subtitles.saved.find(value => value.track.language === sourceTrack.language)
    if (manualSelection) {
      if (sourceTrack.language !== selectedLanguage || existing?.selected && subtitleTrackHash(existing.track) === sourceTrackHash) return
      void subtitles.save(sourceTrack, true)
    } else if (subtitles.origin === 'platform' && !existing) void subtitles.save(sourceTrack)
  }, [sourceTrack, sourceTrackHash, selectedLanguage, manualSelection, subtitles.origin, subtitles.loading, subtitles.localKnown, subtitles.pending, subtitles.saved, subtitles.save])
  const availability = selectedSubtitleAvailability(doc, sourceTrack, subtitles.origin)
  useEffect(() => { onAvailabilityChange?.(availability) }, [availability, onAvailabilityChange])
  useEffect(() => () => onTrackChange?.(null), [onTrackChange])
  useEffect(() => {
    const choice = choices.find(candidate => candidate.language === displayLanguage)
    if ((!platformChoices.length && subtitles.origin !== 'platform') || !displayLanguage || !choice || doc?.tracks.some(candidate => candidate.language === displayLanguage) || desiredNative && subtitles.platformDocument?.tracks.some(candidate => candidate.language === displayLanguage) || attemptedLanguage.current === displayLanguage) return
    attemptedLanguage.current = displayLanguage
    if ('hasUrl' in choice && choice.hasUrl === false) return
    void subtitles.read(displayLanguage, true, subtitles.origin === 'saved' && Boolean(desiredNative))
  }, [displayLanguage, choices, platformChoices.length, doc, desiredNative, subtitles.origin, subtitles.platformDocument, subtitles.read])
  useEffect(() => { attemptedLanguage.current = ''; setSourceTrackOverride(null) }, [item.platformId, source])
  useEffect(() => {
    if (!follow || followPaused || filter || !activeCue || !onSeek) return
    const index = cues.indexOf(activeCue)
    if (index >= visibleCount) {
      setVisibleCount(Math.ceil((index + 1) / 200) * 200)
      return
    }
    const container = list.current
    const row = container?.querySelector<HTMLElement>('[data-subtitle-active="true"], [aria-current="true"]')
    if (container && row) {
      const viewport = container.getBoundingClientRect()
      const bounds = row.getBoundingClientRect()
      const viewportTop = viewport.top + container.clientTop
      const top = container.scrollTop + bounds.top - viewportTop
      if (Math.abs(Math.max(0, Math.min(top, container.scrollHeight - container.clientHeight)) - container.scrollTop) < 1) return
      container.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
  }, [follow, followPaused, filter, activeCue, onSeek, cues, visibleCount, mode, viewportRevision, settingsOpen])

  function pauseFollow() {
    if (!follow || !onSeek || position === null) return
    setFollowPaused(true)
    // Stop an in-flight automatic scroll before the user's own scroll runs.
    list.current?.scrollTo({ top: list.current.scrollTop, behavior: 'auto' })
  }

  useEffect(() => {
    const pane = list.current
    if (!pane) return
    const loadNextCues = () => {
      if (!pane.clientHeight || cues.length <= visibleCount ||
          pane.scrollTop + pane.clientHeight < pane.scrollHeight - 160) return
      setVisibleCount(Math.min(cues.length, visibleCount + 200))
    }
    pane.addEventListener('scroll', loadNextCues, { passive: true })
    return () => pane.removeEventListener('scroll', loadNextCues)
  }, [cues.length, visibleCount, mode])

  const studyCue = track?.cues[selectedIndex ?? (activeCue ? Math.max(0, track.cues.indexOf(activeCue)) : 0)]
  useEffect(() => { setSelectedIndex(null); setLoop(false); loopRequested.current = false }, [track?.language])
  useEffect(() => {
    if (!loop || !studyCue || !onSeek || position === null) return
    if (position < studyCue.end) { loopRequested.current = false; return }
    if (!loopRequested.current) { loopRequested.current = true; onSeek(studyCue.start) }
  }, [loop, studyCue, position, onSeek])
  function chooseCue(index: number) {
    if (!track) return
    const next = Math.max(0, Math.min(track.cues.length - 1, index))
    setSelectedIndex(next); loopRequested.current = false; onSeek?.(track.cues[next].start)
  }
  const transcription = <TranscriptionControls video={item.kind==='video'} contentId={source === 'podcast' || source === 'local' ? item.platformId : `${source}:${item.platformId}`} onComplete={() => { void subtitles.reloadSaved() }}/>
  const revealTranscription = () => {
    setActiveTool('transcription')
    window.setTimeout(() => {
      const control = reader.current?.querySelector<HTMLElement>('[data-transcription-control]')
      control?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }, 0)
  }

  const clearSourceConfirmation = () => { setConfirmSave(null); setDeleteLanguage(null); setAutomaticResetConfirm(false); setSourceDetailsOpen(false) }
  const toggleTool = (tool: NonNullable<typeof activeTool>) => {
    clearSourceConfirmation()
    setActiveTool(current => current === tool ? null : tool)
  }
  const closeTool = () => {
    reader.current?.querySelector<HTMLButtonElement>('.subtitle-tool-actions button[aria-expanded="true"], .subtitle-source-trigger[aria-expanded="true"], .subtitle-transcribe-trigger[aria-expanded="true"]')?.focus({ preventScroll: true })
    clearSourceConfirmation()
    setActiveTool(null)
  }
  const canTranslate = assistance && (!track || assistance.track === sourceTrack || desiredNative?.language === track.language)
  const fetchingSubtitles = subtitles.loading || nativeRead.status === 'loading'
  const localStatus = subtitles.localLoading ? '正在读取本机字幕' : !subtitles.localKnown ? '本机字幕状态未知' : `已保存 ${subtitles.saved.length} 种语言`
  return <section ref={reader} className={`subtitle-reader${track ? ' subtitle-reader-loaded' : ''}`} data-playing={playing ? 'true' : undefined} data-settings-open={settingsOpen} aria-label="字幕与阅读" onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented && activeTool && !(event.target as HTMLElement).closest('[popover]')) {
      event.preventDefault()
      event.stopPropagation()
      closeTool()
    }
  }}>
    <h2 className="visually-hidden">字幕</h2>
    <div className="subtitle-workbar">
      {track && <div className="subtitle-modes" role="group" aria-label="字幕阅读模式"><Button variant="quiet" aria-pressed={mode === 'read'} onClick={() => { setMode('read'); setLoop(false) }}>阅读</Button><Button variant="quiet" aria-pressed={mode === 'article'} onClick={() => { setMode('article'); setLoop(false) }}>文章</Button><Button variant="quiet" aria-pressed={mode === 'learn'} onClick={() => { setMode('learn'); setLoop(false); setSelectedIndex(null) }}>语言学习</Button></div>}
      {!track && <span className="subtitle-workbar-title"><Captions size={17} aria-hidden="true"/>字幕</span>}
      <div className="subtitle-reading-tools">
      {choices.length > 0 &&
      <label className="subtitle-language"><span className="visually-hidden">字幕语言</span><Select aria-label="字幕语言" value={nativeRead.failed ? sourceTrack?.language ?? selectedLanguage ?? '' : displayLanguage ?? track?.language ?? ''} disabled={subtitles.pending} onChange={event => {
        const selected = event.target.value
        const loaded = doc?.tracks.find(value => value.language === selected) ?? subtitles.platformDocument?.tracks.find(value => value.language === selected)
        setLanguage(selected); setSourceTrackOverride(loaded ?? null); setManualSelection(true); setVisibleCount(200)
        const candidate = choices.find(value => value.language === selected)
        if (!loaded && (!candidate || !('hasUrl' in candidate) || candidate.hasUrl !== false) && !doc?.tracks.some(value => value.language === selected)) {
          attemptedLanguage.current = selected
          void subtitles.read(selected, true)
        }
      }}>{visibleChoices.map(candidate => <option key={candidate.language} value={candidate.language}>{candidate.label}{candidate.automatic ? ' · 自动' : ''}{platformLanguageSourceLabel(candidate, source) ? ` · ${platformLanguageSourceLabel(candidate, source)}` : ''}{'hasUrl' in candidate && candidate.hasUrl === false ? ' · 暂无字幕地址' : ''}</option>)}</Select></label>
      }
      {track && <label className="subtitle-search"><Search size={15} aria-hidden="true"/><Input type="search" aria-label="搜索字幕" placeholder="搜索字幕" value={query} onChange={event => { setQuery(event.target.value); setVisibleCount(200) }} maxLength={200}/>{query && <Button variant="quiet" type="button" className="subtitle-search-clear" aria-label="清除字幕搜索" title="清除搜索" onClick={() => { setQuery(''); setVisibleCount(200) }}><X size={14} aria-hidden="true"/></Button>}</label>}
      <div className="subtitle-tool-actions" role="group" aria-label="字幕工具">
        {canTranslate && <Tooltip content="字幕翻译"><Button variant="quiet" type="button" iconOnly className="icon-button" aria-label="字幕翻译" aria-expanded={activeTool === 'translation'} aria-controls={`${settingsId}-translation`} onClick={() => toggleTool('translation')}><Languages size={17} aria-hidden="true"/></Button></Tooltip>}
        {track && <Tooltip content="导出字幕与文稿"><Button variant="quiet" type="button" iconOnly className="icon-button" aria-label="导出字幕与文稿" aria-expanded={activeTool === 'export'} aria-controls={`${settingsId}-export`} onClick={() => toggleTool('export')}><ArrowDownToLine size={17} aria-hidden="true"/></Button></Tooltip>}
      </div>
      </div>
    <div className="subtitle-statusbar">
      <div className="subtitle-track-status">
        <Button variant="quiet" type="button" className="subtitle-source-trigger" data-save-error={Boolean(subtitles.writeError)} title={subtitles.writeError ? '字幕未保存，点击查看详情' : undefined} aria-label="字幕来源与保存" aria-expanded={activeTool === 'source'} aria-controls={`${settingsId}-source`} onClick={() => toggleTool('source')}>{subtitles.writeError ? <TriangleAlert size={13} aria-hidden="true"/> : subtitles.origin === 'saved' ? <HardDrive size={13} aria-hidden="true"/> : <Captions size={14} aria-hidden="true"/>}{subtitles.writeError ? '保存失败' : subtitles.origin === 'saved' ? '本机字幕' : track ? platformSourceLabel(track, source) || '源字幕' : '字幕来源'}</Button>
        {track && <span role="status" title={nativeSingleLanguage ? nativePlatformSourceDescription(track, source) : undefined}>{filter ? `匹配 ${cues.length} / ${track.cues.length} 段` : `${track.cues.length} 段字幕`}{subtitles.origin !== 'saved' && subtitles.saved.some(value => value.track.language === track.language) && ' · 已存本机'}{track.mismatch && ' · 疑似错位'}</span>}
        {track && !fetchingSubtitles && <Button variant="quiet" type="button" className="subtitle-transcribe-trigger" aria-expanded={activeTool === 'transcription'} aria-controls={`${settingsId}-transcription`} onClick={() => toggleTool('transcription')}><Mic size={13} aria-hidden="true"/>转录</Button>}
      </div>
      {track && <div className="subtitle-follow-tools">
        {filter ? <span className="subtitle-follow-hint">搜索时暂停跟随</span> : follow && followPaused ? <Button variant="quiet" className="subtitle-resume" onClick={() => setFollowPaused(false)}>继续跟随播放</Button> : null}
        <label className="subtitle-follow"><Checkbox type="checkbox" checked={follow} disabled={!onSeek} onChange={event => { setFollow(event.target.checked); setFollowPaused(false) }}/>跟随播放</label>
      </div>}
    </div>
    </div>
    {desiredNative && nativeRead.status === 'loading' && <p className="subtitle-native-read-state" role="status">正在读取{desiredNative.label}平台字幕…</p>}
    {desiredNative && nativeRead.status === 'error' && <p className="subtitle-native-read-state" role="alert">{subtitles.languageRead?.error || '平台目标字幕暂时无法读取。'}已切换为当前源字幕，可使用 AI 翻译。</p>}
    <div id={`${settingsId}-translation`} className="subtitle-inline-panel" role="region" aria-label="字幕翻译设置" hidden={activeTool !== 'translation'}>
      <div className="subtitle-panel-heading"><h3>字幕翻译</h3><Button variant="quiet" iconOnly className="icon-button subtitle-inline-close" aria-label="关闭字幕翻译" onClick={closeTool}><X size={15}/></Button></div>
      {canTranslate && <div className="subtitle-assistance">{assistance.controls}</div>}
    </div>
    <div id={`${settingsId}-export`} className="subtitle-inline-panel" role="region" aria-label="导出字幕与文稿" hidden={activeTool !== 'export'}>
      <div className="subtitle-panel-heading"><h3>导出字幕与文稿</h3><Button variant="quiet" iconOnly className="icon-button subtitle-inline-close" aria-label="关闭字幕导出" onClick={closeTool}><X size={15}/></Button></div>
      <div className="subtitle-export-form">
        <label>文件格式<Select aria-label="导出文件格式" value={exportFormat} onChange={event => setExportFormat(event.target.value as 'srt' | 'markdown')}><option value="srt">SRT 字幕</option><option value="markdown">Markdown 文稿</option></Select></label>
        <label>导出内容<Select aria-label="导出内容" value={exportMode} onChange={event => selectExportMode(event.target.value as typeof exportMode)}><option value="original">原文</option><option value="bilingual" disabled={!hasTranslations}>双语{!hasTranslations ? '（暂无译文）' : ''}</option><option value="translated" disabled={!translationsComplete}>译文{!translationsComplete ? '（翻译未完成）' : ''}</option></Select></label>
        <Button variant="primary" className="button button-primary" disabled={!track} onClick={() => exportFormat === 'srt' ? exportSRT(exportMode) : exportDocument()}><ArrowDownToLine size={15}/>{exportFormat === 'srt' ? '导出 SRT' : '导出文稿'}</Button>
      </div>
      {exportNotice && <p className="field-hint" role="status">{exportNotice}</p>}
      {exportError && <p className="field-hint" role="alert">{exportError}</p>}
    </div>
    <div id={`${settingsId}-source`} className="subtitle-inline-panel subtitle-source-panel" role="region" aria-label="字幕来源与保存" hidden={activeTool !== 'source'}>
      <div className="subtitle-source-form">
        <label>来源<Select aria-label="读取字幕来源" value={subtitles.origin} disabled={subtitles.pending || subtitles.loading} onChange={event => { clearSourceConfirmation(); setLanguage(''); setSourceTrackOverride(null); setManualSelection(false); setVisibleCount(200); if (event.target.value === 'saved') subtitles.useSaved(); else void subtitles.read() }}><option value="platform">{source === 'local' ? '导入字幕' : source === 'podcast' ? '节目字幕' : '平台字幕'}</option><option value="saved" disabled={subtitles.saved.length === 0}>本机字幕（{subtitles.saved.length} 种语言）</option></Select></label>
        <span className="subtitle-local-status" role="status">{subtitles.notice || localStatus}</span>
        {track?.mismatch && <div className="subtitle-source-warning" role="status"><TriangleAlert size={14} aria-hidden="true"/><span>字幕疑似不符</span><Button variant="quiet" type="button" className="text-button" onClick={revealTranscription}>改用转录</Button></div>}
        <div className="subtitle-source-actions">
          {subtitles.loading ? <Button variant="secondary" className="button button-secondary" onClick={subtitles.cancel}><X size={14}/>取消获取</Button> : <Button variant="secondary" className="button button-secondary" disabled={subtitles.pending} onClick={() => { clearSourceConfirmation(); setVisibleCount(200); if (subtitles.origin === 'saved') void subtitles.reloadSaved(); else void subtitles.read() }}><RefreshCw size={14}/>{subtitles.origin === 'saved' ? '重新读取本机字幕' : doc ? '重新获取字幕' : '读取字幕'}</Button>}
          {track && (subtitles.origin === 'platform' ? <Button variant="secondary" className="button button-secondary" disabled={!subtitles.localKnown || subtitles.loading || subtitles.pending} onClick={() => { setDeleteLanguage(null); if (subtitles.saved.some(value => value.track.language === track.language)) setConfirmSave(track); else void subtitles.save(track) }}><Save size={14}/>{subtitles.pending ? '正在保存' : '保存此语言到本机'}</Button> : <Tooltip content="移除此语言的本机字幕"><Button variant="quiet" iconOnly className="icon-button" aria-label="移除此语言的本机字幕" disabled={!subtitles.localKnown || subtitles.pending || subtitles.localLoading} onClick={() => { setConfirmSave(null); setDeleteLanguage(track.language) }}><Trash2 size={15}/></Button></Tooltip>)}
        </div>
        {doc && <Tooltip content="字幕来源详情"><Button variant="quiet" iconOnly className="icon-button" aria-label="字幕来源详情" aria-expanded={sourceDetailsOpen} aria-controls={`${settingsId}-source-details`} onClick={() => setSourceDetailsOpen(value => !value)}><Info size={16}/></Button></Tooltip>}
        <Button variant="quiet" iconOnly className="icon-button subtitle-inline-close" aria-label="关闭字幕来源" onClick={closeTool}><X size={15}/></Button>
      </div>
      {subtitles.writeError && <p className="subtitle-save-error">{subtitles.writeError} 已保存版本仍保留，请重新读取本机字幕后重试。<Button variant="quiet" className="text-button" disabled={subtitles.localLoading || subtitles.pending} onClick={() => void subtitles.reloadSaved()}>重新读取本机字幕</Button></p>}
      {automaticResetConfirm && <div className="saved-subtitle-confirm"><p>重新生成会移除当前显示版本，并在下一次播放时重新识别。原版本会留在字幕历史中。</p><Button variant="secondary" className="button button-secondary" disabled={automaticResetting} onClick={() => setAutomaticResetConfirm(false)}>暂不重新生成</Button><Button variant="primary" className="button button-primary" disabled={automaticResetting} onClick={() => { setAutomaticResetConfirm(false); void regenerateAutomatic() }}>确认重新生成</Button></div>}
      {confirmSave && <div className="saved-subtitle-confirm"><p>本机已有 {confirmSave.label}，要用当前平台版本覆盖吗？</p><Button variant="secondary" className="button button-secondary" disabled={subtitles.pending} onClick={() => setConfirmSave(null)}>保留本机版本</Button><Button variant="primary" className="button button-primary" disabled={!subtitles.localKnown || subtitles.pending || subtitles.localLoading} onClick={() => { void subtitles.save(confirmSave); setConfirmSave(null) }}>确认覆盖字幕</Button></div>}
      {deleteLanguage && <div className="saved-subtitle-confirm"><p>移除 {deleteLanguage} 的本机字幕？笔记和视频文件保留。</p><Button variant="secondary" className="button button-secondary" disabled={subtitles.pending} onClick={() => setDeleteLanguage(null)}>保留本机字幕</Button><Button variant="primary" className="button button-primary" disabled={!subtitles.localKnown || subtitles.pending || subtitles.localLoading} onClick={() => { void subtitles.remove(deleteLanguage).then(ok => { if (ok) setDeleteLanguage(null) }) }}>确认移除字幕</Button></div>}
    {doc && <div id={`${settingsId}-source-details`} className="subtitle-source-details" hidden={!sourceDetailsOpen}>
      {track?.mismatch && <p className="subtitle-note">字幕与标题的相关性较低，请核对是否对应当前视频。也可以重新获取字幕或改用转录。</p>}
      {source === 'youtube' && <p className="subtitle-note">简体中文 CC 优先，其次简体中文 AI，再到其他语言。翻译目标有平台字幕时直接使用平台轨道。</p>}
      {doc.parts && <div className="subtitle-parts" aria-label="各分 P 字幕状态">{doc.parts.map(part => { const presentation = subtitlePartMessage(part); const current = part.page === doc.part; const retry = presentation.action === '重试' || presentation.action === '稍后重试'; const candidates = part.languages.map(candidate => `${candidate.label} · ${candidate.source === 'cc' ? 'CC' : candidate.source === 'yt-dlp' ? 'yt-dlp' : 'AI'}${candidate.hasUrl ? '' : '（字幕地址为空）'}`).join('、'); return <div key={`${part.page}-${part.cid}`} className={`subtitle-part-status subtitle-part-${presentation.tone}`}><span>第 {part.page} 分 P{part.title ? ` · ${part.title}` : ''}</span><span>{presentation.message}</span>{candidates && <span className="subtitle-part-candidates">字幕候选：{candidates}</span>}{current && retry && <Button variant="quiet" type="button" className="text-button" onClick={() => void subtitles.read()}>{presentation.action}</Button>}{retry && !current && <span className="subtitle-part-retry-note">如需重试，请重新获取全部分 P 字幕。</span>}{current && presentation.action === '去账号设置' && <a className="text-button" href="/tools#accounts">去账号设置</a>}{current && (presentation.action === '改用转录' || presentation.action === '转录') && <Button variant="quiet" type="button" className="text-button" onClick={revealTranscription}>{presentation.action === '转录' ? '转录' : '改用转录'}</Button>}{presentation.action === '去账号设置' && !current && <a className="text-button" href="/tools#accounts">去账号设置</a>}</div> })}</div>}
    </div>}
    {track?.automatic && track.source === 'automatic' && <div className="saved-subtitle-actions"><Button variant="secondary" className="button button-secondary" disabled={automaticResetting || subtitles.pending || subtitles.localLoading} onClick={() => setAutomaticResetConfirm(true)}><RefreshCw size={15}/>{automaticResetting ? '正在准备重新生成' : '重新生成自动字幕'}</Button><span className="field-hint">当前版本会保留在字幕历史中。</span></div>}
    </div>
    {!doc && !subtitles.loading && !subtitles.error && <p className="subtitle-note">{source==='local'?`读取已保存的本机字幕。当前${item.platformId.startsWith('xiaohongshu:')?'小红书':'抖音'}适配不读取平台原字幕，可主动转录。`:'读取平台已有字幕，视频和音频无需保存到本机。'}</p>}
    {automatic.session?.state === 'preparing' || automatic.session?.state === 'streaming' || automatic.session?.state === 'finalizing' ? <p className="subtitle-note" role="status">正在自动生成字幕…{automatic.session.capability === 'batch-only' ? '当前播放器无法提供实时音频，将在识别完成后生成完整稿。' : automatic.session.state === 'finalizing' ? '正在整理完整稿。' : '播放会继续进行，字幕会随识别结果更新。'}</p> : null}
    {automatic.error && <p className="subtitle-error" role="alert">{automatic.error}<Button variant="quiet" className="text-button" onClick={revealTranscription}>改用手动转录</Button></p>}
    {automaticResetError && <p className="subtitle-error" role="alert">{automaticResetError}</p>}
    {subtitles.loading && <p className="subtitle-note" role="status"><LoaderCircle size={16} className="spin" />{subtitles.localLoading ? '正在读取本机字幕…' : '正在获取已有字幕…'}</p>}
    {subtitles.localError && <p className="subtitle-error" role="alert">{subtitles.localError} {source==='local'?'请重试读取本机字幕。':'本机保存暂不可用，平台字幕仍可读取。'}</p>}
    {writeNotice && <div className="subtitle-save-notice" role="status"><TriangleAlert size={16} aria-hidden="true"/><span>字幕未保存，请重新读取本机字幕后重试。</span><Button variant="quiet" className="text-button" onClick={() => { setActiveTool('source'); setWriteNotice(''); requestAnimationFrame(() => reader.current?.querySelector<HTMLElement>('.subtitle-source-panel')?.scrollIntoView({ block: 'nearest' })) }}>查看</Button><Button variant="quiet" iconOnly className="icon-button" aria-label="关闭字幕保存提示" title="关闭提示" onClick={() => setWriteNotice('')}><X size={14}/></Button></div>}
    {subtitles.error && <p className="subtitle-error" role="alert">{subtitles.error}{doc && ' 下方保留上一次获取的结果。'}</p>}
    {!doc?.parts?.length && doc && ['rate_limited', 'api_empty', 'login_required', 'error'].includes(doc.status) && <div className={doc.status === 'error' ? 'subtitle-error' : 'subtitle-empty'} role={doc.status === 'error' ? 'alert' : 'status'}><p>{subtitleDocumentMessage(doc.status, doc.errorCode, doc.errorMessage)}</p>{doc.status !== 'api_empty' && doc.status !== 'login_required' && <Button variant="quiet" type="button" className="text-button" onClick={() => void subtitles.read()}>{doc.status === 'rate_limited' ? '稍后重试' : '重试'}</Button>}{(doc.status === 'api_empty' || doc.status === 'login_required') && <a href="/tools#accounts">去账号设置</a>}</div>}
    {excerptError && <div className="subtitle-excerpt-error" role="alert"><span>{excerptError}</span><Button variant="quiet" className="text-button" onClick={() => { setMode('read'); setLoop(false); setExcerptRadius(0); rememberExcerptRadius(0); setExcerptError('') }}>改用本句</Button></div>}
    {!doc?.parts?.length && doc?.status === 'none' && <p className="subtitle-note" role="status">{source === 'local' ? `没有已保存的本机字幕。当前${item.platformId.startsWith('xiaohongshu:')?'小红书':'抖音'}适配不读取平台原字幕，可主动转录。` : source === 'podcast' ? '还没有逐字字幕，可以按需转录。' : source === 'youtube' ? '这个视频暂无可用的原始字幕，可以按需转录。' : '第一分 P 暂无可用字幕，可以按需转录。'}</p>}
    <div id={`${settingsId}-transcription`} className="subtitle-inline-panel subtitle-transcription-panel" role="region" aria-label="转录字幕" hidden={fetchingSubtitles || (Boolean(track) && activeTool !== 'transcription') || (!track && activeTool !== null && activeTool !== 'transcription')}>
      {transcription}
      {track && <Button variant="quiet" iconOnly className="icon-button subtitle-inline-close" aria-label="关闭字幕转录" onClick={closeTool}><X size={15}/></Button>}
    </div>
    {track && <>
      {mode === 'learn' && studyCue && <div className="subtitle-study" aria-label="逐句学习">
        <div className="subtitle-study-heading"><span>逐句精听 · {timestamp(studyCue.start)}</span><Button variant="quiet" aria-pressed={hideText} onClick={() => setHideText(value => !value)}>{hideText ? '显示原文' : '隐藏原文'}</Button></div>
        <p>{hideText ? '先听一遍，再显示原文。' : transcriptText(studyCue.text)}</p>
        {!hideText && translated?.[cueIndices.get(studyCue) ?? -1] && <p className="subtitle-translated" lang={assistance?.targetLanguage ?? 'zh-Hans'}>{translated[cueIndices.get(studyCue)!]}</p>}
        <div className="subtitle-study-actions"><Button variant="quiet" iconOnly className="icon-button" aria-label="上一句" disabled={!onSeek || track.cues.indexOf(studyCue) === 0} onClick={() => chooseCue(track.cues.indexOf(studyCue) - 1)}><ChevronLeft size={17}/></Button><Button variant="secondary" className="button button-secondary" disabled={!onSeek} onClick={() => onSeek?.(studyCue.start)}><Repeat2 size={14}/>回到句首</Button><Button variant="quiet" iconOnly className="icon-button" aria-label="下一句" disabled={!onSeek || track.cues.indexOf(studyCue) === track.cues.length - 1} onClick={() => chooseCue(track.cues.indexOf(studyCue) + 1)}><ChevronRight size={17}/></Button><label><Checkbox type="checkbox" checked={loop} disabled={!onSeek} onChange={event => { setLoop(event.target.checked); setSelectedIndex(track.cues.indexOf(studyCue)); if(event.target.checked)onSeek?.(studyCue.start) }}/>循环本句</label></div>
      </div>}
      {cues.length > 0 ? <ol ref={list} className={`subtitle-cues ${onSeek ? 'synchronized' : ''} ${mode === 'article' ? 'subtitle-article-mode' : ''}`} aria-label="字幕段落" tabIndex={0} onWheel={pauseFollow} onTouchMove={pauseFollow} onKeyDown={event => { if (event.target === event.currentTarget && ['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) pauseFollow() }} onPointerDown={event => { const bounds = event.currentTarget.getBoundingClientRect(); if (event.target === event.currentTarget && event.clientX >= bounds.left + event.currentTarget.clientWidth) pauseFollow() }}>{mode === 'article' ? paragraphs.map((paragraph, index) => <li key={`${paragraph[0].start}-${index}`}>
        <div className="subtitle-cue-text">
          <p>{paragraph.map((cue, cueIndex) => <span key={cueIndices.get(cue)} data-subtitle-active={activeCue === cue ? 'true' : undefined} data-cue-start={cue.start}>{cueIndex > 0 && transcriptSeparator(transcriptText(paragraph[cueIndex - 1].text), transcriptText(cue.text))}{highlightMatch(transcriptText(cue.text), filter)}</span>)}</p>
          {paragraph.some(cue => translated?.[cueIndices.get(cue) ?? -1]) && <p className="subtitle-translated" lang={assistance?.targetLanguage ?? 'zh-Hans'}>{paragraph.map(cue => ({ cue, text: transcriptText(translated?.[cueIndices.get(cue) ?? -1] ?? '') })).filter(value => value.text).map(({cue, text}, cueIndex, values) => <span key={cueIndices.get(cue)} data-subtitle-active={activeCue === cue ? 'true' : undefined}>{cueIndex > 0 && transcriptSeparator(values[cueIndex - 1].text, text)}{highlightMatch(text, filter)}</span>)}</p>}
          {onNoteAt && <div className="subtitle-excerpt-actions"><Button variant="quiet" type="button" className="subtitle-note-button" aria-label={`记录字幕时间 ${timestamp(paragraph[0].start)}`} title="关联这段开始的时间，写下想法" onClick={() => onNoteAt(paragraph[0].start, undefined)}><StickyNote size={14} aria-hidden="true"/><span>记笔记</span></Button><SubtitleExcerptAction time={timestamp(paragraph[0].start)} paragraph radius={excerptRadius} onExcerpt={radius => excerpt(paragraph, radius)}/></div>}
        </div>
      </li>) : cues.slice(0, visibleCount).map((cue, index) => <li key={`${cue.start}-${index}`} aria-current={activeCue === cue ? 'true' : undefined}>
        <div className="subtitle-cue-actions">{onSeek ? <Button variant="quiet" className="subtitle-time" title={`跳转到 ${timestamp(cue.start)}`} aria-label={`跳转播放时间 ${timestamp(cue.start)}`} onClick={() => { if(mode==='learn')setSelectedIndex(track.cues.indexOf(cue)); onSeek(cue.start) }}><time>{timestamp(cue.start)}</time></Button> : <a className="subtitle-time" href={atOriginal(cue.start)} target="_blank" rel="noopener noreferrer" aria-label={source === 'podcast' ? '打开原节目' : `在原视频打开 ${timestamp(cue.start)}`}><time>{timestamp(cue.start)}</time><ExternalLink size={12}/></a>}</div>
        <div className="subtitle-cue-text"><p>{highlightMatch(transcriptText(cue.text), filter)}</p>{translated?.[cueIndices.get(cue) ?? -1] && <p className="subtitle-translated" lang={assistance?.targetLanguage ?? 'zh-Hans'}>{highlightMatch(transcriptText(translated[cueIndices.get(cue)!]), filter)}</p>}</div>
        {onNoteAt && <div className="subtitle-row-tools"><Button variant="quiet" type="button" className="subtitle-note-button" aria-label={`记录字幕时间 ${timestamp(cue.start)}`} title="关联这个时间，写下想法" onClick={() => onNoteAt(cue.start)}><StickyNote size={14} aria-hidden="true"/><span>记笔记</span></Button><SubtitleExcerptAction time={timestamp(cue.start)} radius={excerptRadius} onExcerpt={radius => excerpt([cue], radius)}/></div>}
      </li>)}</ol> : <p className="subtitle-note">没有匹配的字幕，试试其他关键词。</p>}
      {cues.length > visibleCount && <Button variant="secondary" className="button button-secondary subtitle-more" onClick={() => setVisibleCount(count => Math.min(cues.length, count + 200))}>继续阅读字幕（已显示 {visibleCount} / {cues.length} 段）</Button>}
    </>}
  </section>
}
