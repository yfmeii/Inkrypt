import type { D1Database } from '../cloudflare'
import {
  createNote,
  createNoteConflict,
  getNoteVersion,
  updateNoteVersion,
} from '../repositories/notes'

export type SaveNoteInput = {
  id: string
  encrypted_data: string
  iv: string
  base_version: number
  is_deleted?: boolean
}

export type SaveNotesResult = {
  saved: Array<{ id: string; version: number; updated_at: number }>
  conflicts: string[]
}

type SaveNotesOptions = {
  db: D1Database
  userId: string
  deviceName: string | null
  notes: SaveNoteInput[]
  now?: () => number
  createConflictId?: () => string
}

export async function saveNotes(options: SaveNotesOptions): Promise<SaveNotesResult> {
  const now = options.now ?? Date.now
  const createConflictId = options.createConflictId ?? crypto.randomUUID
  const saved: SaveNotesResult['saved'] = []
  const conflicts: string[] = []

  for (const note of options.notes) {
    const ts = now()
    const existingVersion = await getNoteVersion(options.db, note.id, options.userId)

    if (existingVersion === null) {
      await createNote(options.db, {
        id: note.id,
        userId: options.userId,
        updatedAt: ts,
        isDeleted: note.is_deleted ?? false,
        encryptedData: note.encrypted_data,
        iv: note.iv,
      })

      saved.push({ id: note.id, version: 1, updated_at: ts })
      continue
    }

    if (existingVersion !== note.base_version) {
      await createNoteConflict(options.db, {
        id: createConflictId(),
        noteId: note.id,
        userId: options.userId,
        encryptedData: note.encrypted_data,
        iv: note.iv,
        deviceName: options.deviceName,
        createdAt: ts,
      })
      conflicts.push(note.id)
      continue
    }

    const newVersion = existingVersion + 1
    const updated = await updateNoteVersion(options.db, {
      id: note.id,
      userId: options.userId,
      currentVersion: existingVersion,
      newVersion,
      updatedAt: ts,
      isDeleted: note.is_deleted ?? false,
      encryptedData: note.encrypted_data,
      iv: note.iv,
    })

    if (!updated) {
      await createNoteConflict(options.db, {
        id: createConflictId(),
        noteId: note.id,
        userId: options.userId,
        encryptedData: note.encrypted_data,
        iv: note.iv,
        deviceName: options.deviceName,
        createdAt: ts,
      })
      conflicts.push(note.id)
      continue
    }

    saved.push({ id: note.id, version: newVersion, updated_at: ts })
  }

  return { saved, conflicts }
}
