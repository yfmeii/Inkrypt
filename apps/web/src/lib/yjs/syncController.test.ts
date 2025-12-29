import { describe, test, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { SyncController, type NotePayloadWithYjs } from './syncController'
import { YjsDocManager } from './docManager'
import { encodeYDoc, decodeYDoc } from './serializer'

describe('SyncController', () => {
  let docManager: YjsDocManager
  let mockApi: {
    getNote: ReturnType<typeof vi.fn>
    putNote: ReturnType<typeof vi.fn>
  }
  let controller: SyncController

  beforeEach(() => {
    docManager = new YjsDocManager()
    mockApi = {
      getNote: vi.fn(),
      putNote: vi.fn()
    }
    controller = new SyncController(docManager, mockApi)
  })

  describe('正常同步流程', () => {
    test('syncs successfully when no remote exists', async () => {
      // Initialize local doc with content
      const doc = await docManager.initialize('note-1')
      const text = doc.getText('content')
      text.insert(0, 'local content')

      // Mock API: no remote note
      mockApi.getNote.mockResolvedValueOnce(null)
      mockApi.putNote.mockResolvedValueOnce(undefined)
      
      // Mock verification GET
      const localSnapshot = encodeYDoc(doc)
      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: localSnapshot
      })

      const result = await controller.sync('note-1')

      expect(result.success).toBe(true)
      expect(result.mergedRemote).toBe(false)
      expect(mockApi.getNote).toHaveBeenCalledTimes(2) // Initial GET + verification GET
      expect(mockApi.putNote).toHaveBeenCalledTimes(1)
      expect(docManager.isDirty()).toBe(false)
    })

    test('syncs and merges when remote exists', async () => {
      // Create remote doc with content
      const remoteDoc = new Y.Doc()
      remoteDoc.getText('content').insert(0, 'remote content')
      const remoteSnapshot = encodeYDoc(remoteDoc)

      // Initialize local doc with different content
      const doc = await docManager.initialize('note-1')
      const text = doc.getText('content')
      text.insert(0, 'local content')

      // Mock API: remote note exists
      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: 'Test Note',
          created_at: Date.now(),
          tags: ['test'],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: remoteSnapshot
      })
      
      // Capture the PUT call to get the merged snapshot
      let putSnapshot: string | undefined
      mockApi.putNote.mockImplementationOnce(async (_noteId, payload) => {
        putSnapshot = payload.yjsSnapshotB64
      })
      
      // Mock verification GET - return the same snapshot that was PUT
      mockApi.getNote.mockImplementationOnce(async () => ({
        meta: {
          title: 'Test Note',
          created_at: Date.now(),
          tags: ['test'],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: putSnapshot!
      }))

      const result = await controller.sync('note-1')

      expect(result.success).toBe(true)
      expect(result.mergedRemote).toBe(true)
      expect(mockApi.getNote).toHaveBeenCalledTimes(2)
      expect(mockApi.putNote).toHaveBeenCalledTimes(1)
      
      // Verify merged content contains both local and remote
      const mergedText = doc.getText('content').toString()
      expect(mergedText).toContain('local content')
      expect(mergedText).toContain('remote content')
      
      expect(docManager.isDirty()).toBe(false)
    })

    test('preserves remote metadata during sync', async () => {
      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'content')

      const remoteMeta = {
        title: 'Remote Title',
        created_at: 1234567890,
        tags: ['tag1', 'tag2'],
        is_favorite: true
      }

      mockApi.getNote.mockResolvedValueOnce({
        meta: remoteMeta,
        content: 'old content',
        attachments: { 'file.txt': 'data' }
      })
      mockApi.putNote.mockResolvedValueOnce(undefined)
      
      const mergedSnapshot = encodeYDoc(doc)
      mockApi.getNote.mockResolvedValueOnce({
        meta: remoteMeta,
        content: 'old content',
        yjsSnapshotB64: mergedSnapshot
      })

      await controller.sync('note-1')

      const putCall = mockApi.putNote.mock.calls[0][1] as NotePayloadWithYjs
      expect(putCall.meta.title).toBe('Remote Title')
      expect(putCall.meta.created_at).toBe(1234567890)
      expect(putCall.meta.tags).toEqual(['tag1', 'tag2'])
      expect(putCall.meta.is_favorite).toBe(true)
      expect(putCall.attachments).toEqual({ 'file.txt': 'data' })
    })

    test('adds CRDT metadata to payload', async () => {
      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'content')

      mockApi.getNote.mockResolvedValueOnce(null)
      mockApi.putNote.mockResolvedValueOnce(undefined)
      
      const mergedSnapshot = encodeYDoc(doc)
      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: mergedSnapshot
      })

      await controller.sync('note-1')

      const putCall = mockApi.putNote.mock.calls[0][1] as NotePayloadWithYjs
      expect(putCall.format).toBe('blocknote+yjs-v1')
      expect(putCall.yjsSnapshotB64).toBeDefined()
      expect(putCall.syncNonce).toBeDefined()
      expect(putCall.meta.updatedAtClient).toBeDefined()
      expect(putCall.meta.updatedBy).toBeDefined()
    })
  })

  describe('验证失败重试', () => {
    test('retries when verification fails', async () => {
      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'content')

      // First attempt: verification fails
      mockApi.getNote.mockResolvedValueOnce(null) // Initial GET
      
      let firstPutSnapshot: string | undefined
      mockApi.putNote.mockImplementationOnce(async (_noteId, payload) => {
        firstPutSnapshot = payload.yjsSnapshotB64
      })
      
      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: 'different-snapshot' // Verification fails
      })

      // Second attempt: verification succeeds
      mockApi.getNote.mockResolvedValueOnce(null) // Initial GET
      
      let secondPutSnapshot: string | undefined
      mockApi.putNote.mockImplementationOnce(async (_noteId, payload) => {
        secondPutSnapshot = payload.yjsSnapshotB64
      })
      
      mockApi.getNote.mockImplementationOnce(async () => ({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: secondPutSnapshot! // Verification succeeds
      }))

      const result = await controller.sync('note-1')

      expect(result.success).toBe(true)
      expect(mockApi.getNote).toHaveBeenCalledTimes(4) // 2 attempts × (initial + verify)
      expect(mockApi.putNote).toHaveBeenCalledTimes(2)
    })

    test('fails after max retries', async () => {
      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'content')

      // All attempts fail verification
      for (let i = 0; i < 3; i++) {
        mockApi.getNote.mockResolvedValueOnce(null) // Initial GET
        mockApi.putNote.mockResolvedValueOnce(undefined) // PUT
        mockApi.getNote.mockResolvedValueOnce({
          meta: {
            title: '',
            created_at: Date.now(),
            tags: [],
            is_favorite: false
          },
          content: '',
          yjsSnapshotB64: 'different-snapshot' // Verification fails
        })
      }

      const result = await controller.sync('note-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('同步繁忙，请稍后再试')
      expect(mockApi.getNote).toHaveBeenCalledTimes(6) // 3 attempts × (initial + verify)
      expect(mockApi.putNote).toHaveBeenCalledTimes(3)
      
      const status = controller.getStatus()
      expect(status.type).toBe('error')
      if (status.type === 'error') {
        expect(status.canRetry).toBe(true)
      }
    })

    test('merges remote changes during retry', async () => {
      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'local')

      // First attempt: no remote initially, but verification returns different content (concurrent write)
      mockApi.getNote.mockResolvedValueOnce(null)
      
      let firstPutSnapshot: string | undefined
      mockApi.putNote.mockImplementationOnce(async (_noteId, payload) => {
        firstPutSnapshot = payload.yjsSnapshotB64
      })
      
      // Verification fails - someone else wrote concurrently
      const remoteDoc1 = new Y.Doc()
      remoteDoc1.getText('content').insert(0, 'remote1')
      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: encodeYDoc(remoteDoc1)
      })

      // Second attempt: fetch the remote1 content, merge it
      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: encodeYDoc(remoteDoc1)
      })
      
      let secondPutSnapshot: string | undefined
      mockApi.putNote.mockImplementationOnce(async (_noteId, payload) => {
        secondPutSnapshot = payload.yjsSnapshotB64
      })
      
      // Verification succeeds
      mockApi.getNote.mockImplementationOnce(async () => ({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: secondPutSnapshot!
      }))

      const result = await controller.sync('note-1')

      expect(result.success).toBe(true)
      expect(result.mergedRemote).toBe(true)
      
      // Verify both local and remote1 content are merged
      const finalText = doc.getText('content').toString()
      expect(finalText).toContain('local')
      expect(finalText).toContain('remote1')
    })
  })

  describe('网络错误处理', () => {
    test('handles GET error', async () => {
      await docManager.initialize('note-1')

      mockApi.getNote.mockRejectedValue(new Error('Network error'))

      const result = await controller.sync('note-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Network error')
      
      const status = controller.getStatus()
      expect(status.type).toBe('error')
    })

    test('handles PUT error', async () => {
      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'content')

      mockApi.getNote.mockResolvedValue(null)
      mockApi.putNote.mockRejectedValue(new Error('Server error'))

      const result = await controller.sync('note-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Server error')
    })

    test('retries on network errors', async () => {
      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'content')

      // First two attempts fail
      mockApi.getNote.mockRejectedValueOnce(new Error('Network error'))
      mockApi.getNote.mockRejectedValueOnce(new Error('Network error'))

      // Third attempt succeeds
      mockApi.getNote.mockResolvedValueOnce(null)
      mockApi.putNote.mockResolvedValueOnce(undefined)
      const snapshot = encodeYDoc(doc)
      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: snapshot
      })

      const result = await controller.sync('note-1')

      expect(result.success).toBe(true)
      expect(mockApi.getNote).toHaveBeenCalledTimes(4) // 2 failed + 1 success + 1 verify
    })

    test('fails after max retries on network errors', async () => {
      await docManager.initialize('note-1')

      mockApi.getNote.mockRejectedValue(new Error('Network error'))

      const result = await controller.sync('note-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Network error')
      expect(mockApi.getNote).toHaveBeenCalledTimes(3) // MAX_RETRIES
    })
  })

  describe('状态管理', () => {
    test('initial status is idle', () => {
      const status = controller.getStatus()
      expect(status.type).toBe('idle')
    })

    test('status changes to syncing during sync', async () => {
      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'content')

      let syncingStatusSeen = false
      controller.onStatus((status) => {
        if (status.type === 'syncing') {
          syncingStatusSeen = true
        }
      })

      mockApi.getNote.mockResolvedValueOnce(null)
      mockApi.putNote.mockResolvedValueOnce(undefined)
      const snapshot = encodeYDoc(doc)
      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: snapshot
      })

      await controller.sync('note-1')

      expect(syncingStatusSeen).toBe(true)
    })

    test('status changes to success after successful sync', async () => {
      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'content')

      mockApi.getNote.mockResolvedValueOnce(null)
      mockApi.putNote.mockResolvedValueOnce(undefined)
      const snapshot = encodeYDoc(doc)
      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: snapshot
      })

      await controller.sync('note-1')

      const status = controller.getStatus()
      expect(status.type).toBe('success')
      if (status.type === 'success') {
        expect(status.mergedRemote).toBe(false)
      }
    })

    test('status indicates when remote was merged', async () => {
      const remoteDoc = new Y.Doc()
      remoteDoc.getText('content').insert(0, 'remote')
      const remoteSnapshot = encodeYDoc(remoteDoc)

      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'local')

      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: remoteSnapshot
      })
      
      let putSnapshot: string | undefined
      mockApi.putNote.mockImplementationOnce(async (_noteId, payload) => {
        putSnapshot = payload.yjsSnapshotB64
      })
      
      mockApi.getNote.mockImplementationOnce(async () => ({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: putSnapshot!
      }))

      await controller.sync('note-1')

      const status = controller.getStatus()
      expect(status.type).toBe('success')
      if (status.type === 'success') {
        expect(status.mergedRemote).toBe(true)
      }
    })

    test('status changes to error on failure', async () => {
      await docManager.initialize('note-1')

      mockApi.getNote.mockRejectedValue(new Error('Test error'))

      await controller.sync('note-1')

      const status = controller.getStatus()
      expect(status.type).toBe('error')
      if (status.type === 'error') {
        expect(status.message).toBe('Test error')
        expect(status.canRetry).toBe(true)
      }
    })

    test('onStatus callback receives all status changes', async () => {
      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'content')

      const statuses: string[] = []
      controller.onStatus((status) => {
        statuses.push(status.type)
      })

      mockApi.getNote.mockResolvedValueOnce(null)
      mockApi.putNote.mockResolvedValueOnce(undefined)
      const snapshot = encodeYDoc(doc)
      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: snapshot
      })

      await controller.sync('note-1')

      expect(statuses).toEqual(['syncing', 'success'])
    })
  })

  describe('边界情况', () => {
    test('fails when docManager has no document', async () => {
      // Don't initialize docManager
      const result = await controller.sync('note-1')

      expect(result.success).toBe(false)
      expect(result.error).toBe('本地文档不存在')
      expect(mockApi.getNote).not.toHaveBeenCalled()
    })

    test('handles empty remote payload', async () => {
      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'content')

      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: ''
      })
      mockApi.putNote.mockResolvedValueOnce(undefined)
      const snapshot = encodeYDoc(doc)
      mockApi.getNote.mockResolvedValueOnce({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: snapshot
      })

      const result = await controller.sync('note-1')

      expect(result.success).toBe(true)
      expect(result.mergedRemote).toBe(false)
    })

    test('handles concurrent syncs gracefully', async () => {
      const doc = await docManager.initialize('note-1')
      doc.getText('content').insert(0, 'content')

      mockApi.getNote.mockResolvedValue(null)
      mockApi.putNote.mockResolvedValue(undefined)
      const snapshot = encodeYDoc(doc)
      mockApi.getNote.mockResolvedValue({
        meta: {
          title: '',
          created_at: Date.now(),
          tags: [],
          is_favorite: false
        },
        content: '',
        yjsSnapshotB64: snapshot
      })

      // Start two syncs concurrently
      const [result1, result2] = await Promise.all([
        controller.sync('note-1'),
        controller.sync('note-1')
      ])

      // Both should complete (though behavior may vary)
      expect(result1.success || result2.success).toBe(true)
    })
  })
})
