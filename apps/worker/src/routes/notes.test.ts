import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../env'

vi.mock('../middleware/requireAuth', () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    const userId = c.req.header('x-user-id')
    if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

    c.set('userId', userId)
    c.set('credentialId', c.req.header('x-credential-id') ?? undefined)
    await next()
  },
}))

vi.mock('../domain/notes', () => ({
  saveNotes: vi.fn(),
}))

vi.mock('../repositories/credentials', () => ({
  getCredentialForUser: vi.fn(),
}))

vi.mock('../repositories/notes', () => ({
  deleteNoteConflicts: vi.fn(),
  getNoteById: vi.fn(),
  listNoteConflicts: vi.fn(),
  listNotesSince: vi.fn(),
}))

import { saveNotes } from '../domain/notes'
import { getCredentialForUser } from '../repositories/credentials'
import { deleteNoteConflicts, getNoteById, listNoteConflicts, listNotesSince } from '../repositories/notes'
import { notesRoutes } from './notes'

function createApp() {
  const app = new Hono<AppEnv>()
  app.route('/api', notesRoutes)
  return app
}

const env = {
  DB: {},
  RATE_LIMITER: {},
  RP_NAME: 'Inkrypt',
  RP_ID: 'example.com',
  ORIGIN: 'https://example.com',
  CORS_ORIGIN: 'https://example.com',
  COOKIE_SAMESITE: 'Lax',
  SESSION_SECRET: 'secret',
} as AppEnv['Bindings']

beforeEach(() => {
  vi.clearAllMocks()
})

describe('notesRoutes', () => {
  it('rejects invalid since values', async () => {
    const response = await createApp().request(
      '/api/notes?since=-1',
      {
        method: 'GET',
        headers: { 'x-user-id': 'user-1' },
      },
      env,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_SINCE' })
    expect(listNotesSince).not.toHaveBeenCalled()
  })

  it('lists notes since the provided cursor', async () => {
    vi.mocked(listNotesSince).mockResolvedValueOnce([{ id: 'note-1', version: 2 } as never])

    const response = await createApp().request(
      '/api/notes?since=42',
      {
        method: 'GET',
        headers: { 'x-user-id': 'user-1' },
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ notes: [{ id: 'note-1', version: 2 }] })
    expect(listNotesSince).toHaveBeenCalledWith(env.DB, 'user-1', 42)
  })

  it('returns invalid body for malformed note payloads', async () => {
    const response = await createApp().request(
      '/api/notes',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': 'user-1',
        },
        body: JSON.stringify([{ id: 'not-a-uuid', encrypted_data: 'cipher', iv: 'iv', base_version: 0 }]),
      },
      env,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_BODY' })
    expect(saveNotes).not.toHaveBeenCalled()
  })

  it('passes credential-derived device names into note saves', async () => {
    vi.mocked(getCredentialForUser).mockResolvedValueOnce({ device_name: 'Pixel 9' } as never)
    vi.mocked(saveNotes).mockResolvedValueOnce({
      saved: [{ id: '11111111-1111-4111-8111-111111111111', version: 1, updated_at: 101 }],
      conflicts: [],
    })

    const response = await createApp().request(
      '/api/notes',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': 'user-1',
          'x-credential-id': 'cred-1',
        },
        body: JSON.stringify([
          {
            id: '11111111-1111-4111-8111-111111111111',
            encrypted_data: 'cipher',
            iv: 'iv',
            base_version: 0,
          },
        ]),
      },
      env,
    )

    expect(response.status).toBe(200)
    expect(getCredentialForUser).toHaveBeenCalledWith(env.DB, 'user-1', 'cred-1')
    expect(saveNotes).toHaveBeenCalledWith({
      db: env.DB,
      userId: 'user-1',
      deviceName: 'Pixel 9',
      notes: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          encrypted_data: 'cipher',
          iv: 'iv',
          base_version: 0,
        },
      ],
    })
  })

  it('returns 409 when saveNotes reports conflicts', async () => {
    vi.mocked(saveNotes).mockResolvedValueOnce({ saved: [], conflicts: ['note-1'] })

    const response = await createApp().request(
      '/api/notes',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': 'user-1',
        },
        body: JSON.stringify([
          {
            id: '11111111-1111-4111-8111-111111111111',
            encrypted_data: 'cipher',
            iv: 'iv',
            base_version: 1,
          },
        ]),
      },
      env,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ saved: [], conflicts: ['note-1'] })
  })

  it('returns current note plus conflicts for the requested id', async () => {
    vi.mocked(getNoteById).mockResolvedValueOnce({ id: 'note-1', version: 3 } as never)
    vi.mocked(listNoteConflicts).mockResolvedValueOnce([{ id: 'conflict-1' } as never])

    const response = await createApp().request(
      '/api/notes/note-1/conflicts',
      {
        method: 'GET',
        headers: { 'x-user-id': 'user-1' },
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      note: { id: 'note-1', version: 3 },
      conflicts: [{ id: 'conflict-1' }],
    })
  })

  it('deletes note conflicts for the authenticated user', async () => {
    const response = await createApp().request(
      '/api/notes/note-1/conflicts',
      {
        method: 'DELETE',
        headers: { 'x-user-id': 'user-1' },
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(deleteNoteConflicts).toHaveBeenCalledWith(env.DB, 'note-1', 'user-1')
  })
})
