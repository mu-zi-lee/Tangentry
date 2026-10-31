import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { applyCardAppearance, readCardAppearance } from './features/settings/useCardAppearance'
import { applyFontSettings, readInitialFontSettings } from './features/settings/useFontSettings'
import { CardTranslation } from './features/ai/TextTranslation'
import { CardTextProvider } from './shared/ui/CardText'
import './app/styles.css'

applyCardAppearance(readCardAppearance())
applyFontSettings(readInitialFontSettings())
createRoot(document.getElementById('root')!).render(<StrictMode><CardTextProvider value={CardTranslation}><App /></CardTextProvider></StrictMode>)
