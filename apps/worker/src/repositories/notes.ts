import type { D1Database } from '../cloudflare'

export type DbNote = {
  id: string
  user_id: string
  version: number
  change_seq: number
  updated_at: number
  is_deleted: number
  encrypted_data: string
  data_iv: string
}

export type PersistedNoteRecord = Pick<
  DbNote,
  'id' | 'version' | 'change_seq' | 'updated_at' | 'is_deleted' | 'encrypted_data' | 'data_iv'
>

export type SaveNoteRecordInput = {
  id: string
  userId: string
  baseVersion: number
  updatedAt: number
  isDeleted: boolean
  encryptedData: string
  iv: string
}

export type SaveNoteRecordResult = {
  saved: boolean
  current: PersistedNoteRecord | null
}

export async function getNoteChangeHead(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare('SELECT note_change_seq FROM users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<{ note_change_seq: number }>()

  return row?.note_change_seq ?? 0
}

export async function listNoteChanges(
  db: D1Database,
  userId: string,
  after: number,
  through: number,
  limit: number,
): Promise<PersistedNoteRecord[]> {
  const result = await db
    .prepare(
      `SELECT id, version, change_seq, updated_at, is_deleted, encrypted_data, data_iv
       FROM notes
       WHERE user_id = ?
         AND change_seq > ?
         AND change_seq <= ?
       ORDER BY change_seq ASC
       LIMIT ?`,
    )
    .bind(userId, after, through, limit)
    .all<PersistedNoteRecord>()

  return result.results ?? []
}

function createSaveStatement(db: D1Database, input: SaveNoteRecordInput) {
  if (input.baseVersion === 0) {
    return db
      .prepare(
        `INSERT INTO notes (
          id, user_id, version, change_seq, updated_at,
          is_deleted, encrypted_data, data_iv
        ) VALUES (?, ?, 1, 0, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
        RETURNING id`,
      )
      .bind(
        input.id,
        input.userId,
        input.updatedAt,
        input.isDeleted ? 1 : 0,
        input.encryptedData,
        input.iv,
      )
  }

  return db
    .prepare(
      `UPDATE notes
       SET encrypted_data = ?,
           data_iv = ?,
           is_deleted = ?,
           version = version + 1,
           updated_at = ?
       WHERE id = ?
         AND user_id = ?
         AND version = ?
       RETURNING id`,
    )
    .bind(
      input.encryptedData,
      input.iv,
      input.isDeleted ? 1 : 0,
      input.updatedAt,
      input.id,
      input.userId,
      input.baseVersion,
    )
}

function createSelectStatement(db: D1Database, input: Pick<SaveNoteRecordInput, 'id' | 'userId'>) {
  return db
    .prepare(
      `SELECT id, version, change_seq, updated_at, is_deleted, encrypted_data, data_iv
       FROM notes
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
    )
    .bind(input.id, input.userId)
}

export async function saveNoteRecord(
  db: D1Database,
  input: SaveNoteRecordInput,
): Promise<SaveNoteRecordResult> {
  const results = await db.batch<PersistedNoteRecord>([
    createSaveStatement(db, input),
    createSelectStatement(db, input),
  ])

  // D1 may include writes performed by change-sequence triggers in
  // meta.changes. RETURNING reports whether the guarded INSERT/UPDATE itself
  // matched a row, so it remains a reliable CAS success signal.
  const saved = (results[0]?.results?.length ?? 0) === 1
  const current = results[1]?.results?.[0] ?? null
  return { saved, current }
}

export async function saveNoteRecords(
  db: D1Database,
  inputs: SaveNoteRecordInput[],
): Promise<SaveNoteRecordResult[]> {
  const statements = inputs.flatMap((input) => [
    createSaveStatement(db, input),
    createSelectStatement(db, input),
  ])
  const results = await db.batch<PersistedNoteRecord>(statements)

  return inputs.map((_, index) => {
    const saveResult = results[index * 2]
    const selectResult = results[index * 2 + 1]
    return {
      saved: (saveResult?.results?.length ?? 0) === 1,
      current: selectResult?.results?.[0] ?? null,
    }
  })
}

export async function getNoteById(
  db: D1Database,
  noteId: string,
  userId: string,
): Promise<PersistedNoteRecord | null> {
  const note = await db
    .prepare(
      'SELECT id, version, change_seq, updated_at, is_deleted, encrypted_data, data_iv FROM notes WHERE id = ? AND user_id = ? LIMIT 1',
    )
    .bind(noteId, userId)
    .first<PersistedNoteRecord>()

  return note ?? null
}
