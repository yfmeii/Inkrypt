import { beforeEach, describe, expect, it } from 'vitest'
import { createStore, type StateCreator, type StoreApi } from 'zustand/vanilla'
import { createNotesSlice } from './notes'
import type { DecryptedNote, NotesSlice } from './types'

function createNote(version: number, title: string): DecryptedNote {
  return {
    id: 'note-1',
    version,
    updated_at: version,
    is_deleted: 0,
    payload: {
      meta: {
        title,
        created_at: 1,
        tags: [],
        is_favorite: false,
      },
      content: title,
      attachments: {},
    },
  }
}

describe('notes state version watermarks', () => {
  let store: StoreApi<NotesSlice>

  beforeEach(() => {
    store = createStore<NotesSlice>()(
      createNotesSlice as unknown as StateCreator<NotesSlice>,
    )
  })

  it('ignores delayed lower-version upserts', () => {
    store.getState().upsertNote(createNote(3, 'newer'))
    store.getState().upsertNote(createNote(2, 'older'))

    expect(store.getState().notes).toEqual([createNote(3, 'newer')])
  })

  it('does not resurrect a note below its tombstone watermark', () => {
    store.getState().upsertNote(createNote(4, 'before delete'))
    store.getState().removeNote('note-1', 5)
    store.getState().upsertNote(createNote(4, 'stale response'))

    expect(store.getState().notes).toEqual([])
    expect(store.getState().noteVersionWatermarks['note-1']).toBe(5)
  })

  it('filters stale bulk loads below a tombstone watermark', () => {
    store.getState().upsertNote(createNote(4, 'before delete'))
    store.getState().removeNote('note-1', 5)
    store.getState().setNotes([createNote(4, 'stale bulk load')])

    expect(store.getState().notes).toEqual([])
  })
})
