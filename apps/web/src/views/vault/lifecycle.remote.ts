import { ApiError, getJSON, postJSON } from '../../lib/api'
import { decryptNotePayload, encryptNotePayload, noteAad, type Bytes, type NotePayload } from '../../lib/crypto'
import { idbGetLastSync, idbSetLastSync, idbUpsertEncryptedNotes } from '../../lib/idb'
import type { DecryptedNote } from '../../state/store'
import { NotesGetResponse, NotesPostResponse, toStoredPayload } from './lifecycle.shared'

export async function syncNotesFromRemote(args: {
  masterKey: Bytes | null
  selectedNoteId: string | null
  dirty: boolean
  selectedBaseline: NotePayload | null
  forgetNoteSearchText: (noteId: string) => void
  rememberNoteSearchText: (noteId: string, payload: NotePayload) => void
  removeNote: (noteId: string) => void
  upsertNote: (note: DecryptedNote) => void
  onSelectedRemoteUpdate: (note: DecryptedNote, payload: NotePayload) => void
}): Promise<void> {
  if (!args.masterKey) return

  const since = await idbGetLastSync()
  const res = await getJSON<NotesGetResponse>(`/api/notes?since=${since}`)

  if (res.notes.length === 0) return

  await idbUpsertEncryptedNotes(res.notes)
  const maxUpdated = Math.max(...res.notes.map((note) => note.updated_at))
  await idbSetLastSync(Math.max(since, maxUpdated))

  for (const note of res.notes) {
    if (note.is_deleted) {
      args.forgetNoteSearchText(note.id)
      args.removeNote(note.id)
      continue
    }

    try {
      const payload = await decryptNotePayload(args.masterKey, note.encrypted_data, note.data_iv, noteAad(note.id))
      const decryptedNote = { ...note, payload: toStoredPayload(payload) }

      args.rememberNoteSearchText(note.id, payload)
      args.upsertNote(decryptedNote)

      if (args.selectedNoteId === note.id && !args.dirty && args.selectedBaseline) {
        args.onSelectedRemoteUpdate(decryptedNote, payload)
      }
    } catch {
      // Keep ciphertext in IDB so it can still be diagnosed later.
    }
  }
}

export async function createNotePersistence(args: {
  masterKey: Bytes
  upsertNote: (note: DecryptedNote) => void
  rememberNoteSearchText: (noteId: string, payload: NotePayload) => void
}): Promise<string> {
  const id = crypto.randomUUID()
  const payload: NotePayload = {
    meta: { title: '', created_at: Date.now(), tags: [], is_favorite: false },
    content: '',
    attachments: {},
  }

  const encrypted = await encryptNotePayload(args.masterKey, payload, noteAad(id))
  let res: NotesPostResponse
  try {
    res = await postJSON<NotesPostResponse>('/api/notes', [
      { id, encrypted_data: encrypted.encrypted_data, iv: encrypted.iv, base_version: 0, is_deleted: false },
    ])
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      res = error.payload as NotesPostResponse
    } else {
      throw error
    }
  }

  if (res.conflicts.includes(id)) {
    throw new Error('同步失败，请稍后重试')
  }

  const saved = res.saved.find((entry) => entry.id === id)
  if (!saved) throw new Error('已上传，但未收到服务器确认。请稍后点“从云端同步”确认结果')

  await idbUpsertEncryptedNotes([
    {
      id,
      version: saved.version,
      updated_at: saved.updated_at,
      is_deleted: 0,
      encrypted_data: encrypted.encrypted_data,
      data_iv: encrypted.iv,
    },
  ])

  args.upsertNote({
    id,
    version: saved.version,
    updated_at: saved.updated_at,
    is_deleted: 0,
    payload,
  })
  args.rememberNoteSearchText(id, payload)

  return id
}

export async function deleteNotePersistence(args: {
  masterKey: Bytes
  selected: DecryptedNote
  forgetNoteSearchText: (noteId: string) => void
  removeNote: (noteId: string) => void
}): Promise<void> {
  const encrypted = await encryptNotePayload(args.masterKey, args.selected.payload, noteAad(args.selected.id))

  let res: NotesPostResponse
  try {
    res = await postJSON<NotesPostResponse>('/api/notes', [
      {
        id: args.selected.id,
        encrypted_data: encrypted.encrypted_data,
        iv: encrypted.iv,
        base_version: args.selected.version,
        is_deleted: true,
      },
    ])
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      res = error.payload as NotesPostResponse
    } else {
      throw error
    }
  }

  if (res.conflicts.includes(args.selected.id)) {
    throw new Error('同步失败，请稍后重试')
  }

  const saved = res.saved.find((entry) => entry.id === args.selected.id)
  if (!saved) throw new Error('已删除，但未收到服务器确认。请稍后点“从云端同步”确认结果')

  await idbUpsertEncryptedNotes([
    {
      id: args.selected.id,
      version: saved.version,
      updated_at: saved.updated_at,
      is_deleted: 1,
      encrypted_data: encrypted.encrypted_data,
      data_iv: encrypted.iv,
    },
  ])

  args.forgetNoteSearchText(args.selected.id)
  args.removeNote(args.selected.id)
}
