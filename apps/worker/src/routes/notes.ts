import { Hono } from 'hono'
import {
  batchSaveNotesRequestSchema,
  noteIdSchema,
  saveNoteRequestSchema,
} from '@inkrypt/contracts/notes'
import { saveNote, saveNoteBatch } from '../domain/notes'
import type { AppEnv } from '../env'
import { requireAuth } from '../middleware/requireAuth'
import {
  getNoteChangeHead,
  getNoteById,
  listNoteChanges,
  type PersistedNoteRecord,
} from '../repositories/notes'
import { bytesToBase64Url, base64UrlToBytes } from '../utils/base64'
import { jsonError, parseJsonBody, requireUserId } from './shared'

const DEFAULT_CHANGE_PAGE_SIZE = 20
const MAX_CHANGE_PAGE_SIZE = 100

type NoteChangesCursor = {
  version: 1
  after: number
  through: number | null
}

function encodeCursor(cursor: NoteChangesCursor): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(cursor)))
}

function decodeCursor(value: string | undefined): NoteChangesCursor | null {
  if (!value) return { version: 1, after: 0, through: null }
  try {
    const decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as unknown
    if (!decoded || typeof decoded !== 'object') return null
    const candidate = decoded as Partial<NoteChangesCursor>
    const validAfter = Number.isSafeInteger(candidate.after) && (candidate.after ?? -1) >= 0
    const validThrough = candidate.through === null || (
      Number.isSafeInteger(candidate.through) &&
      (candidate.through ?? -1) >= (candidate.after ?? 0)
    )
    if (candidate.version !== 1 || !validAfter || !validThrough) return null
    return candidate as NoteChangesCursor
  } catch {
    return null
  }
}

function toNoteDto(note: PersistedNoteRecord) {
  return {
    ...note,
    change_seq: String(note.change_seq),
    is_deleted: Boolean(note.is_deleted),
  }
}

export const notesRoutes = new Hono<AppEnv>()

notesRoutes.use('/notes', requireAuth)
notesRoutes.use('/notes/*', requireAuth)

notesRoutes.get('/notes/changes', async (c) => {
  const userId = requireUserId(c)
  if (userId instanceof Response) return userId

  const cursor = decodeCursor(c.req.query('cursor'))
  if (!cursor) return jsonError(c, 'INVALID_CURSOR', 400)

  const limitRaw = c.req.query('limit')
  const limit = limitRaw === undefined ? DEFAULT_CHANGE_PAGE_SIZE : Number(limitRaw)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHANGE_PAGE_SIZE) {
    return jsonError(c, 'INVALID_CURSOR', 400)
  }

  const head = await getNoteChangeHead(c.env.DB, userId)
  if (cursor.after > head) return jsonError(c, 'CURSOR_AHEAD', 409)

  const through = cursor.through ?? head
  if (through > head) return jsonError(c, 'CURSOR_AHEAD', 409)

  const notes = await listNoteChanges(c.env.DB, userId, cursor.after, through, limit + 1)
  const hasMore = notes.length > limit
  const page = hasMore ? notes.slice(0, limit) : notes
  const lastSequence = page.at(-1)?.change_seq ?? cursor.after
  const nextCursor = encodeCursor(hasMore
    ? { version: 1, after: lastSequence, through }
    : { version: 1, after: through, through: null })

  return c.json({
    notes: page.map(toNoteDto),
    next_cursor: nextCursor,
    has_more: hasMore,
  }, 200)
})

notesRoutes.get('/notes/:id', async (c) => {
  const userId = requireUserId(c)
  if (userId instanceof Response) return userId

  const noteId = noteIdSchema.safeParse(c.req.param('id'))
  if (!noteId.success) return jsonError(c, 'INVALID_NOTE_ID', 400)

  const note = await getNoteById(c.env.DB, noteId.data, userId)
  if (!note) return jsonError(c, 'NOTE_NOT_FOUND', 404)
  return c.json({ note: toNoteDto(note) }, 200)
})

notesRoutes.put('/notes/:id', async (c) => {
  const userId = requireUserId(c)
  if (userId instanceof Response) return userId

  const noteId = noteIdSchema.safeParse(c.req.param('id'))
  if (!noteId.success) return jsonError(c, 'INVALID_NOTE_ID', 400)

  const body = await parseJsonBody(c, saveNoteRequestSchema)
  if (body instanceof Response) return body

  const outcome = await saveNote({
    db: c.env.DB,
    userId,
    note: {
      id: noteId.data,
      base_version: body.base_version,
      encrypted_data: body.encrypted_data,
      iv: body.data_iv,
      is_deleted: body.is_deleted,
    },
  })

  if (outcome.status === 'conflict') {
    return c.json({
      error: 'VERSION_CONFLICT' as const,
      current: outcome.current ? toNoteDto(outcome.current) : null,
    }, 409)
  }
  return c.json({ note: toNoteDto(outcome.note) }, 200)
})

notesRoutes.post('/notes/batch', async (c) => {
  const userId = requireUserId(c)
  if (userId instanceof Response) return userId

  const body = await parseJsonBody(c, batchSaveNotesRequestSchema)
  if (body instanceof Response) return body

  const noteIds = body.notes.map((note) => note.id)
  if (new Set(noteIds).size !== noteIds.length) return jsonError(c, 'INVALID_BODY', 400)

  const outcomes = await saveNoteBatch({
    db: c.env.DB,
    userId,
    notes: body.notes.map((note) => ({
      id: note.id,
      base_version: note.base_version,
      encrypted_data: note.encrypted_data,
      iv: note.data_iv,
      is_deleted: note.is_deleted,
    })),
  })

  return c.json({
    results: outcomes.map(({ id, outcome }) => outcome.status === 'saved'
      ? { id, status: 'saved' as const, note: toNoteDto(outcome.note) }
      : {
          id,
          status: 'conflict' as const,
          current: outcome.current ? toNoteDto(outcome.current) : null,
        }),
  }, 200)
})
