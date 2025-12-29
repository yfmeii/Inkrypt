import { create } from 'zustand'
import type { Bytes, NotePayload } from '../lib/crypto'
import { clearRememberedUnlockedSession, loadRememberedUnlockedSession, rememberUnlockedSession } from '../lib/remember'
import { isValidThemeId, loadThemeCSS, type ThemeId } from '../lib/themes'

export type DecryptedNote = {
  id: string
  version: number
  updated_at: number
  is_deleted: number
  payload: NotePayload
}

// Re-export ThemeId from themes module for external use
export type { ThemeId } from '../lib/themes'
export type ModeId = 'light' | 'dark' | 'system'

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
  
  // Load theme CSS dynamically
  loadThemeCSS(theme)
  
  // Set data-theme attribute for any theme-specific selectors
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

type InkryptState = {
  masterKey: Bytes | null
  credentialId: string | null
  deviceName: string | null

  pairingPrefillSecret: string | null

  brandName: string
  theme: ThemeId
  mode: ModeId

  notes: DecryptedNote[]
  selectedNoteId: string | null

  setSession: (args: {
    masterKey: Bytes
    credentialId?: string | null
    deviceName?: string | null
    remember?: boolean
  }) => void
  setDeviceName: (deviceName: string | null) => void
  setPairingPrefillSecret: (secret: string | null) => void
  consumePairingPrefillSecret: () => string | null
  setBrandName: (brandName: string) => void
  setTheme: (theme: ThemeId) => void
  setMode: (mode: ModeId) => void
  hydrateRememberedSession: () => Promise<void>
  lock: () => void

  setNotes: (notes: DecryptedNote[]) => void
  upsertNote: (note: DecryptedNote) => void
  removeNote: (id: string) => void
  selectNote: (id: string | null) => void
}

// Initialize theme and mode from storage
const initialTheme = normalizeThemeId(
  safeLocalStorageGetItem(LS_COLOR_THEME) ?? safeLocalStorageGetItem(LS_THEME)
)
const initialMode = normalizeModeId(safeLocalStorageGetItem(LS_MODE))

export const useInkryptStore = create<InkryptState>((set, get) => ({
  masterKey: null,
  credentialId: null,
  deviceName: null,

  pairingPrefillSecret: null,

  brandName: safeLocalStorageGetItem(LS_BRAND_NAME) ?? DEFAULT_BRAND_NAME,
  theme: initialTheme,
  mode: initialMode,

  notes: [],
  selectedNoteId: null,

  setSession: ({ masterKey, credentialId, deviceName, remember }) => {
    set({
      masterKey,
      credentialId: credentialId ?? null,
      deviceName: deviceName ?? null,
    })

    if (remember) {
      void rememberUnlockedSession({
        masterKey,
        credentialId: credentialId ?? null,
        deviceName: deviceName ?? null,
      }).catch(() => null)
    } else {
      void clearRememberedUnlockedSession().catch(() => null)
    }
  },

  setDeviceName: (deviceName) => set({ deviceName }),

  setPairingPrefillSecret: (secret) => set({ pairingPrefillSecret: secret }),

  consumePairingPrefillSecret: () => {
    const secret = get().pairingPrefillSecret
    if (!secret) return null
    set({ pairingPrefillSecret: null })
    return secret
  },

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

  hydrateRememberedSession: async () => {
    const state = get()
    if (state.masterKey) return
    try {
      const remembered = await loadRememberedUnlockedSession()
      if (!remembered) return

      set({
        masterKey: remembered.masterKey,
        credentialId: remembered.credentialId,
        deviceName: remembered.deviceName,
      })
    } catch {
      void clearRememberedUnlockedSession().catch(() => null)
    }
  },

  lock: () => {
    void clearRememberedUnlockedSession().catch(() => null)
    set({
      masterKey: null,
      credentialId: null,
      deviceName: null,
      notes: [],
      selectedNoteId: null,
    })
  },

  setNotes: (notes) =>
    set((s) => ({
      notes,
      selectedNoteId:
        s.selectedNoteId && notes.some((n) => n.id === s.selectedNoteId) ? s.selectedNoteId : null,
    })),

  upsertNote: (note) =>
    set((s) => {
      const idx = s.notes.findIndex((n) => n.id === note.id)
      const next = idx >= 0 ? [...s.notes] : [note, ...s.notes]
      if (idx >= 0) next[idx] = note
      return { notes: next }
    }),

  removeNote: (id) =>
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      selectedNoteId: s.selectedNoteId === id ? null : s.selectedNoteId,
    })),

  selectNote: (id) => {
    const state = get()
    if (id && !state.notes.some((n) => n.id === id)) return
    set({ selectedNoteId: id })
  },
}))

// 在模块导入时立即应用主题和模式，避免页面闪烁
if (typeof document !== 'undefined') {
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

// Keep browser UI theme-color in sync with system scheme changes
if (isBrowser() && 'matchMedia' in window) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    // Re-apply mode when system preference changes (for 'system' mode)
    const currentMode = useInkryptStore.getState().mode
    if (currentMode === 'system') {
      applyModeToDocument('system')
    }
    scheduleThemeColorSync()
  }
  if ('addEventListener' in mql) {
    mql.addEventListener('change', onChange)
  } else {
    ;(mql as any).addListener(onChange)
  }
}
