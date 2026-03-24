import { Hono } from 'hono'
import { z } from 'zod'
import { saveNotes } from '../domain/notes'
import type { AppEnv } from '../env'
import { requireAuth } from '../middleware/requireAuth'
import { getCredentialForUser } from '../repositories/credentials'
import {
  deleteNoteConflicts,
  getNoteById,
  listNoteConflicts,
  listNotesSince,
} from '../repositories/notes'
import { jsonError, parseJsonBody, requireUserId } from './shared'

const MAX_ENCRYPTED_NOTE_B64 = 6_000_000
const MAX_IV_B64 = 128

export const notesRoutes = new Hono<AppEnv>()

notesRoutes.use('/notes', requireAuth)
notesRoutes.use('/notes/*', requireAuth)

notesRoutes.get('/notes', async (c) => {
  const userId = requireUserId(c)
  if (userId instanceof Response) return userId

  const sinceRaw = c.req.query('since')
  const since = sinceRaw ? Number(sinceRaw) : 0
  if (!Number.isFinite(since) || since < 0) return jsonError(c, 'INVALID_SINCE', 400)

  const notes = await listNotesSince(c.env.DB, userId, since)
  return c.json({ notes }, 200)
})

notesRoutes.post('/notes', async (c) => {
  const userId = requireUserId(c)
  const credentialId = c.get('credentialId')
  if (userId instanceof Response) return userId

  const body = await parseJsonBody(
    c,
    z.array(
      z.object({
        id: z.string().uuid(),
        encrypted_data: z.string().min(1).max(MAX_ENCRYPTED_NOTE_B64),
        iv: z.string().min(1).max(MAX_IV_B64),
        base_version: z.number().int().nonnegative(),
        is_deleted: z.boolean().optional(),
      }),
    ),
  )
  if (body instanceof Response) return body

  let deviceName: string | null = null
  if (credentialId) {
    const credential = await getCredentialForUser(c.env.DB, userId, credentialId)
    deviceName = credential?.device_name ?? null
  }

  const result = await saveNotes({
    db: c.env.DB,
    userId,
    deviceName,
    notes: body,
  })

  const status = result.conflicts.length > 0 ? 409 : 200
  return c.json(result, status)
})

notesRoutes.get('/notes/:id/conflicts', async (c) => {
  const userId = requireUserId(c)
  if (userId instanceof Response) return userId

  const noteId = c.req.param('id')
  if (!noteId) return jsonError(c, 'INVALID_NOTE_ID', 400)

  const [note, conflicts] = await Promise.all([
    getNoteById(c.env.DB, noteId, userId),
    listNoteConflicts(c.env.DB, noteId, userId),
  ])

  return c.json({ note: note ?? null, conflicts }, 200)
})

notesRoutes.delete('/notes/:id/conflicts', async (c) => {
  const userId = requireUserId(c)
  if (userId instanceof Response) return userId

  const noteId = c.req.param('id')
  if (!noteId) return jsonError(c, 'INVALID_NOTE_ID', 400)

  await deleteNoteConflicts(c.env.DB, noteId, userId)
  return c.json({ ok: true }, 200)
})
