import { describe, test, expect } from 'vitest'
import * as fc from 'fast-check'
import * as Y from 'yjs'
import { encodeYDoc, decodeYDoc, mergeYDocs, areYDocsEqual } from './serializer'

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

describe('YjsSerializer', () => {
  describe('Property 1: Serialization Round-Trip', () => {
    /**
     * Feature: yjs-crdt-sync, Property 1: Serialization Round-Trip
     * Validates: Requirements 3.1, 3.2, 3.3
     *
     * For any valid Y.Doc instance, encoding to base64 then decoding back
     * SHALL produce an equivalent Y.Doc with identical content.
     */
    test('encoding then decoding produces equivalent Y.Doc', () => {
      fc.assert(
        fc.property(yDocArbitrary, (doc) => {
          const encoded = encodeYDoc(doc)
          const decoded = decodeYDoc(encoded)

          // Verify the documents are equal
          expect(areYDocsEqual(doc, decoded)).toBe(true)

          // Verify content is preserved
          const originalText = doc.getText('content').toString()
          const decodedText = decoded.getText('content').toString()
          expect(decodedText).toBe(originalText)
        }),
        { numRuns: 100 }
      )
    })

    test('double encoding produces same result', () => {
      fc.assert(
        fc.property(yDocArbitrary, (doc) => {
          const encoded1 = encodeYDoc(doc)
          const decoded = decodeYDoc(encoded1)
          const encoded2 = encodeYDoc(decoded)

          // encode(decode(encode(doc))) === encode(doc)
          expect(encoded2).toBe(encoded1)
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('Property 2: CRDT Merge Preserves All Changes', () => {
    /**
     * Feature: yjs-crdt-sync, Property 2: CRDT Merge Preserves All Changes
     * Validates: Requirements 5.3
     *
     * For any two Y.Doc instances with independent edits, merging them
     * SHALL preserve all changes from both documents without data loss.
     */
    test('merge preserves all changes from both documents', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
          fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
          (stringsA, stringsB) => {
            // Create base document
            const baseDoc = new Y.Doc()
            const baseText = baseDoc.getText('content')
            baseText.insert(0, 'base')

            // Create two independent copies
            const docA = new Y.Doc()
            const docB = new Y.Doc()
            
            // Apply base state to both
            const baseUpdate = Y.encodeStateAsUpdate(baseDoc)
            Y.applyUpdate(docA, baseUpdate)
            Y.applyUpdate(docB, baseUpdate)

            // Apply independent edits to docA
            const textA = docA.getText('content')
            stringsA.forEach((str, i) => {
              textA.insert(textA.length, ` A${i}:${str}`)
            })

            // Apply independent edits to docB
            const textB = docB.getText('content')
            stringsB.forEach((str, i) => {
              textB.insert(textB.length, ` B${i}:${str}`)
            })

            // Get content before merge
            const contentA = textA.toString()
            const contentB = textB.toString()

            // Merge docB into docA
            mergeYDocs(docA, docB)

            // Get merged content
            const mergedContent = docA.getText('content').toString()

            // Verify all content from A is preserved
            expect(mergedContent).toContain('base')
            stringsA.forEach((str, i) => {
              expect(mergedContent).toContain(`A${i}:${str}`)
            })

            // Verify all content from B is preserved
            stringsB.forEach((str, i) => {
              expect(mergedContent).toContain(`B${i}:${str}`)
            })
          }
        ),
        { numRuns: 100 }
      )
    })

    test('merge preserves content regardless of merge order', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 5 }),
          fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 5 }),
          (stringsA, stringsB) => {
            // Create base document
            const baseDoc = new Y.Doc()
            const baseText = baseDoc.getText('content')
            baseText.insert(0, 'base')

            // Create two independent copies for merge(A, B)
            const docA1 = new Y.Doc()
            const docB1 = new Y.Doc()
            
            const baseUpdate = Y.encodeStateAsUpdate(baseDoc)
            Y.applyUpdate(docA1, baseUpdate)
            Y.applyUpdate(docB1, baseUpdate)

            // Apply edits
            const textA1 = docA1.getText('content')
            stringsA.forEach((str, i) => {
              textA1.insert(textA1.length, ` A${i}:${str}`)
            })

            const textB1 = docB1.getText('content')
            stringsB.forEach((str, i) => {
              textB1.insert(textB1.length, ` B${i}:${str}`)
            })

            // Create two independent copies for merge(B, A)
            const docA2 = new Y.Doc()
            const docB2 = new Y.Doc()
            
            Y.applyUpdate(docA2, baseUpdate)
            Y.applyUpdate(docB2, baseUpdate)

            const textA2 = docA2.getText('content')
            stringsA.forEach((str, i) => {
              textA2.insert(textA2.length, ` A${i}:${str}`)
            })

            const textB2 = docB2.getText('content')
            stringsB.forEach((str, i) => {
              textB2.insert(textB2.length, ` B${i}:${str}`)
            })

            // Merge in both directions
            mergeYDocs(docA1, docB1) // merge(A, B)
            mergeYDocs(docB2, docA2) // merge(B, A)

            // Both should contain all content (order may differ for concurrent insertions)
            const contentA1 = docA1.getText('content').toString()
            const contentB2 = docB2.getText('content').toString()
            
            // Verify all content is present in both
            expect(contentA1).toContain('base')
            expect(contentB2).toContain('base')
            
            stringsA.forEach((str, i) => {
              expect(contentA1).toContain(`A${i}:${str}`)
              expect(contentB2).toContain(`A${i}:${str}`)
            })
            
            stringsB.forEach((str, i) => {
              expect(contentA1).toContain(`B${i}:${str}`)
              expect(contentB2).toContain(`B${i}:${str}`)
            })
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  describe('Property 3: Convergence After Concurrent Edits', () => {
    /**
     * Feature: yjs-crdt-sync, Property 3: Convergence After Concurrent Edits
     * Validates: Requirements 8.1
     *
     * For any set of concurrent edits applied to copies of the same Y.Doc,
     * after all documents merge with each other, they SHALL converge to identical state.
     */
    test('documents converge after bidirectional merge', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 5 }),
          fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 5 }),
          (editsA, editsB) => {
            // Create initial document
            const initialDoc = new Y.Doc()
            const initialText = initialDoc.getText('content')
            initialText.insert(0, 'initial')

            // Create two independent copies
            const docA = new Y.Doc()
            const docB = new Y.Doc()
            
            const initialUpdate = Y.encodeStateAsUpdate(initialDoc)
            Y.applyUpdate(docA, initialUpdate)
            Y.applyUpdate(docB, initialUpdate)

            // Apply concurrent edits to docA
            const textA = docA.getText('content')
            editsA.forEach((edit, i) => {
              textA.insert(textA.length, ` A${i}:${edit}`)
            })

            // Apply concurrent edits to docB
            const textB = docB.getText('content')
            editsB.forEach((edit, i) => {
              textB.insert(textB.length, ` B${i}:${edit}`)
            })

            // Simulate sync: merge in both directions
            mergeYDocs(docA, docB) // A receives B's changes
            mergeYDocs(docB, docA) // B receives A's changes (including merged state)

            // After bidirectional merge, documents should converge
            expect(areYDocsEqual(docA, docB)).toBe(true)

            // Verify both contain all edits
            const finalContentA = docA.getText('content').toString()
            const finalContentB = docB.getText('content').toString()
            
            expect(finalContentA).toBe(finalContentB)
            expect(finalContentA).toContain('initial')
            
            editsA.forEach((edit, i) => {
              expect(finalContentA).toContain(`A${i}:${edit}`)
            })
            
            editsB.forEach((edit, i) => {
              expect(finalContentA).toContain(`B${i}:${edit}`)
            })
          }
        ),
        { numRuns: 100 }
      )
    })

    test('three-way convergence', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }),
          fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }),
          (editsA, editsB, editsC) => {
            // Create initial document
            const initialDoc = new Y.Doc()
            const initialText = initialDoc.getText('content')
            initialText.insert(0, 'start')

            // Create three independent copies
            const docA = new Y.Doc()
            const docB = new Y.Doc()
            const docC = new Y.Doc()
            
            const initialUpdate = Y.encodeStateAsUpdate(initialDoc)
            Y.applyUpdate(docA, initialUpdate)
            Y.applyUpdate(docB, initialUpdate)
            Y.applyUpdate(docC, initialUpdate)

            // Apply concurrent edits
            const textA = docA.getText('content')
            editsA.forEach((edit, i) => {
              textA.insert(textA.length, ` A${i}:${edit}`)
            })

            const textB = docB.getText('content')
            editsB.forEach((edit, i) => {
              textB.insert(textB.length, ` B${i}:${edit}`)
            })

            const textC = docC.getText('content')
            editsC.forEach((edit, i) => {
              textC.insert(textC.length, ` C${i}:${edit}`)
            })

            // Simulate full mesh sync
            mergeYDocs(docA, docB)
            mergeYDocs(docA, docC)
            mergeYDocs(docB, docA)
            mergeYDocs(docB, docC)
            mergeYDocs(docC, docA)
            mergeYDocs(docC, docB)

            // All three should converge
            expect(areYDocsEqual(docA, docB)).toBe(true)
            expect(areYDocsEqual(docB, docC)).toBe(true)
            expect(areYDocsEqual(docA, docC)).toBe(true)
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})
