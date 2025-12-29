/**
 * BlockNote 绑定层单元测试
 * 
 * 测试 BlockNote blocks 与 Y.Doc 之间的转换
 * Validates: Requirements 2.2, 2.3
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { BlockNoteEditor } from '@blocknote/core'
import type { Block, PartialBlock } from '@blocknote/core'
import { YjsBlockNoteBinding } from './blockNoteBinding'

/**
 * 创建测试用的 BlockNote 编辑器实例
 */
function createTestEditor(): BlockNoteEditor {
  return BlockNoteEditor.create()
}

describe('YjsBlockNoteBinding', () => {
  let editor: BlockNoteEditor
  let doc: Y.Doc
  let binding: YjsBlockNoteBinding

  beforeEach(() => {
    editor = createTestEditor()
    doc = new Y.Doc()
    binding = new YjsBlockNoteBinding(doc, editor)
  })

  afterEach(() => {
    ;(editor as any)?._tiptapEditor?.destroy?.()
  })

  describe('initialization', () => {
    it('should create a binding with default fragment name', () => {
      expect(binding.getFragmentName()).toBe('document-store')
      expect(binding.getFragment()).toBeDefined()
    })

    it('should create a binding with custom fragment name', () => {
      const customBinding = new YjsBlockNoteBinding(doc, editor, 'custom-fragment')
      expect(customBinding.getFragmentName()).toBe('custom-fragment')
    })

    it('should return the same fragment from Y.Doc', () => {
      const fragment1 = binding.getFragment()
      const fragment2 = doc.getXmlFragment('document-store')
      expect(fragment1).toBe(fragment2)
    })
  })

  describe('initializeFromBlocks', () => {
    it('should initialize Y.Doc from empty blocks array', () => {
      const blocks: PartialBlock[] = []
      binding.initializeFromBlocks(blocks)
      
      const exported = binding.exportToBlocks()
      expect(exported).toEqual([])
    })

    it('should initialize Y.Doc from single paragraph block', () => {
      const blocks: PartialBlock[] = [
        {
          type: 'paragraph',
          content: 'Hello, world!'
        }
      ]
      
      binding.initializeFromBlocks(blocks)
      
      const exported = binding.exportToBlocks()
      expect(exported).toHaveLength(1)
      expect(exported[0].type).toBe('paragraph')
      expect(exported[0].content).toEqual([
        {
          type: 'text',
          text: 'Hello, world!',
          styles: {}
        }
      ])
    })

    it('should initialize Y.Doc from multiple blocks', () => {
      const blocks: PartialBlock[] = [
        {
          type: 'heading',
          props: { level: 1 },
          content: 'Title'
        },
        {
          type: 'paragraph',
          content: 'First paragraph'
        },
        {
          type: 'paragraph',
          content: 'Second paragraph'
        }
      ]
      
      binding.initializeFromBlocks(blocks)
      
      const exported = binding.exportToBlocks()
      expect(exported).toHaveLength(3)
      expect(exported[0].type).toBe('heading')
      expect(exported[1].type).toBe('paragraph')
      expect(exported[2].type).toBe('paragraph')
    })

    it('should replace existing content when called multiple times', () => {
      // First initialization
      const blocks1: PartialBlock[] = [
        {
          type: 'paragraph',
          content: 'First content'
        }
      ]
      binding.initializeFromBlocks(blocks1)
      
      let exported = binding.exportToBlocks()
      expect(exported).toHaveLength(1)
      
      // Second initialization should replace
      const blocks2: PartialBlock[] = [
        {
          type: 'paragraph',
          content: 'Second content'
        },
        {
          type: 'paragraph',
          content: 'Third content'
        }
      ]
      binding.initializeFromBlocks(blocks2)
      
      exported = binding.exportToBlocks()
      expect(exported).toHaveLength(2)
      expect(exported[0].content).toEqual([
        {
          type: 'text',
          text: 'Second content',
          styles: {}
        }
      ])
    })

    it('should handle blocks with nested content', () => {
      const blocks: PartialBlock[] = [
        {
          type: 'bulletListItem',
          content: 'Item 1',
          children: [
            {
              type: 'bulletListItem',
              content: 'Nested item'
            }
          ]
        }
      ]
      
      binding.initializeFromBlocks(blocks)
      
      const exported = binding.exportToBlocks()
      expect(exported).toHaveLength(1)
      expect(exported[0].type).toBe('bulletListItem')
      expect(exported[0].children).toHaveLength(1)
      expect(exported[0].children![0].type).toBe('bulletListItem')
    })

    it('should handle blocks with different types', () => {
      const blocks: PartialBlock[] = [
        {
          type: 'heading',
          props: { level: 2 },
          content: 'Heading'
        },
        {
          type: 'bulletListItem',
          content: 'List item'
        },
        {
          type: 'numberedListItem',
          content: 'Numbered item'
        },
        {
          type: 'checkListItem',
          props: { checked: false },
          content: 'Todo item'
        }
      ]
      
      binding.initializeFromBlocks(blocks)
      
      const exported = binding.exportToBlocks()
      expect(exported).toHaveLength(4)
      expect(exported[0].type).toBe('heading')
      expect(exported[1].type).toBe('bulletListItem')
      expect(exported[2].type).toBe('numberedListItem')
      expect(exported[3].type).toBe('checkListItem')
    })
  })

  describe('exportToBlocks', () => {
    it('should export empty Y.Doc as empty blocks array', () => {
      const exported = binding.exportToBlocks()
      expect(exported).toEqual([])
    })

    it('should export Y.Doc content as blocks', () => {
      // Initialize with some content
      const blocks: PartialBlock[] = [
        {
          type: 'paragraph',
          content: 'Test content'
        }
      ]
      binding.initializeFromBlocks(blocks)
      
      // Export and verify
      const exported = binding.exportToBlocks()
      expect(exported).toHaveLength(1)
      expect(exported[0].type).toBe('paragraph')
    })

    it('should export complex document structure', () => {
      const blocks: PartialBlock[] = [
        {
          type: 'heading',
          props: { level: 1 },
          content: 'Main Title'
        },
        {
          type: 'paragraph',
          content: 'Introduction paragraph'
        },
        {
          type: 'heading',
          props: { level: 2 },
          content: 'Section'
        },
        {
          type: 'bulletListItem',
          content: 'Point 1'
        },
        {
          type: 'bulletListItem',
          content: 'Point 2'
        }
      ]
      
      binding.initializeFromBlocks(blocks)
      
      const exported = binding.exportToBlocks()
      expect(exported).toHaveLength(5)
      expect(exported[0].type).toBe('heading')
      expect(exported[2].type).toBe('heading')
      expect(exported[3].type).toBe('bulletListItem')
    })
  })

  describe('round-trip conversion', () => {
    it('should preserve content through blocks → Y.Doc → blocks conversion', () => {
      const originalBlocks: PartialBlock[] = [
        {
          type: 'heading',
          props: { level: 1 },
          content: 'Title'
        },
        {
          type: 'paragraph',
          content: 'Content'
        }
      ]
      
      binding.initializeFromBlocks(originalBlocks)
      const exported = binding.exportToBlocks()
      
      expect(exported).toHaveLength(2)
      expect(exported[0].type).toBe('heading')
      expect(exported[1].type).toBe('paragraph')
    })

    it('should preserve text content exactly', () => {
      const text = 'This is a test with special characters: !@#$%^&*()'
      const blocks: PartialBlock[] = [
        {
          type: 'paragraph',
          content: text
        }
      ]
      
      binding.initializeFromBlocks(blocks)
      const exported = binding.exportToBlocks()
      
      expect(exported[0].content).toEqual([
        {
          type: 'text',
          text,
          styles: {}
        }
      ])
    })

    it('should preserve block properties', () => {
      const blocks: PartialBlock[] = [
        {
          type: 'heading',
          props: { level: 3 },
          content: 'H3 Heading'
        },
        {
          type: 'checkListItem',
          props: { checked: true },
          content: 'Completed task'
        }
      ]
      
      binding.initializeFromBlocks(blocks)
      const exported = binding.exportToBlocks()
      
      // BlockNote adds default properties, so we check that our properties are included
      expect(exported[0].props).toMatchObject({ level: 3 })
      expect(exported[1].props).toMatchObject({ checked: true })
    })

    it('should preserve nested structure', () => {
      const blocks: PartialBlock[] = [
        {
          type: 'bulletListItem',
          content: 'Parent',
          children: [
            {
              type: 'bulletListItem',
              content: 'Child 1'
            },
            {
              type: 'bulletListItem',
              content: 'Child 2',
              children: [
                {
                  type: 'bulletListItem',
                  content: 'Grandchild'
                }
              ]
            }
          ]
        }
      ]
      
      binding.initializeFromBlocks(blocks)
      const exported = binding.exportToBlocks()
      
      expect(exported).toHaveLength(1)
      expect(exported[0].children).toHaveLength(2)
      expect(exported[0].children![1].children).toHaveLength(1)
    })
  })

  describe('Y.Doc integration', () => {
    it('should work with Y.Doc transactions', () => {
      const blocks: PartialBlock[] = [
        {
          type: 'paragraph',
          content: 'Initial'
        }
      ]
      
      doc.transact(() => {
        binding.initializeFromBlocks(blocks)
      })
      
      const exported = binding.exportToBlocks()
      expect(exported).toHaveLength(1)
    })

    it('should allow multiple bindings to same Y.Doc with different fragments', () => {
      const binding1 = new YjsBlockNoteBinding(doc, editor, 'fragment1')
      const binding2 = new YjsBlockNoteBinding(doc, editor, 'fragment2')
      
      const blocks1: PartialBlock[] = [{ type: 'paragraph', content: 'Fragment 1' }]
      const blocks2: PartialBlock[] = [{ type: 'paragraph', content: 'Fragment 2' }]
      
      binding1.initializeFromBlocks(blocks1)
      binding2.initializeFromBlocks(blocks2)
      
      const exported1 = binding1.exportToBlocks()
      const exported2 = binding2.exportToBlocks()
      
      expect(exported1).toHaveLength(1)
      expect(exported2).toHaveLength(1)
      expect(exported1[0].content).not.toEqual(exported2[0].content)
    })
  })
})
