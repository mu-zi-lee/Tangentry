import { useCallback, useState } from 'react'
import { useSubtitleTranslation } from '../features/ai/useSubtitleTranslation'
import { SubtitleTranslation } from '../features/ai/SubtitleTranslation'
import { useSummary } from '../features/ai/useSummary'
import { SummaryControl } from '../features/ai/SummaryControl'
import type { SummarySource } from '../features/ai/summaryMarkdown'
import type { SubtitleLanguage, SubtitleTrack } from '../shared/api/types'
import { preferredSubtitleLanguage, subtitleTargetLabel } from '../features/subtitles/subtitleLanguageMatch'
import type { SubtitleAssistance } from '../shared/ui/subtitleAssistance'
import { ReaderActions } from '../shared/reader/ReaderActions'
import { readTranslationLanguage } from '../features/ai/useTranslationLanguage'
const noPlatformLanguages: SubtitleLanguage[] = []
export function useSubtitleAssistance(contentId: string, track: SubtitleTrack | null, onSeek?: (seconds: number) => void, source?: SummarySource, showSummary = true): SubtitleAssistance | undefined {
  const [platformState, setPlatformState] = useState<{ contentId: string; languages: SubtitleLanguage[]; ready: boolean }>(() => ({ contentId, languages: [], ready: !contentId.startsWith('bilibili:') && !contentId.startsWith('youtube:') }))
  const [selectedTarget, setSelectedTarget] = useState(readTranslationLanguage)
  const platformStateCurrent = platformState.contentId === contentId
  const availableLanguages = platformStateCurrent ? platformState.languages : []
  const platformLanguagesReady = platformStateCurrent ? platformState.ready : !contentId.startsWith('bilibili:') && !contentId.startsWith('youtube:')
  const usableTrack = track?.cues.length ? track : null
  // A platform AI track marked as mismatched may still be useful for manual
  // reading, but it must never become the source of a summary or translation.
  const trustedTrack = usableTrack && !usableTrack.mismatch ? usableTrack : null
  const nativeTarget = preferredSubtitleLanguage(availableLanguages, selectedTarget)
  const translation = useSubtitleTranslation(contentId, trustedTrack ?? undefined, undefined, selectedTarget, availableLanguages, platformLanguagesReady)
  const summary = useSummary(contentId, 'subtitle', trustedTrack ?? undefined, onSeek)
  const updatePlatformLanguages = useCallback((languages: SubtitleLanguage[], ready: boolean, manualSelection = false) => {
    const available = manualSelection ? noPlatformLanguages : languages
    setPlatformState(previous => {
      if (previous.contentId === contentId && previous.ready === ready && previous.languages === available) return previous
      return { contentId, languages: available, ready }
    })
  }, [contentId])
  if (!usableTrack && !nativeTarget && availableLanguages.length === 0) return undefined
  return { track: usableTrack ?? undefined, nativeTarget, targetLanguage: selectedTarget, onTargetLanguageChange: setSelectedTarget, onPlatformLanguagesChange: updatePlatformLanguages, controls: <><SubtitleTranslation translation={translation} targetLabel={subtitleTargetLabel(selectedTarget)} nativeTarget={nativeTarget} targetLanguage={selectedTarget} onTargetLanguageChange={setSelectedTarget} hasSourceTrack={Boolean(trustedTrack)} />{trustedTrack && showSummary && <ReaderActions><SummaryControl summary={summary} source={source}/></ReaderActions>}</>, texts: translation.show ? translation.inspection?.result.texts : undefined, summary }
}
