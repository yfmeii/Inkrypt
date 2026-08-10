import { saveNoteResponseSchema } from '@inkrypt/contracts/notes'
import { putJSON } from '../../lib/api'
import { decryptNotePayload, encryptNotePayload, isLegacyNoteCiphertext, noteAad, type Bytes, type NotePayload } from '../../lib/crypto'
import { idbGetAllEncryptedNotes, idbGetDraftNote, idbUpsertEncryptedNotes } from '../../lib/idb'
import type { DecryptedNote } from '../../state/store'
import { toStoredPayload } from './lifecycle.shared'

export async function migrateLegacyNotesInBackground(args: {
  masterKey: Bytes | null
  selectedNoteId: string | null
  dirty: boolean
  selectedBaseline: NotePayload | null
  currentRunId: number
  getActiveRunId: () => number
  rememberNoteSearchText: (noteId: string, payload: NotePayload) => void
  upsertNote: (note: DecryptedNote) => void
  onSelectedMigrated: (payload: NotePayload, version: number) => void
}): Promise<void> {
  if (!args.masterKey) return

  const encryptedNotes = await idbGetAllEncryptedNotes()
  const candidates = encryptedNotes.filter((note) => !note.is_deleted && isLegacyNoteCiphertext(note.encrypted_data))
  if (candidates.length === 0) return

  let migrated = 0
  const maxAutoMigrations = 20

  for (const note of candidates) {
    if (args.getActiveRunId() !== args.currentRunId) return
    if (!args.masterKey) return
    if (migrated >= maxAutoMigrations) return

    if (note.id === args.selectedNoteId && args.dirty) continue

    const draft = await idbGetDraftNote(note.id)
    if (draft) continue

    let payload: NotePayload
    try {
      payload = await decryptNotePayload(args.masterKey, note.encrypted_data, note.data_iv, noteAad(note.id))
    } catch {
      continue
    }
    const encrypted = await encryptNotePayload(args.masterKey, payload, noteAad(note.id))
    if (isLegacyNoteCiphertext(encrypted.encrypted_data)) continue

    let response
    try {
      response = await putJSON(`/api/notes/${encodeURIComponent(note.id)}`, {
        encrypted_data: encrypted.encrypted_data,
        data_iv: encrypted.iv,
        base_version: note.version,
        is_deleted: false,
      }, saveNoteResponseSchema)
    } catch {
      continue
    }

    const saved = response.note

    migrated += 1
    await idbUpsertEncryptedNotes([
      {
        id: note.id,
        version: saved.version,
        change_seq: saved.change_seq,
        updated_at: saved.updated_at,
        is_deleted: 0,
        encrypted_data: encrypted.encrypted_data,
        data_iv: encrypted.iv,
      },
    ])

    args.rememberNoteSearchText(note.id, payload)
    args.upsertNote({
      id: note.id,
      version: saved.version,
      updated_at: saved.updated_at,
      is_deleted: 0,
      payload: toStoredPayload(payload),
    })

    if (note.id === args.selectedNoteId && !args.dirty && args.selectedBaseline) {
      args.onSelectedMigrated(payload, saved.version)
    }

    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}
