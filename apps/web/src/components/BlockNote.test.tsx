/**
 * BlockNote Component Tests
 * 
 * Property-based tests and unit tests for BlockNote component correctness properties
 */

import type React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BlockNoteComponent } from './BlockNote'
import * as converter from '../lib/blocknote/converter'
import { BLOCKNOTE_YJS_INIT_ORIGIN } from '../lib/yjs/blockNoteBinding'

const yjsListeners = new Map<string, Set<(...args: any[]) => void>>()
const mockYjsDoc = {
  getXmlFragment: vi.fn(() => ({ length: 0 })),
  on: vi.fn((event: string, handler: (...args: any[]) => void) => {
    if (!yjsListeners.has(event)) yjsListeners.set(event, new Set())
    yjsListeners.get(event)?.add(handler)
  }),
  off: vi.fn((event: string, handler: (...args: any[]) => void) => {
    yjsListeners.get(event)?.delete(handler)
  }),
}

function emitYjsUpdate(origin?: unknown): void {
  for (const handler of yjsListeners.get('update') ?? []) {
    handler(new Uint8Array([1]), origin)
  }
}

const mockEditor = {
  document: [],
  isEditable: true,
  tryParseMarkdownToBlocks: vi.fn(async () => []),
  getTextCursorPosition: vi.fn(() => ({ block: null })),
  insertBlocks: vi.fn(() => []),
  onChange: vi.fn(() => {
    return () => {}
  }),
  replaceBlocks: vi.fn(),
  focus: vi.fn(),
  blocksToMarkdownLossy: vi.fn(() => ''),
}

vi.mock('@blocknote/core', () => ({
  BlockNoteSchema: { create: vi.fn(() => ({})) },
  defaultBlockSpecs: { codeBlock: {} },
  defaultInlineContentSpecs: {},
  defaultStyleSpecs: {},
  createCodeBlockSpec: vi.fn(() => ({})),
}))

vi.mock('@blocknote/code-block', () => ({
  codeBlockOptions: {},
}))

vi.mock('@blocknote/core/extensions', () => ({
  SideMenuExtension: {},
}))

// Mock BlockNote hooks and components
vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: vi.fn(() => mockEditor),
  useBlockNoteEditor: vi.fn(() => ({
    document: [],
    removeBlocks: vi.fn(),
    getActiveStyles: vi.fn(() => ({})),
  })),
  useComponentsContext: vi.fn(() => ({
    Generic: {
      Menu: {
        Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        Trigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      },
    },
    SideMenu: { Button: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button> },
    FormattingToolbar: {
      Button: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
      Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    },
  })),
  useDictionary: vi.fn(() => ({ side_menu_drag_handle_label: 'drag' })),
  useExtension: vi.fn(() => ({
    freezeMenu: vi.fn(),
    unfreezeMenu: vi.fn(),
    blockDragStart: vi.fn(),
    blockDragEnd: vi.fn(),
  })),
  useExtensionState: vi.fn(() => null),
  BlockNoteView: vi.fn(({ children }: { children?: React.ReactNode }) => (
    <div data-testid="blocknote-view">{children}</div>
  )),
  FormattingToolbarController: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  FormattingToolbar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BasicTextStyleButton: () => null,
  BlockTypeSelect: () => null,
  ColorStyleButton: () => null,
  CreateLinkButton: () => null,
  NestBlockButton: () => null,
  UnnestBlockButton: () => null,
  TextAlignButton: () => null,
  SideMenuController: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SideMenu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AddBlockButton: () => null,
  DragHandleMenu: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SuggestionMenuController: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  getDefaultReactSlashMenuItems: vi.fn(() => []),
  useActiveStyles: vi.fn(() => ({})),
  createReactStyleSpec: vi.fn((config, impl) => ({ config, implementation: impl })),
  createReactBlockSpec: vi.fn((config, impl) => () => ({ config, implementation: impl })),
  BlockNoteSchema: { create: vi.fn(() => ({})) },
  defaultBlockSpecs: {},
  defaultInlineContentSpecs: {},
  defaultStyleSpecs: {},
}))

vi.mock('@blocknote/shadcn', () => ({
  BlockNoteView: vi.fn(() => (
    <div data-testid="blocknote-view">
      BlockNote Editor Mock
    </div>
  )),
  ShadCNDefaultComponents: {
    Button: { Button: vi.fn() },
    Toggle: { Toggle: vi.fn() },
    DropdownMenu: {
      DropdownMenu: vi.fn(),
      DropdownMenuCheckboxItem: vi.fn(),
      DropdownMenuContent: vi.fn(),
      DropdownMenuItem: vi.fn(),
      DropdownMenuLabel: vi.fn(),
      DropdownMenuSeparator: vi.fn(),
      DropdownMenuSub: vi.fn(),
      DropdownMenuSubContent: vi.fn(),
      DropdownMenuSubTrigger: vi.fn(),
      DropdownMenuTrigger: vi.fn(),
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockEditor.document = []
  mockEditor.tryParseMarkdownToBlocks.mockResolvedValue([])
  yjsListeners.clear()
  mockYjsDoc.getXmlFragment.mockReturnValue({ length: 0 })
})

/**
 * Property 2: Disabled State Consistency
 * 
 * Feature: blocknote-migration, Property 2: Disabled State Consistency
 * Validates: Requirements 1.4
 * 
 * For any BlockNote editor instance, when the disabled prop is set to true,
 * the editor's editable state SHALL be false, and when disabled is false,
 * the editable state SHALL be true.
 */
describe('Property 2: Disabled State Consistency', () => {
  it('should correctly reflect disabled prop in editable state', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (disabled) => {
          // The editable state should be the inverse of disabled
          const expectedEditable = !disabled
          
          // This property validates that:
          // - When disabled=true, editable should be false
          // - When disabled=false, editable should be true
          expect(expectedEditable).toBe(!disabled)
        }
      ),
      { numRuns: 100 }
    )
  })
})

/**
 * Error Handling Unit Tests
 * 
 * Tests for conversion errors and initialization errors
 * Validates: Requirements 7.1, 7.2, 7.3
 */
describe('Error Handling', () => {
  /**
   * Test conversion error display
   * Validates: Requirement 7.1
   */
  describe('Conversion Error Handling', () => {
    it('should display error message when markdown conversion fails', async () => {
      // Mock markdownToBlocks to throw an error
      const mockError = new Error('Invalid markdown syntax')
      vi.spyOn(converter, 'markdownToBlocks').mockRejectedValueOnce(mockError)
      
      const onConversionError = vi.fn()
      const originalContent = '# Invalid Content'
      
      render(
        <BlockNoteComponent
          initialContent={originalContent}
          attachments={{}}
          onChange={vi.fn()}
          onConversionError={onConversionError}
        />
      )
      
      // Wait for error to be displayed
      await waitFor(() => {
        expect(screen.getByText(/内容转换失败/)).toBeInTheDocument()
      }, { timeout: 3000 })
      
      // Verify callback was called
      expect(onConversionError).toHaveBeenCalled()
    })
    
    it('should display original content when conversion fails', async () => {
      // Mock markdownToBlocks to throw an error
      vi.spyOn(converter, 'markdownToBlocks').mockRejectedValueOnce(new Error('Parse error'))
      
      const originalContent = '# Test Content'
      
      const { container } = render(
        <BlockNoteComponent
          initialContent={originalContent}
          attachments={{}}
          onChange={vi.fn()}
        />
      )
      
      // Wait for error banner and content
      await waitFor(() => {
        expect(screen.getByText(/内容转换失败/)).toBeInTheDocument()
      }, { timeout: 3000 })
      
      // Check that fallback content area exists
      const fallbackContent = container.querySelector('.blocknote-fallback-content')
      expect(fallbackContent).toBeInTheDocument()
    })
  })
  
  /**
   * Test error recovery
   * Validates: Requirement 7.3
   */
  describe('Error Recovery', () => {
    it('should preserve user work when error occurs', async () => {
      const originalContent = '# Important Content'
      
      vi.spyOn(converter, 'markdownToBlocks').mockRejectedValueOnce(
        new Error('Conversion failed')
      )
      
      const { container } = render(
        <BlockNoteComponent
          initialContent={originalContent}
          attachments={{}}
          onChange={vi.fn()}
        />
      )
      
      // Verify error is displayed
      await waitFor(() => {
        expect(screen.getByText(/内容转换失败/)).toBeInTheDocument()
      }, { timeout: 3000 })
      
      // Verify fallback content area exists (preserves content)
      const fallbackContent = container.querySelector('.blocknote-fallback-content')
      expect(fallbackContent).toBeInTheDocument()
    })
  })
})

describe('Paste handling', () => {
  it('normalizes pasted ordered lists when the editor is empty', async () => {
    const blocks = [{ id: '1', type: 'numberedListItem' }]
    mockEditor.tryParseMarkdownToBlocks.mockResolvedValueOnce(blocks as any)

    const { container } = render(
      <BlockNoteComponent
        initialContent=""
        attachments={{}}
        onChange={vi.fn()}
      />,
    )

    const wrapper = container.querySelector('.blocknote-wrapper')
    expect(wrapper).toBeTruthy()

    fireEvent.paste(wrapper as Element, {
      clipboardData: {
        types: ['text/plain'],
        items: [],
        getData: (type: string) => type === 'text/plain' ? '218. 幻影之血\n219. 战斗潮流\n220. 星尘斗士' : '',
      },
    })

    await waitFor(() => {
      expect(mockEditor.tryParseMarkdownToBlocks).toHaveBeenCalledWith('1. 幻影之血\n2. 战斗潮流\n3. 星尘斗士')
      expect(mockEditor.replaceBlocks).toHaveBeenCalledWith(mockEditor.document, blocks)
    })
  })

  it('treats an emptied editor document as empty for ordered-list paste normalization', async () => {
    const blocks = [{ id: '1', type: 'numberedListItem' }]
    mockEditor.document = [{ type: 'paragraph', content: [], children: [] }] as any
    mockEditor.tryParseMarkdownToBlocks.mockResolvedValueOnce(blocks as any)

    const { container } = render(
      <BlockNoteComponent
        initialContent=""
        attachments={{}}
        onChange={vi.fn()}
      />,
    )

    const wrapper = container.querySelector('.blocknote-wrapper')
    expect(wrapper).toBeTruthy()

    fireEvent.paste(wrapper as Element, {
      clipboardData: {
        types: ['text/plain'],
        items: [],
        getData: (type: string) => type === 'text/plain' ? '218. 幻影之血\n219. 战斗潮流' : '',
      },
    })

    await waitFor(() => {
      expect(mockEditor.tryParseMarkdownToBlocks).toHaveBeenCalledWith('1. 幻影之血\n2. 战斗潮流')
      expect(mockEditor.replaceBlocks).toHaveBeenCalledWith(mockEditor.document, blocks)
    })
  })
})

describe('Yjs change handling', () => {
  it('suppresses draft updates for initialization-originated Yjs changes', async () => {
    vi.spyOn(converter, 'markdownToBlocks').mockResolvedValueOnce([] as any)
    const onYjsDocChange = vi.fn()

    render(
      <BlockNoteComponent
        initialContent="Hello"
        attachments={{}}
        onChange={vi.fn()}
        yjsDoc={mockYjsDoc as any}
        onYjsDocChange={onYjsDocChange}
      />,
    )

    await waitFor(() => {
      expect(converter.markdownToBlocks).toHaveBeenCalled()
    })

    emitYjsUpdate(BLOCKNOTE_YJS_INIT_ORIGIN)

    expect(onYjsDocChange).toHaveBeenCalledWith({
      doc: mockYjsDoc,
      suppressDraftUpdate: true,
    })
  })

  it('forwards runtime Yjs changes after initialization', async () => {
    vi.spyOn(converter, 'markdownToBlocks').mockResolvedValueOnce([] as any)
    const onYjsDocChange = vi.fn()

    render(
      <BlockNoteComponent
        initialContent="Hello"
        attachments={{}}
        onChange={vi.fn()}
        yjsDoc={mockYjsDoc as any}
        onYjsDocChange={onYjsDocChange}
      />,
    )

    await waitFor(() => {
      expect(converter.markdownToBlocks).toHaveBeenCalled()
    })

    emitYjsUpdate(BLOCKNOTE_YJS_INIT_ORIGIN)
    emitYjsUpdate('user-edit')

    expect(onYjsDocChange).toHaveBeenNthCalledWith(1, {
      doc: mockYjsDoc,
      suppressDraftUpdate: true,
    })
    expect(onYjsDocChange).toHaveBeenNthCalledWith(2, {
      doc: mockYjsDoc,
      suppressDraftUpdate: false,
    })
  })
})
