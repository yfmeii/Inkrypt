import {
  noteChangesResponseSchema,
  saveNoteResponseSchema,
  type EncryptedNoteRecordDto,
} from '@inkrypt/contracts/notes'
import { getJSON, putJSON } from '../../lib/api'
import {
  decryptNotePayload,
  encryptNotePayload,
  noteAad,
  type Bytes,
  type NotePayload,
} from '../../lib/crypto'
import {
  idbApplyNoteChanges,
  idbGetNotesSyncCursor,
  idbUpsertEncryptedNotes,
  type EncryptedNoteRecord,
} from '../../lib/idb'
import type { DecryptedNote } from '../../state/store'
import { toStoredPayload } from './lifecycle.shared'

function toLocalEncryptedNote(note: EncryptedNoteRecordDto): EncryptedNoteRecord {
  return {
    ...note,
    is_deleted: note.is_deleted ? 1 : 0,
  }
}

export async function syncNotesFromRemote(args: {
  masterKey: Bytes | null
  selectedNoteId: string | null
  dirty: boolean
  selectedBaseline: NotePayload | null
  forgetNoteSearchText: (noteId: string) => void
  rememberNoteSearchText: (noteId: string, payload: NotePayload) => void
  removeNote: (noteId: string, version?: number) => void
  upsertNote: (note: DecryptedNote) => void
  onSelectedRemoteUpdate: (note: DecryptedNote, payload: NotePayload) => void
}): Promise<void> {
  if (!args.masterKey) return

  let cursor = await idbGetNotesSyncCursor()
  let hasMore = true

  while (hasMore) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=50` : '?limit=50'
    const response = await getJSON(`/api/notes/changes${query}`, noteChangesResponseSchema)
    const localNotes = response.notes.map(toLocalEncryptedNote)

    await idbApplyNoteChanges(localNotes, response.next_cursor)
    cursor = response.next_cursor
    hasMore = response.has_more

    for (const note of localNotes) {
      if (note.is_deleted) {
        args.forgetNoteSearchText(note.id)
        args.removeNote(note.id, note.version)
        continue
      }

      try {
        const payload = await decryptNotePayload(
          args.masterKey,
          note.encrypted_data,
          note.data_iv,
          noteAad(note.id),
        )
        const decryptedNote: DecryptedNote = {
          id: note.id,
          version: note.version,
          updated_at: note.updated_at,
          is_deleted: note.is_deleted,
          payload: toStoredPayload(payload),
        }

        args.rememberNoteSearchText(note.id, payload)
        args.upsertNote(decryptedNote)

        if (args.selectedNoteId === note.id && !args.dirty && args.selectedBaseline) {
          args.onSelectedRemoteUpdate(decryptedNote, payload)
        }
      } catch {
        // Ciphertext is already durable in IndexedDB and can be retried after re-authentication.
      }
    }
  }
}

export async function createNotePersistence(args: {
  masterKey: Bytes
  upsertNote: (note: DecryptedNote) => void
  rememberNoteSearchText: (noteId: string, payload: NotePayload) => void
}): Promise<string> {
  const id = crypto.randomUUID()
  const payload: NotePayload = {
    meta: { title: '', created_at: Date.now(), tags: [], is_favorite: false },
    content: '',
    attachments: {},
  }
  const encrypted = await encryptNotePayload(args.masterKey, payload, noteAad(id))
  const response = await putJSON(`/api/notes/${id}`, {
    encrypted_data: encrypted.encrypted_data,
    data_iv: encrypted.iv,
    base_version: 0,
    is_deleted: false,
  }, saveNoteResponseSchema)
  const localRecord = toLocalEncryptedNote(response.note)
  await idbUpsertEncryptedNotes([localRecord])

  args.upsertNote({
    id,
    version: response.note.version,
    updated_at: response.note.updated_at,
    is_deleted: 0,
    payload,
  })
  args.rememberNoteSearchText(id, payload)
  return id
}

export async function deleteNotePersistence(args: {
  masterKey: Bytes
  selected: DecryptedNote
  forgetNoteSearchText: (noteId: string) => void
  removeNote: (noteId: string, version?: number) => void
}): Promise<void> {
  const encrypted = await encryptNotePayload(
    args.masterKey,
    args.selected.payload,
    noteAad(args.selected.id),
  )
  const response = await putJSON(`/api/notes/${args.selected.id}`, {
    encrypted_data: encrypted.encrypted_data,
    data_iv: encrypted.iv,
    base_version: args.selected.version,
    is_deleted: true,
  }, saveNoteResponseSchema)

  await idbUpsertEncryptedNotes([toLocalEncryptedNote(response.note)])
  args.forgetNoteSearchText(args.selected.id)
  args.removeNote(args.selected.id, response.note.version)
}
