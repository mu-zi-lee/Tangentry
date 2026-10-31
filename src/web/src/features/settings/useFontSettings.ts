import { createAppearancePreference } from '../../shared/preferences/appearancePreference'

export type UIFont = 'system' | 'inter' | 'noto'
export type ReadingFont = 'system' | 'wenkai' | 'noto' | 'serif'
export type ReadingSize = 'small' | 'medium' | 'large'
export type ReadingLineHeight = 'compact' | 'comfortable' | 'relaxed'

export interface FontSettings {
  ui: UIFont
  reading: ReadingFont
  size: ReadingSize
  lineHeight: ReadingLineHeight
  fontSize?: number
}

export const defaultFontSettings: FontSettings = {
  ui: 'inter',
  reading: 'serif',
  size: 'medium',
  lineHeight: 'comfortable',
}

export const fontSettingsKey = 'tangentry-font-settings'
export const fontSettingsChangedEvent = 'tangentry-font-settings-changed'

export const uiFontStacks: Record<UIFont, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Segoe UI', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  inter: "'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Segoe UI', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  noto: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Segoe UI', 'Microsoft YaHei', sans-serif",
}

export const readingFontStacks: Record<ReadingFont, string> = {
  serif: "Georgia, 'Songti SC', 'Noto Serif SC', serif",
  system: "'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Segoe UI', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  wenkai: "'Inter', 'LXGW WenKai Screen', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  noto: "'Inter', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
}

export const readingSizes: Record<ReadingSize, string> = { small: '14px', medium: '15px', large: '17px' }
export const readingLineHeights: Record<ReadingLineHeight, string> = { compact: '1.7', comfortable: '1.9', relaxed: '2.1' }

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function option<T extends string>(value: unknown, values: Record<T, string>, fallback: T): T {
  return typeof value === 'string' && value in values ? value as T : fallback
}

function availableStorage(): StorageLike | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

export function validateFontSettings(value: unknown): FontSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<FontSettings>
  return {
    ui: option(raw.ui, uiFontStacks, defaultFontSettings.ui),
    reading: raw.reading === 'wenkai' ? 'serif' : option(raw.reading, readingFontStacks, defaultFontSettings.reading),
    size: option(raw.size, readingSizes, defaultFontSettings.size),
    lineHeight: option(raw.lineHeight, readingLineHeights, defaultFontSettings.lineHeight),
    ...(typeof raw.fontSize === 'number' && Number.isFinite(raw.fontSize) ? { fontSize: Math.min(22, Math.max(14, Math.round(raw.fontSize))) } : {}),
  }
}

export function readFontSettings(storage: StorageLike | undefined = availableStorage()): FontSettings {
  try {
    return validateFontSettings(JSON.parse(storage?.getItem(fontSettingsKey) ?? 'null'))
  } catch {
    return { ...defaultFontSettings }
  }
}

export function writeFontSettings(value: FontSettings, storage: StorageLike | undefined = availableStorage()): FontSettings {
  const next = validateFontSettings(value)
  try { storage?.setItem(fontSettingsKey, JSON.stringify(next)) } catch { /* Apply the preference for this session. */ }
  return next
}

export function applyFontSettings(value: FontSettings, root: HTMLElement = document.documentElement) {
  const settings = validateFontSettings(value)
  root.style.setProperty('--font-ui', uiFontStacks[settings.ui])
  root.style.setProperty('--font-display', uiFontStacks[settings.ui])
  root.style.setProperty('--font-reading', readingFontStacks[settings.reading])
  root.style.setProperty('--font-reading-size', `${settings.fontSize ?? Number.parseInt(readingSizes[settings.size], 10)}px`)
  root.style.setProperty('--font-reading-line-height', readingLineHeights[settings.lineHeight])
  root.dataset.fontUi = settings.ui
  root.dataset.fontReading = settings.reading
  root.dataset.fontReadingSize = settings.size
  root.dataset.fontReadingLineHeight = settings.lineHeight
}

const preference = createAppearancePreference({ key: 'font_settings', storageKey: fontSettingsKey, validate: validateFontSettings, apply: applyFontSettings })
export const readInitialFontSettings = preference.read

export function useFontSettings() {
  const { value: settings, change } = preference.usePreference()
  const reset = () => change(defaultFontSettings)
  return { settings, change, reset }
}
