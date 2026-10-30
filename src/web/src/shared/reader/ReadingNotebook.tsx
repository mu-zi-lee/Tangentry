import { Button } from '../../components/ui'
import { BookOpen, Maximize, Minimize, StickyNote, Sparkles } from 'lucide-react'
import { Children, createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { ReaderNavigation } from './ReaderActions'
import './readingNotebook.css'

type NotebookPanel = 'content' | 'notes' | 'ai'
type NotebookContextValue = {
  showNotes: () => void
  showAI: () => void
  setAIContent: (content: ReactNode | null) => void
}

const NotebookContext = createContext<NotebookContextValue | null>(null)

export function useReadingNotebook() {
  return useContext(NotebookContext)
}

export function ReadingNotebook({ enabled = true, ai, contentLabel = '内容', children }: { enabled?: boolean; ai?: ReactNode; contentLabel?: string; children: ReactNode }) {
  const [panel, setPanel] = useState<NotebookPanel>(() => {
    const hasNotes = Children.toArray(children).some(child => String((child as ReactElement<{ className?: string }>).props?.className ?? '').includes('reading-notes'))
    return hasNotes && typeof window !== 'undefined' && !window.matchMedia('(max-width: 960px)').matches ? 'notes' : 'content'
  })
  const [theater, setTheater] = useState(false)
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 960px)')
    const leaveTheater = () => { if (mobile.matches) setTheater(false) }
    mobile.addEventListener('change', leaveTheater)
    return () => mobile.removeEventListener('change', leaveTheater)
  }, [])
  const [registeredAI, setRegisteredAI] = useState<ReactNode | null>(null)
  const aiContent = registeredAI ?? ai
  const notebookEnabled = enabled || Boolean(aiContent)
  const content = Children.toArray(children)
  const notes = content.filter(child => String((child as ReactElement<{ className?: string }>).props?.className ?? '').includes('reading-notes'))
  const primary = content.filter(child => !notes.includes(child))
  const hasNotes = notes.length > 0

  const showNotes = useCallback(() => { setTheater(false); setPanel('notes') }, [])
  const showAI = useCallback(() => { setTheater(false); setPanel('ai') }, [])
  const showContent = useCallback(() => { setTheater(false); setPanel('content') }, [])
  const setAIContent = useCallback((content: ReactNode | null) => setRegisteredAI(() => content), [])
  const context = useMemo<NotebookContextValue>(() => ({ showNotes, showAI, setAIContent }), [setAIContent, showAI, showNotes])

  useEffect(() => {
    if (panel === 'ai' && !aiContent) setPanel('content')
    if (panel === 'notes' && !hasNotes) setPanel('content')
  }, [aiContent, hasNotes, panel])

  return <NotebookContext.Provider value={notebookEnabled ? context : null}>
    <div className={`reading-columns${notebookEnabled ? ' reading-notebook-v2' : ''}${aiContent ? ' reading-has-ai' : ''}`} data-notebook-panel={panel} data-theater={theater}>
      {enabled && <ReaderNavigation><div className="reading-notebook-navigation" role="group" aria-label="阅读区域">
        <Button variant="quiet" type="button" aria-pressed={panel === 'content'} onClick={showContent}><BookOpen size={16} aria-hidden="true" />{contentLabel}</Button>
        {hasNotes && <Button variant="quiet" type="button" aria-pressed={panel === 'notes'} onClick={showNotes}><StickyNote size={16} aria-hidden="true" />笔记</Button>}
        {aiContent && <Button variant="quiet" type="button" aria-pressed={panel === 'ai'} onClick={showAI}><Sparkles size={16} aria-hidden="true" />AI 辅助</Button>}
        <Button variant="quiet" type="button" className="reading-theater-toggle" aria-pressed={theater} onClick={() => setTheater(value => !value)}>{theater ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}<span>{theater ? '退出专注' : '专注模式'}</span></Button>
      </div></ReaderNavigation>}
      {primary}
      {aiContent && <aside className="reading-ai" aria-label="AI 大纲与对话"><div className="reading-ai-heading"><strong><Sparkles size={15} aria-hidden="true" />AI 辅助</strong></div>{aiContent}</aside>}
      {hasNotes && notes}
    </div>
  </NotebookContext.Provider>
}
