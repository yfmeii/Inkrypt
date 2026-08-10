import { act, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileToDataUrl } from '../../lib/attachments'
import { getDrawingAttachmentNames } from '../../lib/drawing'
import { useVaultDrawingController } from './drawings'

vi.mock('../../lib/attachments', async () => {
  const actual = await vi.importActual<typeof import('../../lib/attachments')>('../../lib/attachments')
  return {
    ...actual,
    fileToDataUrl: vi.fn(async () => 'data:image/png;base64,QQ=='),
  }
})

const mockedFileToDataUrl = vi.mocked(fileToDataUrl)

function useDrawingHarness(initialAttachments: Record<string, string> = {}) {
  const [draftAttachments, setDraftAttachments] = useState(initialAttachments)
  const blockNoteRef = useRef<any>({
    getMarkdown: vi.fn(() => ''),
    getEditor: vi.fn(() => null),
    insertDrawingCard: vi.fn(),
  })
  const syncDraftContentFromEditor = useRef(vi.fn()).current
  const controller = useVaultDrawingController({
    canOpenDrawing: true,
    draftAttachments,
    setDraftAttachments,
    blockNoteRef,
    draftContentRef: { current: '' },
    setError: vi.fn(),
    closeAttachments: vi.fn(),
    downloadAttachment: vi.fn(),
    syncDraftContentFromEditor,
  })

  return {
    controller,
    draftAttachments,
    blockNoteRef,
    syncDraftContentFromEditor,
  }
}

describe('useVaultDrawingController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockedFileToDataUrl.mockClear()
  })

  afterEach(() => vi.useRealTimers())

  it('resolves a pending slash insertion with null when the editor closes', async () => {
    const { result } = renderHook(() => useDrawingHarness())
    let insertionPromise!: Promise<unknown>

    act(() => {
      insertionPromise = result.current.controller.requestInsertDrawing()
    })
    act(() => result.current.controller.handleEditorOpenChange(false))

    await expect(insertionPromise).resolves.toBeNull()
  })

  it('saves drawing attachments and resolves the pending insertion', async () => {
    const { result } = renderHook(() => useDrawingHarness())
    let insertionPromise!: Promise<unknown>

    act(() => {
      insertionPromise = result.current.controller.requestInsertDrawing()
    })
    await act(async () => {
      await result.current.controller.saveDrawing({
        drawingId: 'drawing-1',
        title: 'Architecture',
        sceneJson: '{"elements":[]}',
        previewBlob: new Blob(['preview'], { type: 'image/png' }),
      })
    })

    const attachmentNames = getDrawingAttachmentNames('drawing-1')
    expect(result.current.draftAttachments[attachmentNames.scene]).toMatch(/^data:application\/json;base64,/)
    expect(result.current.draftAttachments[attachmentNames.preview]).toBe('data:image/png;base64,QQ==')
    await expect(insertionPromise).resolves.toEqual({
      drawingId: 'drawing-1',
      previewFilename: attachmentNames.preview,
      sceneFilename: attachmentNames.scene,
      title: 'Architecture',
    })
  })

  it('deletes the drawing card and both generated attachments', () => {
    const attachmentNames = getDrawingAttachmentNames('drawing-1')
    const removeBlocks = vi.fn()
    const { result } = renderHook(() => useDrawingHarness({
      [attachmentNames.scene]: 'scene',
      [attachmentNames.preview]: 'preview',
      'keep.txt': 'keep',
    }))
    result.current.blockNoteRef.current.getEditor = vi.fn(() => ({ removeBlocks }))

    act(() => {
      result.current.controller.requestDeleteDrawing({
        blockId: 'block-1',
        drawingId: 'drawing-1',
        title: 'Architecture',
      })
    })
    act(() => result.current.controller.confirmDeleteDrawing())
    act(() => vi.runAllTimers())

    expect(removeBlocks).toHaveBeenCalledWith(['block-1'])
    expect(result.current.draftAttachments).toEqual({ 'keep.txt': 'keep' })
    expect(result.current.syncDraftContentFromEditor).toHaveBeenCalledTimes(1)
  })

  it('resolves a pending insertion when the selected note resets', async () => {
    const { result } = renderHook(() => useDrawingHarness())
    let insertionPromise!: Promise<unknown>
    act(() => {
      insertionPromise = result.current.controller.requestInsertDrawing()
    })

    act(() => result.current.controller.resetDrawingState())

    await expect(insertionPromise).resolves.toBeNull()
    expect(result.current.controller.editorOpen).toBe(false)
    expect(result.current.controller.activeDrawingId).toBeNull()
  })
})
