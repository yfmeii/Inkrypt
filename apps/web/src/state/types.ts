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

export type KeyringSessionSlice = {
  masterKey: Bytes | null
  pairingPrefillSecret: string | null
  setPairingPrefillSecret: (secret: string | null) => void
  consumePairingPrefillSecret: () => string | null
  hydrateRememberedSession: () => Promise<void>
}

export type ApiSessionSlice = {
  credentialId: string | null
  deviceName: string | null
  apiSessionStatus: 'checking' | 'authenticated' | 'anonymous' | 'revoked'
  apiSessionExpiresAt: number | null
  setDeviceName: (deviceName: string | null) => void
  refreshApiSession: () => Promise<void>
  markApiSessionAnonymous: () => void
}

export type SessionCommandsSlice = {
  setSession: (args: {
    masterKey: Bytes
    credentialId?: string | null
    deviceName?: string | null
    remember?: boolean
  }) => void
  revokeSession: () => void
  lock: () => void
}

export type SessionSlice = KeyringSessionSlice & ApiSessionSlice & SessionCommandsSlice

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
  noteVersionWatermarks: Record<string, number>
  selectedNoteId: string | null
  setNotes: (notes: DecryptedNote[]) => void
  upsertNote: (note: DecryptedNote) => void
  removeNote: (id: string, version?: number) => void
  selectNote: (id: string | null) => void
}

export type InkryptState = SessionSlice & PreferencesSlice & NotesSlice
