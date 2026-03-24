import type { D1Database } from '../cloudflare'

export type DbNote = {
  id: string
  user_id: string
  version: number
  updated_at: number
  is_deleted: number
  encrypted_data: string
  data_iv: string
}

export type DbNoteConflict = {
  id: string
  note_id: string
  user_id: string
  encrypted_data: string
  data_iv: string
  device_name: string | null
  created_at: number | null
}

export type PersistedNoteRecord = Pick<
  DbNote,
  'id' | 'version' | 'updated_at' | 'is_deleted' | 'encrypted_data' | 'data_iv'
>

export type StoredNoteConflictRecord = Pick<
  DbNoteConflict,
  'id' | 'encrypted_data' | 'data_iv' | 'device_name' | 'created_at'
>

export async function listNotesSince(
  db: D1Database,
  userId: string,
  since: number,
): Promise<PersistedNoteRecord[]> {
  const res = await db
    .prepare(
      'SELECT id, version, updated_at, is_deleted, encrypted_data, data_iv FROM notes WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC',
    )
    .bind(userId, since)
    .all<PersistedNoteRecord>()

  return res.results ?? []
}

export async function getNoteVersion(
  db: D1Database,
  noteId: string,
  userId: string,
): Promise<number | null> {
  const existing = await db
    .prepare('SELECT version FROM notes WHERE id = ? AND user_id = ? LIMIT 1')
    .bind(noteId, userId)
    .first<{ version: number }>()

  return existing?.version ?? null
}

export async function createNote(
  db: D1Database,
  input: {
    id: string
    userId: string
    updatedAt: number
    isDeleted: boolean
    encryptedData: string
    iv: string
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO notes (id, user_id, version, updated_at, is_deleted, encrypted_data, data_iv) VALUES (?, ?, 1, ?, ?, ?, ?)',
    )
    .bind(
      input.id,
      input.userId,
      input.updatedAt,
      input.isDeleted ? 1 : 0,
      input.encryptedData,
      input.iv,
    )
    .run()
}

export async function updateNoteVersion(
  db: D1Database,
  input: {
    id: string
    userId: string
    currentVersion: number
    newVersion: number
    updatedAt: number
    isDeleted: boolean
    encryptedData: string
    iv: string
  },
): Promise<boolean> {
  const update = await db
    .prepare(
      'UPDATE notes SET encrypted_data = ?, data_iv = ?, is_deleted = ?, version = ?, updated_at = ? WHERE id = ? AND user_id = ? AND version = ?',
    )
    .bind(
      input.encryptedData,
      input.iv,
      input.isDeleted ? 1 : 0,
      input.newVersion,
      input.updatedAt,
      input.id,
      input.userId,
      input.currentVersion,
    )
    .run()

  return (update.meta?.changes ?? 0) > 0
}

export async function createNoteConflict(
  db: D1Database,
  input: {
    id: string
    noteId: string
    userId: string
    encryptedData: string
    iv: string
    deviceName: string | null
    createdAt: number
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO note_conflicts (id, note_id, user_id, encrypted_data, data_iv, device_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      input.id,
      input.noteId,
      input.userId,
      input.encryptedData,
      input.iv,
      input.deviceName,
      input.createdAt,
    )
    .run()
}

export async function getNoteById(
  db: D1Database,
  noteId: string,
  userId: string,
): Promise<PersistedNoteRecord | null> {
  const note = await db
    .prepare(
      'SELECT id, version, updated_at, is_deleted, encrypted_data, data_iv FROM notes WHERE id = ? AND user_id = ? LIMIT 1',
    )
    .bind(noteId, userId)
    .first<PersistedNoteRecord>()

  return note ?? null
}

export async function listNoteConflicts(
  db: D1Database,
  noteId: string,
  userId: string,
): Promise<StoredNoteConflictRecord[]> {
  const conflicts = await db
    .prepare(
      'SELECT id, encrypted_data, data_iv, device_name, created_at FROM note_conflicts WHERE note_id = ? AND user_id = ? ORDER BY created_at ASC',
    )
    .bind(noteId, userId)
    .all<StoredNoteConflictRecord>()

  return conflicts.results ?? []
}

export async function deleteNoteConflicts(
  db: D1Database,
  noteId: string,
  userId: string,
): Promise<void> {
  await db.prepare('DELETE FROM note_conflicts WHERE note_id = ? AND user_id = ?').bind(noteId, userId).run()
}
