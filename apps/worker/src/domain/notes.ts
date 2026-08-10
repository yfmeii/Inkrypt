import type { D1Database } from '../cloudflare'
import {
  saveNoteRecord,
  saveNoteRecords,
  type PersistedNoteRecord,
  type SaveNoteRecordInput,
} from '../repositories/notes'

export type SaveNoteInput = {
  id: string
  encrypted_data: string
  iv: string
  base_version: number
  is_deleted?: boolean
}

export type SaveNoteOutcome =
  | { status: 'saved'; note: PersistedNoteRecord }
  | { status: 'conflict'; current: PersistedNoteRecord | null }

function toSaveRecordInput(
  userId: string,
  note: SaveNoteInput,
  updatedAt: number,
): SaveNoteRecordInput {
  return {
    id: note.id,
    userId,
    baseVersion: note.base_version,
    updatedAt,
    isDeleted: note.is_deleted ?? false,
    encryptedData: note.encrypted_data,
    iv: note.iv,
  }
}

export async function saveNote(options: {
  db: D1Database
  userId: string
  note: SaveNoteInput
  now?: () => number
}): Promise<SaveNoteOutcome> {
  const updatedAt = (options.now ?? Date.now)()
  const result = await saveNoteRecord(
    options.db,
    toSaveRecordInput(options.userId, options.note, updatedAt),
  )

  if (result.saved && result.current) {
    return { status: 'saved', note: result.current }
  }
  return { status: 'conflict', current: result.current }
}

export async function saveNoteBatch(options: {
  db: D1Database
  userId: string
  notes: SaveNoteInput[]
  now?: () => number
}): Promise<Array<{ id: string; outcome: SaveNoteOutcome }>> {
  const now = options.now ?? Date.now
  const inputs = options.notes.map((note) => toSaveRecordInput(options.userId, note, now()))
  const results = await saveNoteRecords(options.db, inputs)

  return options.notes.map((note, index) => {
    const result = results[index]
    const outcome: SaveNoteOutcome = result?.saved && result.current
      ? { status: 'saved', note: result.current }
      : { status: 'conflict', current: result?.current ?? null }
    return { id: note.id, outcome }
  })
}
