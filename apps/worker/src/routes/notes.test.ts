import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../env'

vi.mock('../middleware/requireAuth', () => ({
  requireAuth: async (context: any, next: () => Promise<void>) => {
    const userId = context.req.header('x-user-id')
    if (!userId) return context.json({ error: 'UNAUTHORIZED' }, 401)
    context.set('userId', userId)
    await next()
  },
}))

vi.mock('../domain/notes', () => ({
  saveNote: vi.fn(),
  saveNoteBatch: vi.fn(),
}))

vi.mock('../repositories/notes', () => ({
  getNoteById: vi.fn(),
  getNoteChangeHead: vi.fn(),
  listNoteChanges: vi.fn(),
}))

import { saveNote, saveNoteBatch } from '../domain/notes'
import { getNoteById, getNoteChangeHead, listNoteChanges } from '../repositories/notes'
import { notesRoutes } from './notes'

const noteId = '11111111-1111-4111-8111-111111111111'
const persistedNote = {
  id: noteId,
  version: 2,
  change_seq: 4,
  updated_at: 100,
  is_deleted: 0,
  encrypted_data: 'ciphertext',
  data_iv: 'initialization-vector',
}

const env = { DB: {}, RATE_LIMITER: {} } as AppEnv['Bindings']

function createApp() {
  const app = new Hono<AppEnv>()
  app.route('/api', notesRoutes)
  return app
}

beforeEach(() => vi.clearAllMocks())

describe('notes v2 routes', () => {
  it('lists an opaque high-watermark change page', async () => {
    vi.mocked(getNoteChangeHead).mockResolvedValue(4)
    vi.mocked(listNoteChanges).mockResolvedValue([persistedNote])

    const response = await createApp().request('/api/notes/changes?limit=20', {
      headers: { 'x-user-id': 'user-1' },
    }, env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      notes: [{ ...persistedNote, change_seq: '4', is_deleted: false }],
      has_more: false,
    })
    expect(listNoteChanges).toHaveBeenCalledWith(env.DB, 'user-1', 0, 4, 21)
  })

  it('returns one authoritative encrypted note', async () => {
    vi.mocked(getNoteById).mockResolvedValue(persistedNote)
    const response = await createApp().request(`/api/notes/${noteId}`, {
      headers: { 'x-user-id': 'user-1' },
    }, env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      note: { ...persistedNote, change_seq: '4', is_deleted: false },
    })
  })

  it('returns the authoritative current note on a CAS conflict', async () => {
    vi.mocked(saveNote).mockResolvedValue({ status: 'conflict', current: persistedNote })
    const response = await createApp().request(`/api/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-user-id': 'user-1' },
      body: JSON.stringify({
        base_version: 1,
        encrypted_data: 'new-ciphertext',
        data_iv: 'new-initialization-vector',
        is_deleted: false,
      }),
    }, env)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'VERSION_CONFLICT',
      current: { ...persistedNote, change_seq: '4', is_deleted: false },
    })
  })

  it('returns explicit per-note outcomes for batch saves', async () => {
    vi.mocked(saveNoteBatch).mockResolvedValue([
      { id: noteId, outcome: { status: 'saved', note: persistedNote } },
    ])
    const response = await createApp().request('/api/notes/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'user-1' },
      body: JSON.stringify({
        notes: [{
          id: noteId,
          base_version: 1,
          encrypted_data: 'new-ciphertext',
          data_iv: 'new-initialization-vector',
          is_deleted: false,
        }],
      }),
    }, env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      results: [{
        id: noteId,
        status: 'saved',
        note: { ...persistedNote, change_seq: '4', is_deleted: false },
      }],
    })
  })

  it('does not expose the retired timestamp and conflict endpoints', async () => {
    const app = createApp()
    const timestampResponse = await app.request('/api/notes?since=0', {
      headers: { 'x-user-id': 'user-1' },
    }, env)
    const conflictsResponse = await app.request(`/api/notes/${noteId}/conflicts`, {
      headers: { 'x-user-id': 'user-1' },
    }, env)

    expect(timestampResponse.status).toBe(404)
    expect(conflictsResponse.status).toBe(404)
  })
})
