import type { MutableRefObject } from 'react'
import { ApiError, getJSON, postJSON } from '../../lib/api'
import { decryptNotePayload, encryptNotePayload, noteAad, type Bytes, type NotePayload } from '../../lib/crypto'
import type { NotePayloadWithYjs } from '../../lib/yjs'
import type { DecryptedNote } from '../../state/store'
import { NotesGetResponse, NotesPostResponse, type SyncSavedRecord } from './lifecycle.shared'

export function createVaultSyncApi(args: {
  masterKey: Bytes | null
  draftStateRef: MutableRefObject<{
    title: string
    tags: string[]
    is_favorite: boolean
    attachments: Record<string, string>
    content: string
    createdAt: number
  }>
  selectedRef: MutableRefObject<DecryptedNote | null>
  syncRemoteVersionRef: MutableRefObject<number>
  syncSavedRef: MutableRefObject<SyncSavedRecord | null>
}) {
  return {
    getNote: async (noteId: string) => {
      if (!args.masterKey) return null
      const res = await getJSON<NotesGetResponse>('/api/notes?since=0')
      const record = res.notes.find((note) => note.id === noteId && !note.is_deleted) ?? null
      if (!record) {
        args.syncRemoteVersionRef.current = 0
        return null
      }

      args.syncRemoteVersionRef.current = record.version
      const payload = await decryptNotePayload(args.masterKey, record.encrypted_data, record.data_iv, noteAad(noteId))
      return payload as NotePayloadWithYjs
    },
    putNote: async (noteId: string, payload: NotePayloadWithYjs) => {
      if (!args.masterKey) throw new Error('No master key')

      const draft = args.draftStateRef.current
      const mergedPayload: NotePayloadWithYjs = {
        ...payload,
        content: draft.content,
        attachments: draft.attachments,
        meta: {
          ...payload.meta,
          title: draft.title,
          created_at: draft.createdAt,
          tags: draft.tags,
          is_favorite: draft.is_favorite,
        },
      }
      const payloadForEncrypt: NotePayload = {
        ...mergedPayload,
        attachments: mergedPayload.attachments ?? {},
      }
      const encrypted = await encryptNotePayload(args.masterKey, payloadForEncrypt, noteAad(noteId))

      let res: NotesPostResponse
      try {
        res = await postJSON<NotesPostResponse>('/api/notes', [{
          id: noteId,
          encrypted_data: encrypted.encrypted_data,
          iv: encrypted.iv,
          base_version: args.syncRemoteVersionRef.current || args.selectedRef.current?.version || 0,
          is_deleted: false,
        }])
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          throw new Error('同步繁忙，请稍后再试')
        }
        throw error
      }

      if (res.conflicts.includes(noteId)) {
        throw new Error('同步繁忙，请稍后再试')
      }

      const saved = res.saved.find((entry) => entry.id === noteId)
      if (saved) args.syncSavedRef.current = saved
    },
  }
}
