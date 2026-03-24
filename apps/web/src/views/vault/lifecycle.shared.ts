import type { NotePayload } from '../../lib/crypto'

export type NotesGetResponse = { notes: import('../../lib/idb').EncryptedNoteRecord[] }

export type NotesPostResponse = {
  saved: Array<{ id: string; version: number; updated_at: number }>
  conflicts: string[]
}

export type SyncSavedRecord = { version: number; updated_at: number }

const NOTE_CONTENT_STORE_LIMIT = 20_000

export function clampNoteContentForStore(content: string): string {
  if (content.length <= NOTE_CONTENT_STORE_LIMIT) return content
  return content.slice(0, NOTE_CONTENT_STORE_LIMIT)
}

export function toStoredPayload(payload: NotePayload): NotePayload {
  return {
    ...payload,
    content: clampNoteContentForStore(payload.content),
    attachments: {},
  }
}
