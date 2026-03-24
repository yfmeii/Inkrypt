import { beforeEach, describe, expect, test, vi } from 'vitest'

import { saveNotes } from './notes'
import {
  createNote,
  createNoteConflict,
  getNoteVersion,
  updateNoteVersion,
} from '../repositories/notes'

vi.mock('../repositories/notes', () => ({
  createNote: vi.fn(),
  createNoteConflict: vi.fn(),
  getNoteVersion: vi.fn(),
  updateNoteVersion: vi.fn(),
}))

const createNoteMock = vi.mocked(createNote)
const createNoteConflictMock = vi.mocked(createNoteConflict)
const getNoteVersionMock = vi.mocked(getNoteVersion)
const updateNoteVersionMock = vi.mocked(updateNoteVersion)

describe('saveNotes', () => {
  const db = {} as never

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('creates a new note at version 1 when none exists', async () => {
    getNoteVersionMock.mockResolvedValueOnce(null)

    const result = await saveNotes({
      db,
      userId: 'user-1',
      deviceName: 'Phone',
      now: () => 101,
      notes: [
        {
          id: 'note-1',
          encrypted_data: 'ciphertext',
          iv: 'iv-1',
          base_version: 0,
        },
      ],
    })

    expect(createNoteMock).toHaveBeenCalledWith(db, {
      id: 'note-1',
      userId: 'user-1',
      updatedAt: 101,
      isDeleted: false,
      encryptedData: 'ciphertext',
      iv: 'iv-1',
    })
    expect(updateNoteVersionMock).not.toHaveBeenCalled()
    expect(createNoteConflictMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      saved: [{ id: 'note-1', version: 1, updated_at: 101 }],
      conflicts: [],
    })
  })

  test('updates a note when base_version matches the stored version', async () => {
    getNoteVersionMock.mockResolvedValueOnce(4)
    updateNoteVersionMock.mockResolvedValueOnce(true)

    const result = await saveNotes({
      db,
      userId: 'user-1',
      deviceName: 'Laptop',
      now: () => 202,
      notes: [
        {
          id: 'note-2',
          encrypted_data: 'next-ciphertext',
          iv: 'iv-2',
          base_version: 4,
          is_deleted: true,
        },
      ],
    })

    expect(updateNoteVersionMock).toHaveBeenCalledWith(db, {
      id: 'note-2',
      userId: 'user-1',
      currentVersion: 4,
      newVersion: 5,
      updatedAt: 202,
      isDeleted: true,
      encryptedData: 'next-ciphertext',
      iv: 'iv-2',
    })
    expect(createNoteMock).not.toHaveBeenCalled()
    expect(createNoteConflictMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      saved: [{ id: 'note-2', version: 5, updated_at: 202 }],
      conflicts: [],
    })
  })

  test('creates a conflict when base_version is stale', async () => {
    getNoteVersionMock.mockResolvedValueOnce(7)

    const result = await saveNotes({
      db,
      userId: 'user-1',
      deviceName: 'Tablet',
      now: () => 303,
      createConflictId: () => 'conflict-1',
      notes: [
        {
          id: 'note-3',
          encrypted_data: 'stale-ciphertext',
          iv: 'iv-3',
          base_version: 6,
        },
      ],
    })

    expect(updateNoteVersionMock).not.toHaveBeenCalled()
    expect(createNoteConflictMock).toHaveBeenCalledWith(db, {
      id: 'conflict-1',
      noteId: 'note-3',
      userId: 'user-1',
      encryptedData: 'stale-ciphertext',
      iv: 'iv-3',
      deviceName: 'Tablet',
      createdAt: 303,
    })
    expect(result).toEqual({
      saved: [],
      conflicts: ['note-3'],
    })
  })

  test('creates a conflict when the optimistic update loses the race', async () => {
    getNoteVersionMock.mockResolvedValueOnce(9)
    updateNoteVersionMock.mockResolvedValueOnce(false)

    const result = await saveNotes({
      db,
      userId: 'user-1',
      deviceName: null,
      now: () => 404,
      createConflictId: () => 'conflict-2',
      notes: [
        {
          id: 'note-4',
          encrypted_data: 'raced-ciphertext',
          iv: 'iv-4',
          base_version: 9,
        },
      ],
    })

    expect(updateNoteVersionMock).toHaveBeenCalledWith(db, {
      id: 'note-4',
      userId: 'user-1',
      currentVersion: 9,
      newVersion: 10,
      updatedAt: 404,
      isDeleted: false,
      encryptedData: 'raced-ciphertext',
      iv: 'iv-4',
    })
    expect(createNoteConflictMock).toHaveBeenCalledWith(db, {
      id: 'conflict-2',
      noteId: 'note-4',
      userId: 'user-1',
      encryptedData: 'raced-ciphertext',
      iv: 'iv-4',
      deviceName: null,
      createdAt: 404,
    })
    expect(result).toEqual({
      saved: [],
      conflicts: ['note-4'],
    })
  })
})
