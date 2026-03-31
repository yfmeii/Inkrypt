/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  idbGetLastSync,
  idbSetLastSync,
  idbGetEncryptedNote,
  idbUpsertEncryptedNotes,
  idbClearAll,
  idbGetAllEncryptedNotes,
  idbGetMeta,
  idbSetMeta,
  idbDeleteMeta,
  idbGetDraftNote,
  idbSetDraftNote,
  idbDeleteDraftNote,
  type EncryptedNoteRecord,
  type DraftNoteRecordV1,
} from './idb'

describe('idb - last sync', () => {
  beforeEach(async () => {
    await idbClearAll()
  })

  it('returns 0 when no last_sync exists', async () => {
    const result = await idbGetLastSync()
    expect(result).toBe(0)
  })

  it('returns stored last_sync value', async () => {
    await idbSetLastSync(1700000000000)
    const result = await idbGetLastSync()
    expect(result).toBe(1700000000000)
  })

  it('returns 0 for invalid values', async () => {
    await idbSetMeta('last_sync', 'invalid')
    const result = await idbGetLastSync()
    expect(result).toBe(0)
  })

  it('returns 0 for Infinity', async () => {
    await idbSetMeta('last_sync', Infinity)
    const result = await idbGetLastSync()
    expect(result).toBe(0)
  })

  it('returns 0 for NaN', async () => {
    await idbSetMeta('last_sync', NaN)
    const result = await idbGetLastSync()
    expect(result).toBe(0)
  })
})

describe('idb - encrypted notes', () => {
  const createNote = (id: string, overrides?: Partial<EncryptedNoteRecord>): EncryptedNoteRecord => ({
    id,
    version: 1,
    updated_at: Date.now(),
    is_deleted: 0,
    encrypted_data: `encrypted_${id}`,
    data_iv: `iv_${id}`,
    ...overrides,
  })

  beforeEach(async () => {
    await idbClearAll()
  })

  it('upserts and retrieves a single note', async () => {
    const note = createNote('note-1')
    await idbUpsertEncryptedNotes([note])

    const result = await idbGetEncryptedNote('note-1')
    expect(result).toEqual(note)
  })

  it('updates existing note on upsert', async () => {
    const note1 = createNote('note-1', { version: 1 })
    const note2 = createNote('note-1', { version: 2 })

    await idbUpsertEncryptedNotes([note1])
    await idbUpsertEncryptedNotes([note2])

    const result = await idbGetEncryptedNote('note-1')
    expect(result?.version).toBe(2)
  })

  it('upserts multiple notes', async () => {
    const notes = [
      createNote('note-1'),
      createNote('note-2'),
      createNote('note-3'),
    ]
    await idbUpsertEncryptedNotes(notes)

    const result = await idbGetAllEncryptedNotes()
    expect(result).toHaveLength(3)
  })

  it('returns undefined for non-existent note', async () => {
    const result = await idbGetEncryptedNote('non-existent')
    expect(result).toBeUndefined()
  })

  it('retrieves all notes', async () => {
    const notes = [createNote('note-1'), createNote('note-2')]
    await idbUpsertEncryptedNotes(notes)

    const result = await idbGetAllEncryptedNotes()
    expect(result).toHaveLength(2)
  })
})

describe('idb - clear all', () => {
  beforeEach(async () => {
    await idbClearAll()
  })

  it('clears all notes and meta', async () => {
    await idbSetLastSync(1700000000000)
    await idbUpsertEncryptedNotes([
      { id: 'note-1', version: 1, updated_at: 1, is_deleted: 0, encrypted_data: 'data', data_iv: 'iv' },
    ])
    await idbSetMeta('custom_key', 'value')

    await idbClearAll()

    expect(await idbGetLastSync()).toBe(0)
    expect(await idbGetAllEncryptedNotes()).toHaveLength(0)
    expect(await idbGetMeta('custom_key')).toBeUndefined()
  })
})

describe('idb - meta operations', () => {
  beforeEach(async () => {
    await idbClearAll()
  })

  it('sets and gets meta value', async () => {
    await idbSetMeta('test_key', { foo: 'bar' })
    const result = await idbGetMeta('test_key')
    expect(result).toEqual({ foo: 'bar' })
  })

  it('returns undefined for non-existent key', async () => {
    const result = await idbGetMeta('non_existent')
    expect(result).toBeUndefined()
  })

  it('deletes meta key', async () => {
    await idbSetMeta('to_delete', 'value')
    await idbDeleteMeta('to_delete')
    const result = await idbGetMeta('to_delete')
    expect(result).toBeUndefined()
  })

  it('stores various value types', async () => {
    await idbSetMeta('string', 'value')
    await idbSetMeta('number', 123)
    await idbSetMeta('boolean', true)
    await idbSetMeta('object', { nested: true })
    await idbSetMeta('array', [1, 2, 3])
    await idbSetMeta('null', null)

    expect(await idbGetMeta('string')).toBe('value')
    expect(await idbGetMeta('number')).toBe(123)
    expect(await idbGetMeta('boolean')).toBe(true)
    expect(await idbGetMeta('object')).toEqual({ nested: true })
    expect(await idbGetMeta('array')).toEqual([1, 2, 3])
    expect(await idbGetMeta('null')).toBe(null)
  })
})

describe('idb - draft note operations', () => {
  const createDraftNote = (noteId: string, overrides?: Partial<DraftNoteRecordV1>): DraftNoteRecordV1 => ({
    v: 1,
    note_id: noteId,
    base_version: 1,
    encrypted_data: `draft_encrypted_${noteId}`,
    data_iv: `draft_iv_${noteId}`,
    saved_at: Date.now(),
    ...overrides,
  })

  beforeEach(async () => {
    await idbClearAll()
  })

  it('sets and retrieves draft note', async () => {
    const draft = createDraftNote('note-1')
    await idbSetDraftNote(draft)

    const result = await idbGetDraftNote('note-1')
    expect(result).toEqual(draft)
  })

  it('returns null for non-existent draft', async () => {
    const result = await idbGetDraftNote('non-existent')
    expect(result).toBeNull()
  })

  it('returns null for invalid version', async () => {
    const draft = createDraftNote('note-1', { v: 2 as any })
    await idbSetDraftNote(draft)

    const result = await idbGetDraftNote('note-1')
    expect(result).toBeNull()
  })

  it('returns null for mismatched note_id', async () => {
    const draft = createDraftNote('note-1')
    await idbSetDraftNote(draft)

    const result = await idbGetDraftNote('note-2')
    expect(result).toBeNull()
  })

  it('returns null for invalid base_version', async () => {
    const draft = createDraftNote('note-1', { base_version: -1 as any })
    await idbSetDraftNote(draft)

    const result = await idbGetDraftNote('note-1')
    expect(result).toBeNull()
  })

  it('returns null for missing fields', async () => {
    await idbSetMeta('draft_note:note-1', { v: 1 })

    const result = await idbGetDraftNote('note-1')
    expect(result).toBeNull()
  })

  it('deletes draft note', async () => {
    const draft = createDraftNote('note-1')
    await idbSetDraftNote(draft)
    await idbDeleteDraftNote('note-1')

    const result = await idbGetDraftNote('note-1')
    expect(result).toBeNull()
  })
})
