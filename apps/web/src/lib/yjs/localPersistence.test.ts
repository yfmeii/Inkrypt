import { describe, test, expect, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import * as Y from 'yjs'
import { type DBSchema, openDB } from 'idb'
import type { Bytes } from '../crypto'
import { LocalPersistence } from './localPersistence'
import { encodeYDoc, decodeYDoc, areYDocsEqual } from './serializer'

type TestStoredSnapshot = {
  version?: 1
  noteId: string
  yjsSnapshotB64?: string
  encryptedSnapshotB64?: string
  ivB64?: string
  updatedAt: number
}

interface TestYjsDB extends DBSchema {
  'yjs-snapshots': {
    key: string
    value: TestStoredSnapshot
  }
}

function createMasterKey(fillValue: number): Bytes {
  return new Uint8Array(32).fill(fillValue) as Bytes
}

/**
 * 生成随机的 Y.Doc 用于属性测试
 */
const yDocArbitrary = fc
  .array(
    fc.record({
      position: fc.nat(1000),
      content: fc.string({ minLength: 0, maxLength: 100 }),
      type: fc.constantFrom('insert' as const, 'delete' as const),
    }),
    { minLength: 0, maxLength: 50 }
  )
  .map((operations) => {
    const doc = new Y.Doc()
    const text = doc.getText('content')

    for (const op of operations) {
      if (op.type === 'insert') {
        const pos = Math.min(op.position, text.length)
        text.insert(pos, op.content)
      } else if (op.type === 'delete' && text.length > 0) {
        const pos = Math.min(op.position, text.length - 1)
        const deleteLen = Math.min(op.content.length, text.length - pos)
        if (deleteLen > 0) {
          text.delete(pos, deleteLen)
        }
      }
    }

    return doc
  })

describe('LocalPersistence', () => {
  let persistence: LocalPersistence
  const masterKey = createMasterKey(7)

  beforeEach(() => {
    persistence = new LocalPersistence()
  })

  describe('Property 4: Local Persistence Preserves State', () => {
    /**
     * Feature: yjs-crdt-sync, Property 4: Local Persistence Preserves State
     * Validates: Requirements 4.1
     *
     * For any Y.Doc with edits, saving to IndexedDB then loading back
     * SHALL produce an equivalent Y.Doc.
     */
    test('save then load produces equivalent Y.Doc', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          yDocArbitrary,
          async (noteId, doc) => {
            // Encode the document
            const snapshot = encodeYDoc(doc)

            // Save to IndexedDB
            await persistence.saveSnapshot(noteId, snapshot, masterKey)

            // Load from IndexedDB
            const loadedSnapshot = await persistence.loadSnapshot(noteId, masterKey)

            // Verify snapshot was preserved
            expect(loadedSnapshot).toBe(snapshot)

            // Decode and verify document equivalence
            if (loadedSnapshot) {
              const loadedDoc = decodeYDoc(loadedSnapshot)
              expect(areYDocsEqual(doc, loadedDoc)).toBe(true)

              // Verify content is preserved
              const originalText = doc.getText('content').toString()
              const loadedText = loadedDoc.getText('content').toString()
              expect(loadedText).toBe(originalText)
            }

            // Cleanup
            await persistence.deleteSnapshot(noteId)
          }
        ),
        { numRuns: 100 }
      )
    })

    test('loading non-existent snapshot returns null', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          async (noteId) => {
            const result = await persistence.loadSnapshot(noteId, masterKey)
            expect(result).toBeNull()
          }
        ),
        { numRuns: 100 }
      )
    })

    test('delete removes snapshot', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          yDocArbitrary,
          async (noteId, doc) => {
            const snapshot = encodeYDoc(doc)

            // Save
            await persistence.saveSnapshot(noteId, snapshot, masterKey)

            // Verify it exists
            const loaded = await persistence.loadSnapshot(noteId, masterKey)
            expect(loaded).toBe(snapshot)

            // Delete
            await persistence.deleteSnapshot(noteId)

            // Verify it's gone
            const afterDelete = await persistence.loadSnapshot(noteId, masterKey)
            expect(afterDelete).toBeNull()
          }
        ),
        { numRuns: 100 }
      )
    })

    test('overwriting snapshot preserves latest state', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          yDocArbitrary,
          yDocArbitrary,
          async (noteId, doc1, doc2) => {
            const snapshot1 = encodeYDoc(doc1)
            const snapshot2 = encodeYDoc(doc2)

            // Save first snapshot
            await persistence.saveSnapshot(noteId, snapshot1, masterKey)

            // Overwrite with second snapshot
            await persistence.saveSnapshot(noteId, snapshot2, masterKey)

            // Load should return the second snapshot
            const loaded = await persistence.loadSnapshot(noteId, masterKey)
            expect(loaded).toBe(snapshot2)

            // Verify it decodes to doc2
            if (loaded) {
              const loadedDoc = decodeYDoc(loaded)
              expect(areYDocsEqual(doc2, loadedDoc)).toBe(true)
            }

            // Cleanup
            await persistence.deleteSnapshot(noteId)
          }
        ),
        { numRuns: 100 }
      )
    })

    test('serializes overlapping writes in invocation order', async () => {
      const noteId = 'overlapping-write-test'

      const firstSave = persistence.saveSnapshot(noteId, 'older-snapshot', masterKey)
      const secondSave = persistence.saveSnapshot(noteId, 'newer-snapshot', masterKey)
      await Promise.all([firstSave, secondSave])

      await expect(persistence.loadSnapshot(noteId, masterKey)).resolves.toBe('newer-snapshot')
      await persistence.deleteSnapshot(noteId)
    })

    test('applies deletion after an already requested write', async () => {
      const noteId = 'save-delete-barrier-test'

      const pendingSave = persistence.saveSnapshot(noteId, 'snapshot', masterKey)
      const pendingDelete = persistence.deleteSnapshot(noteId)
      await Promise.all([pendingSave, pendingDelete])

      await expect(persistence.loadSnapshot(noteId, masterKey)).resolves.toBeNull()
    })

    test('multiple notes can be stored independently', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          yDocArbitrary,
          yDocArbitrary,
          async (noteId1, noteId2, doc1, doc2) => {
            // Skip if noteIds are the same
            if (noteId1 === noteId2) return

            const snapshot1 = encodeYDoc(doc1)
            const snapshot2 = encodeYDoc(doc2)

            // Save both
            await persistence.saveSnapshot(noteId1, snapshot1, masterKey)
            await persistence.saveSnapshot(noteId2, snapshot2, masterKey)

            // Load both
            const loaded1 = await persistence.loadSnapshot(noteId1, masterKey)
            const loaded2 = await persistence.loadSnapshot(noteId2, masterKey)

            // Verify each is preserved independently
            expect(loaded1).toBe(snapshot1)
            expect(loaded2).toBe(snapshot2)

            // Cleanup
            await persistence.deleteSnapshot(noteId1)
            await persistence.deleteSnapshot(noteId2)
          }
        ),
        { numRuns: 100 }
      )
    })

    test('stores only encrypted snapshot material', async () => {
      const noteId = 'encrypted-record-test'
      const snapshot = 'plain-yjs-snapshot'

      await persistence.saveSnapshot(noteId, snapshot, masterKey)

      const database = await openDB<TestYjsDB>('inkrypt-yjs', 1)
      const storedRecord = await database.get('yjs-snapshots', noteId)

      expect(storedRecord).toMatchObject({ version: 1, noteId })
      expect(storedRecord?.yjsSnapshotB64).toBeUndefined()
      expect(storedRecord?.encryptedSnapshotB64).toEqual(expect.any(String))
      expect(storedRecord?.encryptedSnapshotB64).not.toContain(snapshot)
      expect(storedRecord?.ivB64).toEqual(expect.any(String))

      await persistence.deleteSnapshot(noteId)
      database.close()
    })

    test('rejects decryption with a different master key', async () => {
      const noteId = 'wrong-key-test'
      await persistence.saveSnapshot(noteId, 'protected-snapshot', masterKey)

      await expect(
        persistence.loadSnapshot(noteId, createMasterKey(8)),
      ).rejects.toThrow()

      await persistence.deleteSnapshot(noteId)
    })

    test('migrates a legacy plaintext snapshot after successful unlock', async () => {
      const noteId = 'legacy-migration-test'
      const legacySnapshot = 'legacy-plain-snapshot'
      const database = await openDB<TestYjsDB>('inkrypt-yjs', 1)
      await database.put('yjs-snapshots', {
        noteId,
        yjsSnapshotB64: legacySnapshot,
        updatedAt: Date.now(),
      })

      await expect(persistence.loadSnapshot(noteId, masterKey)).resolves.toBe(legacySnapshot)

      const migratedRecord = await database.get('yjs-snapshots', noteId)
      expect(migratedRecord).toMatchObject({ version: 1, noteId })
      expect(migratedRecord?.yjsSnapshotB64).toBeUndefined()
      expect(migratedRecord?.encryptedSnapshotB64).toEqual(expect.any(String))

      await persistence.deleteSnapshot(noteId)
      database.close()
    })
  })
})
