import { describe, test, expect, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import * as Y from 'yjs'
import { LocalPersistence } from './localPersistence'
import { encodeYDoc, decodeYDoc, areYDocsEqual } from './serializer'

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
            await persistence.saveSnapshot(noteId, snapshot)

            // Load from IndexedDB
            const loadedSnapshot = await persistence.loadSnapshot(noteId)

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
            const result = await persistence.loadSnapshot(noteId)
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
            await persistence.saveSnapshot(noteId, snapshot)

            // Verify it exists
            const loaded = await persistence.loadSnapshot(noteId)
            expect(loaded).toBe(snapshot)

            // Delete
            await persistence.deleteSnapshot(noteId)

            // Verify it's gone
            const afterDelete = await persistence.loadSnapshot(noteId)
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
            await persistence.saveSnapshot(noteId, snapshot1)

            // Overwrite with second snapshot
            await persistence.saveSnapshot(noteId, snapshot2)

            // Load should return the second snapshot
            const loaded = await persistence.loadSnapshot(noteId)
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
            await persistence.saveSnapshot(noteId1, snapshot1)
            await persistence.saveSnapshot(noteId2, snapshot2)

            // Load both
            const loaded1 = await persistence.loadSnapshot(noteId1)
            const loaded2 = await persistence.loadSnapshot(noteId2)

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
  })
})
