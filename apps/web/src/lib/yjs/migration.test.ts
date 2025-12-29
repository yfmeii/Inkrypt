import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { BlockNoteEditor } from '@blocknote/core'
import type { NotePayload } from '../crypto'
import { detectNoteFormat, migrateToYjs, type YjsNotePayload } from './migration'
import { JSON_PREFIX } from '../blocknote/converter'
import { decodeYDoc } from './serializer'

/**
 * 创建一个 BlockNote 编辑器实例用于测试
 */
function createTestEditor(): BlockNoteEditor {
  return BlockNoteEditor.create()
}

describe('Migration', () => {
  let editor: BlockNoteEditor

  beforeEach(() => {
    editor = createTestEditor()
  })

  afterEach(() => {
    ;(editor as any)?._tiptapEditor?.destroy?.()
  })

  describe('detectNoteFormat', () => {
    test('detects legacy format without yjs fields', () => {
      const payload: NotePayload = {
        meta: {
          title: 'Test Note',
          created_at: Date.now(),
          tags: [],
          is_favorite: false,
        },
        content: 'Hello world',
        attachments: {},
      }

      expect(detectNoteFormat(payload)).toBe('legacy')
    })

    test('detects legacy format with only format field', () => {
      const payload: YjsNotePayload = {
        meta: {
          title: 'Test Note',
          created_at: Date.now(),
          tags: [],
          is_favorite: false,
        },
        content: 'Hello world',
        attachments: {},
        format: 'blocknote+yjs-v1',
        // Missing yjsSnapshotB64
      }

      expect(detectNoteFormat(payload)).toBe('legacy')
    })

    test('detects legacy format with only snapshot field', () => {
      const payload: YjsNotePayload = {
        meta: {
          title: 'Test Note',
          created_at: Date.now(),
          tags: [],
          is_favorite: false,
        },
        content: 'Hello world',
        attachments: {},
        yjsSnapshotB64: 'some-base64-data',
        // Missing format field
      }

      expect(detectNoteFormat(payload)).toBe('legacy')
    })

    test('detects yjs format with both required fields', () => {
      const payload: YjsNotePayload = {
        meta: {
          title: 'Test Note',
          created_at: Date.now(),
          tags: [],
          is_favorite: false,
        },
        content: 'Hello world',
        attachments: {},
        format: 'blocknote+yjs-v1',
        yjsSnapshotB64: 'some-base64-data',
      }

      expect(detectNoteFormat(payload)).toBe('yjs')
    })
  })

  describe('migrateToYjs', () => {
    test('migrates empty content', async () => {
      const payload: NotePayload = {
        meta: {
          title: 'Empty Note',
          created_at: Date.now(),
          tags: [],
          is_favorite: false,
        },
        content: '',
        attachments: {},
      }

      const result = await migrateToYjs(payload, editor)

      expect(result.doc).toBeDefined()
      expect(result.snapshot).toBeDefined()
      expect(result.blocks).toEqual([])
      expect(typeof result.snapshot).toBe('string')
      expect(result.snapshot.length).toBeGreaterThan(0)
    })

    test('migrates simple markdown content', async () => {
      const payload: NotePayload = {
        meta: {
          title: 'Simple Note',
          created_at: Date.now(),
          tags: [],
          is_favorite: false,
        },
        content: 'Hello world\nThis is a test',
        attachments: {},
      }

      const result = await migrateToYjs(payload, editor)

      expect(result.doc).toBeDefined()
      expect(result.snapshot).toBeDefined()
      expect(result.blocks.length).toBeGreaterThan(0)
      
      // Verify snapshot can be decoded
      const decodedDoc = decodeYDoc(result.snapshot)
      expect(decodedDoc).toBeDefined()
    })

    test('migrates BlockNote JSON content', async () => {
      const blocks = [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello', styles: {} }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'World', styles: {} }],
        },
      ]
      
      const payload: NotePayload = {
        meta: {
          title: 'JSON Note',
          created_at: Date.now(),
          tags: [],
          is_favorite: false,
        },
        content: JSON_PREFIX + JSON.stringify(blocks),
        attachments: {},
      }

      const result = await migrateToYjs(payload, editor)

      expect(result.doc).toBeDefined()
      expect(result.snapshot).toBeDefined()
      expect(result.blocks).toEqual(blocks)
    })
  })

  describe('Property 5: Migration Preserves Content', () => {
    /**
     * Feature: yjs-crdt-sync, Property 5: Migration Preserves Content
     * Validates: Requirements 6.1, 6.2
     *
     * For any legacy BlockNote content, migrating to Y.Doc format then
     * exporting back SHALL preserve the semantic content.
     */
    test('migration produces valid Y.Doc from markdown', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
            { minLength: 1, maxLength: 10 }
          ),
          async (lines) => {
            const content = lines.join('\n')
            
            const payload: NotePayload = {
              meta: {
                title: 'Test Note',
                created_at: Date.now(),
                tags: [],
                is_favorite: false,
              },
              content,
              attachments: {},
            }

            const result = await migrateToYjs(payload, editor)

            // Verify migration produced valid results
            if (!result.doc) return false
            if (!result.snapshot) return false
            if (!result.blocks) return false
            
            // Verify snapshot can be decoded
            const decodedDoc = decodeYDoc(result.snapshot)
            if (!decodedDoc) return false
            
            // Verify snapshot is valid base64
            if (!/^[A-Za-z0-9+/]+=*$/.test(result.snapshot)) return false
            
            // The key property: migration should not throw errors and produce valid output
            return true
          }
        ),
        { numRuns: 100 }
      )
    })

    test('migration preserves BlockNote JSON blocks', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              type: fc.constantFrom('paragraph', 'heading'),
              content: fc.array(
                fc.record({
                  type: fc.constant('text'),
                  text: fc.string({ minLength: 1, maxLength: 50 }),
                  styles: fc.constant({}),
                }),
                { minLength: 1, maxLength: 3 }
              ),
            }),
            { minLength: 1, maxLength: 5 }
          ),
          async (blocks) => {
            const content = JSON_PREFIX + JSON.stringify(blocks)
            
            const payload: NotePayload = {
              meta: {
                title: 'Test Note',
                created_at: Date.now(),
                tags: [],
                is_favorite: false,
              },
              content,
              attachments: {},
            }

            const result = await migrateToYjs(payload, editor)

            // Verify migration produced valid results
            if (!result.doc) return false
            if (!result.snapshot) return false
            
            // Verify blocks are preserved exactly when using JSON format
            if (JSON.stringify(result.blocks) !== JSON.stringify(blocks)) return false
            
            // Verify snapshot can be decoded
            const decodedDoc = decodeYDoc(result.snapshot)
            if (!decodedDoc) return false
            
            // Verify snapshot is valid base64
            if (!/^[A-Za-z0-9+/]+=*$/.test(result.snapshot)) return false
            
            return true
          }
        ),
        { numRuns: 100 }
      )
    })

    test('migration snapshot can be decoded', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
          async (lines) => {
            const content = lines.join('\n')
            
            const payload: NotePayload = {
              meta: {
                title: 'Test Note',
                created_at: Date.now(),
                tags: [],
                is_favorite: false,
              },
              content,
              attachments: {},
            }

            const result = await migrateToYjs(payload, editor)

            // Decode the snapshot
            const decodedDoc = decodeYDoc(result.snapshot)
            
            // The decoded doc should be valid
            if (!decodedDoc) return false
            
            // Verify the snapshot is a valid base64 string
            if (!/^[A-Za-z0-9+/]+=*$/.test(result.snapshot)) return false
            
            // The key property: snapshots can be decoded without errors
            return true
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})
