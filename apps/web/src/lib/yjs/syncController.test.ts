import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as Y from 'yjs'
import { YjsDocManager } from './docManager'
import { encodeYDoc } from './serializer'
import { SyncController } from './syncController'

const savedReceipt = {
  noteId: 'note-1',
  version: 2,
  changeSequence: '2',
  updatedAt: 100,
  savedPayload: {
    meta: { title: 'Saved', created_at: 1, tags: [], is_favorite: false },
    content: 'saved content',
    attachments: {},
    format: 'blocknote+yjs-v1' as const,
    yjsSnapshotB64: 'saved-snapshot',
  },
}

describe('SyncController', () => {
  let documentManager: YjsDocManager
  type SyncApi = ConstructorParameters<typeof SyncController>[1]
  let getNote: ReturnType<typeof vi.fn<SyncApi['getNote']>>
  let putNote: ReturnType<typeof vi.fn<SyncApi['putNote']>>
  let controller: SyncController

  beforeEach(() => {
    localStorage.clear()
    documentManager = new YjsDocManager()
    getNote = vi.fn()
    putNote = vi.fn()
    controller = new SyncController(documentManager, { getNote, putNote })
  })

  test('saves a new canonical document without a verification GET', async () => {
    const document = await documentManager.initialize('note-1')
    document.getText('content').insert(0, 'local content')
    getNote.mockResolvedValueOnce(null)
    putNote.mockResolvedValueOnce(savedReceipt)

    const result = await controller.sync('note-1')

    expect(result).toEqual({
      success: true,
      mergedRemote: false,
      snapshotAcknowledged: true,
      receipt: savedReceipt,
    })
    expect(getNote).toHaveBeenCalledTimes(1)
    expect(putNote).toHaveBeenCalledTimes(1)
    expect(documentManager.isDirty()).toBe(false)
  })

  test('merges the remote Yjs snapshot before the CAS save', async () => {
    const remoteDocument = new Y.Doc()
    remoteDocument.getText('content').insert(0, 'remote content')
    const localDocument = await documentManager.initialize('note-1')
    localDocument.getText('content').insert(0, 'local content')
    getNote.mockResolvedValueOnce({
      meta: { title: 'Remote', created_at: 1, tags: [], is_favorite: false },
      content: '',
      yjsSnapshotB64: encodeYDoc(remoteDocument),
    })
    putNote.mockResolvedValueOnce(savedReceipt)

    const result = await controller.sync('note-1')

    expect(result.success).toBe(true)
    expect(result.mergedRemote).toBe(true)
    expect(localDocument.getText('content').toString()).toContain('local content')
    expect(localDocument.getText('content').toString()).toContain('remote content')
    const savedPayload = putNote.mock.calls[0]?.[1]
    expect(savedPayload.meta.title).toBe('Remote')
    expect(savedPayload.format).toBe('blocknote+yjs-v1')
  })

  test('retries transient save failures', async () => {
    const document = await documentManager.initialize('note-1')
    document.getText('content').insert(0, 'content')
    getNote.mockResolvedValue(null)
    putNote.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(savedReceipt)

    const result = await controller.sync('note-1')

    expect(result.success).toBe(true)
    expect(getNote).toHaveBeenCalledTimes(2)
    expect(putNote).toHaveBeenCalledTimes(2)
  })

  test('returns the final error after all save retries fail', async () => {
    const document = await documentManager.initialize('note-1')
    document.getText('content').insert(0, 'content')
    getNote.mockResolvedValue(null)
    putNote.mockRejectedValue(new Error('network unavailable'))

    const result = await controller.sync('note-1')

    expect(result).toEqual({
      success: false,
      mergedRemote: false,
      error: 'network unavailable',
    })
    expect(putNote).toHaveBeenCalledTimes(3)
    expect(documentManager.isDirty()).toBe(true)
  })

  test('keeps edits made during the request dirty for the next save', async () => {
    const document = await documentManager.initialize('note-1')
    document.getText('content').insert(0, 'before request')
    getNote.mockResolvedValueOnce(null)
    putNote.mockImplementationOnce(async () => {
      document.getText('content').insert(document.getText('content').length, ' after request')
      return savedReceipt
    })

    const result = await controller.sync('note-1')

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.snapshotAcknowledged).toBe(false)
    expect(documentManager.isDirty()).toBe(true)
  })
})
