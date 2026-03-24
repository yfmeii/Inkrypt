import type { Bytes, NotePayload } from '../lib/crypto'
import type { ThemeId } from '../lib/themes'

export type { ThemeId } from '../lib/themes'

export type DecryptedNote = {
  id: string
  version: number
  updated_at: number
  is_deleted: number
  payload: NotePayload
}

export type ModeId = 'light' | 'dark' | 'system'

export type SessionSlice = {
  masterKey: Bytes | null
  credentialId: string | null
  deviceName: string | null
  pairingPrefillSecret: string | null
  setSession: (args: {
    masterKey: Bytes
    credentialId?: string | null
    deviceName?: string | null
    remember?: boolean
  }) => void
  setDeviceName: (deviceName: string | null) => void
  setPairingPrefillSecret: (secret: string | null) => void
  consumePairingPrefillSecret: () => string | null
  hydrateRememberedSession: () => Promise<void>
  lock: () => void
}

export type PreferencesSlice = {
  brandName: string
  theme: ThemeId
  mode: ModeId
  setBrandName: (brandName: string) => void
  setTheme: (theme: ThemeId) => void
  setMode: (mode: ModeId) => void
}

export type NotesSlice = {
  notes: DecryptedNote[]
  selectedNoteId: string | null
  setNotes: (notes: DecryptedNote[]) => void
  upsertNote: (note: DecryptedNote) => void
  removeNote: (id: string) => void
  selectNote: (id: string | null) => void
}

export type InkryptState = SessionSlice & PreferencesSlice & NotesSlice
