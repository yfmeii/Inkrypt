import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveNote, saveNoteBatch } from './notes'
import { saveNoteRecord, saveNoteRecords } from '../repositories/notes'

vi.mock('../repositories/notes', () => ({
  saveNoteRecord: vi.fn(),
  saveNoteRecords: vi.fn(),
}))

const persistedNote = {
  id: 'note-1', version: 2, change_seq: 3, updated_at: 100,
  is_deleted: 0, encrypted_data: 'ciphertext', data_iv: 'iv',
}

beforeEach(() => vi.clearAllMocks())

describe('note save outcomes', () => {
  it('returns the full authoritative saved record', async () => {
    vi.mocked(saveNoteRecord).mockResolvedValue({ saved: true, current: persistedNote })
    await expect(saveNote({
      db: {} as never,
      userId: 'user-1',
      now: () => 100,
      note: {
        id: 'note-1', base_version: 1, encrypted_data: 'ciphertext', iv: 'iv',
      },
    })).resolves.toEqual({ status: 'saved', note: persistedNote })
  })

  it('returns the authoritative current record on conflict', async () => {
    vi.mocked(saveNoteRecord).mockResolvedValue({ saved: false, current: persistedNote })
    await expect(saveNote({
      db: {} as never,
      userId: 'user-1',
      note: {
        id: 'note-1', base_version: 1, encrypted_data: 'stale', iv: 'stale-iv',
      },
    })).resolves.toEqual({ status: 'conflict', current: persistedNote })
  })

  it('preserves per-item saved and conflict outcomes in a batch', async () => {
    vi.mocked(saveNoteRecords).mockResolvedValue([
      { saved: true, current: persistedNote },
      { saved: false, current: null },
    ])
    await expect(saveNoteBatch({
      db: {} as never,
      userId: 'user-1',
      now: () => 100,
      notes: [
        { id: 'note-1', base_version: 1, encrypted_data: 'ciphertext', iv: 'iv' },
        { id: 'note-2', base_version: 0, encrypted_data: 'second', iv: 'second-iv' },
      ],
    })).resolves.toEqual([
      { id: 'note-1', outcome: { status: 'saved', note: persistedNote } },
      { id: 'note-2', outcome: { status: 'conflict', current: null } },
    ])
  })
})
