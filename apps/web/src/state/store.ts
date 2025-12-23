import { create } from 'zustand'
import type { Bytes, NotePayload } from '../lib/crypto'
import { clearRememberedUnlockedSession, loadRememberedUnlockedSession, rememberUnlockedSession } from '../lib/remember'

export type DecryptedNote = {
  id: string
  version: number
  updated_at: number
  is_deleted: number
  payload: NotePayload
}

export type ThemeId = 'violet' | 'ocean' | 'emerald' | 'rose' | 'amber'

const DEFAULT_BRAND_NAME = 'Inkrypt'
const DEFAULT_THEME: ThemeId = 'ocean'

const LS_BRAND_NAME = 'inkrypt_brand_name'
const LS_THEME = 'inkrypt_theme'

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
  if (raw === 'violet' || raw === 'ocean' || raw === 'emerald' || raw === 'rose' || raw === 'amber') return raw
  return DEFAULT_THEME
}

function syncThemeColorMeta(): void {
  if (!isBrowser()) return
  const meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) return

  const styles = getComputedStyle(document.documentElement)
  const color =
    styles.getPropertyValue('--md-sys-color-surface').trim() ||
    styles.getPropertyValue('--md-sys-color-background').trim()

  if (!color) return
  meta.setAttribute('content', color)
}

function scheduleThemeColorSync(): void {
  if (!isBrowser()) return
  if ('requestAnimationFrame' in window) window.requestAnimationFrame(() => syncThemeColorMeta())
  else syncThemeColorMeta()
}

function applyThemeToDocument(theme: ThemeId): void {
  if (!isBrowser()) return
  // `violet` is the base theme (no `data-theme` attribute).
  if (theme === 'violet') {
    document.documentElement.removeAttribute('data-theme')
    scheduleThemeColorSync()
    return
  }
  document.documentElement.setAttribute('data-theme', theme)
  scheduleThemeColorSync()
}

type InkryptState = {
  masterKey: Bytes | null
  credentialId: string | null
  deviceName: string | null

  pairingPrefillSecret: string | null

  brandName: string
  theme: ThemeId

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
  hydrateRememberedSession: () => Promise<void>
  lock: () => void

  setNotes: (notes: DecryptedNote[]) => void
  upsertNote: (note: DecryptedNote) => void
  removeNote: (id: string) => void
  selectNote: (id: string | null) => void
}

export const useInkryptStore = create<InkryptState>((set, get) => ({
  masterKey: null,
  credentialId: null,
  deviceName: null,

  pairingPrefillSecret: null,

  brandName: safeLocalStorageGetItem(LS_BRAND_NAME) ?? DEFAULT_BRAND_NAME,
  theme: normalizeThemeId(safeLocalStorageGetItem(LS_THEME)),

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
    set({ theme })
    safeLocalStorageSetItem(LS_THEME, theme)
    applyThemeToDocument(theme)
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

// Apply theme ASAP on initial import
applyThemeToDocument(normalizeThemeId(safeLocalStorageGetItem(LS_THEME)))

// Keep browser UI theme-color in sync with system scheme changes
if (isBrowser() && 'matchMedia' in window) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => scheduleThemeColorSync()
  if ('addEventListener' in mql) {
    mql.addEventListener('change', onChange)
  } else {
    ;(mql as any).addListener(onChange)
  }
}
