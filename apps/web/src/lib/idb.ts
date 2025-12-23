import { type DBSchema, openDB } from 'idb'

export type EncryptedNoteRecord = {
  id: string
  version: number
  updated_at: number
  is_deleted: number
  encrypted_data: string
  data_iv: string
}

type MetaRecord = {
  key: string
  value: unknown
}

interface InkryptDB extends DBSchema {
  notes: {
    key: string
    value: EncryptedNoteRecord
    indexes: { 'by-updated': number }
  }
  meta: {
    key: string
    value: MetaRecord
  }
}

const DB_NAME = 'inkrypt'
const DB_VERSION = 1

const dbPromise = openDB<InkryptDB>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    const notes = db.createObjectStore('notes', { keyPath: 'id' })
    notes.createIndex('by-updated', 'updated_at')
    db.createObjectStore('meta', { keyPath: 'key' })
  },
})

export async function idbGetLastSync(): Promise<number> {
  const db = await dbPromise
  const row = await db.get('meta', 'last_sync')
  const value = row?.value
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export async function idbSetLastSync(ts: number): Promise<void> {
  const db = await dbPromise
  await db.put('meta', { key: 'last_sync', value: ts })
}

export async function idbUpsertEncryptedNotes(notes: EncryptedNoteRecord[]): Promise<void> {
  const db = await dbPromise
  const tx = db.transaction('notes', 'readwrite')
  for (const note of notes) {
    await tx.store.put(note)
  }
  await tx.done
}

export async function idbGetAllEncryptedNotes(): Promise<EncryptedNoteRecord[]> {
  const db = await dbPromise
  return await db.getAll('notes')
}

export async function idbGetEncryptedNote(id: string): Promise<EncryptedNoteRecord | undefined> {
  const db = await dbPromise
  return await db.get('notes', id)
}

export async function idbClearAll(): Promise<void> {
  const db = await dbPromise
  const tx = db.transaction(['notes', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('notes').clear(), tx.objectStore('meta').clear(), tx.done])
}

export async function idbGetMeta(key: string): Promise<unknown | undefined> {
  const db = await dbPromise
  const row = await db.get('meta', key)
  return row?.value
}

export async function idbSetMeta(key: string, value: unknown): Promise<void> {
  const db = await dbPromise
  await db.put('meta', { key, value })
}

export async function idbDeleteMeta(key: string): Promise<void> {
  const db = await dbPromise
  await db.delete('meta', key)
}

export type DraftNoteRecordV1 = {
  v: 1
  note_id: string
  base_version: number
  encrypted_data: string
  data_iv: string
  saved_at: number
}

const DRAFT_NOTE_PREFIX = 'draft_note:'

export async function idbGetDraftNote(noteId: string): Promise<DraftNoteRecordV1 | null> {
  const raw = await idbGetMeta(`${DRAFT_NOTE_PREFIX}${noteId}`)
  if (!raw || typeof raw !== 'object') return null

  const v = (raw as any).v
  const note_id = (raw as any).note_id
  const base_version = (raw as any).base_version
  const encrypted_data = (raw as any).encrypted_data
  const data_iv = (raw as any).data_iv
  const saved_at = (raw as any).saved_at

  if (v !== 1) return null
  if (note_id !== noteId) return null
  if (typeof base_version !== 'number' || !Number.isFinite(base_version) || base_version < 0) return null
  if (typeof encrypted_data !== 'string' || !encrypted_data) return null
  if (typeof data_iv !== 'string' || !data_iv) return null
  if (typeof saved_at !== 'number' || !Number.isFinite(saved_at) || saved_at <= 0) return null

  return raw as DraftNoteRecordV1
}

export async function idbSetDraftNote(record: DraftNoteRecordV1): Promise<void> {
  await idbSetMeta(`${DRAFT_NOTE_PREFIX}${record.note_id}`, record)
}

export async function idbDeleteDraftNote(noteId: string): Promise<void> {
  await idbDeleteMeta(`${DRAFT_NOTE_PREFIX}${noteId}`)
}
