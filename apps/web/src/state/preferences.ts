import type { StateCreator } from 'zustand'
import { isValidThemeId, loadThemeCSS, type ThemeId } from '../lib/themes'
import type { InkryptState, ModeId, PreferencesSlice } from './types'

const DEFAULT_BRAND_NAME = 'Inkrypt'
const DEFAULT_THEME: ThemeId = 'default'
const DEFAULT_MODE: ModeId = 'system'

const LS_BRAND_NAME = 'inkrypt_brand_name'
const LS_THEME = 'inkrypt_theme'
const LS_COLOR_THEME = 'inkrypt_color_theme'
const LS_MODE = 'inkrypt_mode'

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeLocalStorageGetItem(key: string): string | null {
  if (!isBrowser()) return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeLocalStorageSetItem(key: string, value: string): void {
  if (!isBrowser()) return
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function normalizeThemeId(raw: string | null): ThemeId {
  if (raw && isValidThemeId(raw)) return raw
  return DEFAULT_THEME
}

function normalizeModeId(raw: string | null): ModeId {
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  return DEFAULT_MODE
}

function syncThemeColorMeta(): void {
  if (!isBrowser()) return
  const meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) return

  const styles = getComputedStyle(document.documentElement)
  const color = styles.getPropertyValue('--background').trim()

  if (!color) return
  meta.setAttribute('content', color)
}

function scheduleThemeColorSync(): void {
  if (!isBrowser()) return
  if ('requestAnimationFrame' in window) window.requestAnimationFrame(() => syncThemeColorMeta())
  else syncThemeColorMeta()
}

function getSystemPrefersDark(): boolean {
  if (!isBrowser()) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyThemeToDocument(theme: ThemeId): void {
  if (!isBrowser()) return

  loadThemeCSS(theme)

  if (theme === 'default') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
  scheduleThemeColorSync()
}

function applyModeToDocument(mode: ModeId): void {
  if (!isBrowser()) return
  const isDark = mode === 'dark' || (mode === 'system' && getSystemPrefersDark())

  if (isDark) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
  scheduleThemeColorSync()
}

export const initialTheme = normalizeThemeId(
  safeLocalStorageGetItem(LS_COLOR_THEME) ?? safeLocalStorageGetItem(LS_THEME),
)
export const initialMode = normalizeModeId(safeLocalStorageGetItem(LS_MODE))

export const createPreferencesSlice: StateCreator<
  InkryptState,
  [],
  [],
  PreferencesSlice
> = (set) => ({
  brandName: safeLocalStorageGetItem(LS_BRAND_NAME) ?? DEFAULT_BRAND_NAME,
  theme: initialTheme,
  mode: initialMode,

  setBrandName: (brandName) => {
    const trimmed = brandName.trim().slice(0, 32)
    const next = trimmed || DEFAULT_BRAND_NAME
    set({ brandName: next })
    safeLocalStorageSetItem(LS_BRAND_NAME, next)
  },

  setTheme: (theme) => {
    const normalized = normalizeThemeId(theme)
    set({ theme: normalized })
    safeLocalStorageSetItem(LS_COLOR_THEME, normalized)
    applyThemeToDocument(normalized)
  },

  setMode: (mode) => {
    set({ mode })
    safeLocalStorageSetItem(LS_MODE, mode)
    applyModeToDocument(mode)
  },
})

export function applyStoredAppearance(): void {
  if (typeof document === 'undefined') return

  const applyInitialTheme = () => {
    applyThemeToDocument(initialTheme)
    applyModeToDocument(initialMode)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyInitialTheme)
  } else {
    applyInitialTheme()
  }
}

export function bindSystemAppearanceListener(getState: () => Pick<InkryptState, 'mode'>): void {
  if (!isBrowser() || !('matchMedia' in window)) return

  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (getState().mode === 'system') {
      applyModeToDocument('system')
    }
    scheduleThemeColorSync()
  }

  if ('addEventListener' in mql) {
    mql.addEventListener('change', onChange)
  } else {
    ;(mql as MediaQueryList & { addListener: (listener: () => void) => void }).addListener(onChange)
  }
}
