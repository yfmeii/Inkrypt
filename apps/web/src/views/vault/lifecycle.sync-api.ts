import { saveNoteResponseSchema } from '@inkrypt/contracts/notes'
import type { CanonicalNoteSession } from '../../application/notes/canonicalNoteSession'
import { ApiError, getJSON, putJSON } from '../../lib/api'
import { decryptNotePayload, encryptNotePayload, noteAad, type Bytes, type NotePayload } from '../../lib/crypto'
import type { NotePayloadWithYjs } from '../../lib/yjs'

export function createVaultSyncApi(args: {
  masterKey: Bytes | null
  session: CanonicalNoteSession
}) {
  return {
    getNote: async (noteId: string) => {
      if (!args.masterKey) return null
      let res
      try {
        res = await getJSON(
          `/api/notes/${encodeURIComponent(noteId)}`,
          saveNoteResponseSchema,
        )
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          args.session.recordRemoteVersion(noteId, 0)
          return null
        }
        throw error
      }
      const record = res.note

      if (!args.session.recordRemoteVersion(noteId, record.version)) {
        throw new Error('笔记会话已切换，已取消旧笔记同步')
      }
      if (record.is_deleted) throw new Error('该笔记已在其他设备删除，请恢复为新笔记后再保存')
      const payload = await decryptNotePayload(args.masterKey, record.encrypted_data, record.data_iv, noteAad(noteId))
      return payload as NotePayloadWithYjs
    },
    putNote: async (noteId: string, payload: NotePayloadWithYjs) => {
      if (!args.masterKey) throw new Error('No master key')
      const saveContext = args.session.getSaveContext(noteId)
      if (!saveContext) throw new Error('笔记会话尚未准备完成')

      const draft = saveContext.draft
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

      let res
      try {
        res = await putJSON(`/api/notes/${encodeURIComponent(noteId)}`, {
          encrypted_data: encrypted.encrypted_data,
          data_iv: encrypted.iv,
          base_version: saveContext.baseVersion,
          is_deleted: false,
        }, saveNoteResponseSchema)
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          throw new Error('同步繁忙，请稍后再试')
        }
        throw error
      }

      args.session.recordRemoteVersion(noteId, res.note.version)
      return {
        noteId: res.note.id,
        version: res.note.version,
        changeSequence: res.note.change_seq,
        updatedAt: res.note.updated_at,
        savedPayload: mergedPayload,
      }
    },
  }
}
