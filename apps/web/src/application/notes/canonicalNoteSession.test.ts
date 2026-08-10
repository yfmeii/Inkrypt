import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { CanonicalNoteSession } from './canonicalNoteSession'

function createNote(id: string, version: number) {
  return {
    id,
    version,
    updated_at: 100,
    is_deleted: 0 as const,
    payload: {
      meta: {
        title: 'Title',
        created_at: 1,
        tags: [],
        is_favorite: false,
      },
      content: '',
      attachments: {},
    },
  }
}

const draft = {
  title: 'Draft',
  tags: ['tag'],
  is_favorite: true,
  attachments: {},
  content: 'Content',
  createdAt: 1,
}

describe('CanonicalNoteSession', () => {
  it('builds a save context from one active note', () => {
    const session = new CanonicalNoteSession()
    const document = new Y.Doc()
    session.activate(createNote('note-1', 3))
    session.updateDraft('note-1', draft)
    session.attachDocument('note-1', document)

    expect(session.getSaveContext('note-1')).toEqual({
      noteId: 'note-1',
      baseVersion: 3,
      draft,
      document,
    })
  })

  it('prefers the latest observed remote version', () => {
    const session = new CanonicalNoteSession()
    session.activate(createNote('note-1', 3))
    session.updateDraft('note-1', draft)
    session.attachDocument('note-1', new Y.Doc())
    session.recordRemoteVersion('note-1', 8)

    expect(session.getSaveContext('note-1')?.baseVersion).toBe(8)
  })

  it('rejects stale updates after switching notes', () => {
    const session = new CanonicalNoteSession()
    session.activate(createNote('note-1', 3))
    session.updateDraft('note-1', draft)
    session.attachDocument('note-1', new Y.Doc())
    session.activate(createNote('note-2', 1))

    expect(session.recordRemoteVersion('note-1', 9)).toBe(false)
    expect(session.getSaveContext('note-1')).toBeNull()
    expect(session.getSaveContext('note-2')).toBeNull()
  })
})
