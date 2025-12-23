import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env'
import type { DbNote } from '../db'
import { getCredentialForUser } from '../db'
import { requireAuth } from '../middleware/requireAuth'

function nowMs(): number {
  return Date.now()
}

export const notesRoutes = new Hono<AppEnv>()

const MAX_ENCRYPTED_NOTE_B64 = 6_000_000
const MAX_IV_B64 = 128

notesRoutes.use('/notes', requireAuth)
notesRoutes.use('/notes/*', requireAuth)

notesRoutes.get('/notes', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

  const sinceRaw = c.req.query('since')
  const since = sinceRaw ? Number(sinceRaw) : 0
  if (!Number.isFinite(since) || since < 0) return c.json({ error: 'INVALID_SINCE' }, 400)

  const res = await c.env.DB.prepare(
    'SELECT id, version, updated_at, is_deleted, encrypted_data, data_iv FROM notes WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC',
  )
    .bind(userId, since)
    .all<Pick<DbNote, 'id' | 'version' | 'updated_at' | 'is_deleted' | 'encrypted_data' | 'data_iv'>>()

  return c.json({ notes: res.results ?? [] }, 200)
})

notesRoutes.post('/notes', async (c) => {
  const userId = c.get('userId')
  const credentialId = c.get('credentialId')
  if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

  const body = z
    .array(
      z.object({
        id: z.string().uuid(),
        encrypted_data: z.string().min(1).max(MAX_ENCRYPTED_NOTE_B64),
        iv: z.string().min(1).max(MAX_IV_B64),
        base_version: z.number().int().nonnegative(),
        is_deleted: z.boolean().optional(),
      }),
    )
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  let deviceName: string | null = null
  if (credentialId) {
    const cred = await getCredentialForUser(c.env.DB, userId, credentialId)
    deviceName = cred?.device_name ?? null
  }

  const saved: Array<{ id: string; version: number; updated_at: number }> = []
  const conflicts: string[] = []

  for (const note of body.data) {
    const ts = nowMs()
    const existing = await c.env.DB.prepare(
      'SELECT version FROM notes WHERE id = ? AND user_id = ? LIMIT 1',
    )
      .bind(note.id, userId)
      .first<{ version: number }>()

    if (!existing) {
      await c.env.DB.prepare(
        'INSERT INTO notes (id, user_id, version, updated_at, is_deleted, encrypted_data, data_iv) VALUES (?, ?, 1, ?, ?, ?, ?)',
      )
        .bind(
          note.id,
          userId,
          ts,
          note.is_deleted ? 1 : 0,
          note.encrypted_data,
          note.iv,
        )
        .run()

      saved.push({ id: note.id, version: 1, updated_at: ts })
      continue
    }

    if (existing.version !== note.base_version) {
      const conflictId = crypto.randomUUID()
      await c.env.DB.prepare(
        'INSERT INTO note_conflicts (id, note_id, user_id, encrypted_data, data_iv, device_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(
          conflictId,
          note.id,
          userId,
          note.encrypted_data,
          note.iv,
          deviceName,
          ts,
        )
        .run()
      conflicts.push(note.id)
      continue
    }

    const newVersion = existing.version + 1
    const update = await c.env.DB.prepare(
      'UPDATE notes SET encrypted_data = ?, data_iv = ?, is_deleted = ?, version = ?, updated_at = ? WHERE id = ? AND user_id = ? AND version = ?',
    )
      .bind(
        note.encrypted_data,
        note.iv,
        note.is_deleted ? 1 : 0,
        newVersion,
        ts,
        note.id,
        userId,
        existing.version,
      )
      .run()

    if ((update.meta?.changes ?? 0) === 0) {
      const conflictId = crypto.randomUUID()
      await c.env.DB.prepare(
        'INSERT INTO note_conflicts (id, note_id, user_id, encrypted_data, data_iv, device_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(
          conflictId,
          note.id,
          userId,
          note.encrypted_data,
          note.iv,
          deviceName,
          ts,
        )
        .run()
      conflicts.push(note.id)
      continue
    }

    saved.push({ id: note.id, version: newVersion, updated_at: ts })
  }

  const status = conflicts.length > 0 ? 409 : 200
  return c.json({ saved, conflicts }, status)
})

notesRoutes.get('/notes/:id/conflicts', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

  const noteId = c.req.param('id')
  if (!noteId) return c.json({ error: 'INVALID_NOTE_ID' }, 400)

  const note = await c.env.DB.prepare(
    'SELECT id, version, updated_at, is_deleted, encrypted_data, data_iv FROM notes WHERE id = ? AND user_id = ? LIMIT 1',
  )
    .bind(noteId, userId)
    .first<Pick<DbNote, 'id' | 'version' | 'updated_at' | 'is_deleted' | 'encrypted_data' | 'data_iv'>>()

  const conflicts = await c.env.DB.prepare(
    'SELECT id, encrypted_data, data_iv, device_name, created_at FROM note_conflicts WHERE note_id = ? AND user_id = ? ORDER BY created_at ASC',
  )
    .bind(noteId, userId)
    .all<{
      id: string
      encrypted_data: string
      data_iv: string
      device_name: string | null
      created_at: number | null
    }>()

  return c.json({ note: note ?? null, conflicts: conflicts.results ?? [] }, 200)
})

notesRoutes.delete('/notes/:id/conflicts', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

  const noteId = c.req.param('id')
  if (!noteId) return c.json({ error: 'INVALID_NOTE_ID' }, 400)

  await c.env.DB.prepare('DELETE FROM note_conflicts WHERE note_id = ? AND user_id = ?')
    .bind(noteId, userId)
    .run()

  return c.json({ ok: true }, 200)
})
