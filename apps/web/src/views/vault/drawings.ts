import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { BlockNoteComponentRef } from '../../components/BlockNote'
import { estimateDataUrlBytes, fileToDataUrl } from '../../lib/attachments'
import {
  createDrawingId,
  getAttachmentNameFromUrl,
  getDrawingAttachmentNames,
  getDrawingIdFromAttachment,
  MAX_DRAWING_PREVIEW_BYTES,
  MAX_DRAWING_SCENE_BYTES,
  parseDrawingSceneData,
  sceneJsonToDataUrl,
  type DrawingInitialData,
} from '../../lib/drawing'
import { formatErrorZh } from '../../lib/errors'
import { countAttachmentRefs } from './attachments'

export type DrawingInsertResult = {
  drawingId: string
  previewFilename: string
  sceneFilename: string
  title: string
}

export type DrawingDeleteRequest = {
  blockId: string
  drawingId: string
  title: string
}

export type DrawingSavePayload = {
  drawingId: string
  title: string
  sceneJson: string
  previewBlob: Blob
}

export function useVaultDrawingController(args: {
  canOpenDrawing: boolean
  draftAttachments: Record<string, string>
  setDraftAttachments: Dispatch<SetStateAction<Record<string, string>>>
  blockNoteRef: MutableRefObject<BlockNoteComponentRef | null>
  draftContentRef: MutableRefObject<string>
  setError: (message: string | null) => void
  closeAttachments: () => void
  downloadAttachment: (attachmentName: string) => void
  syncDraftContentFromEditor: () => void
}) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorSaving, setEditorSaving] = useState(false)
  const [activeDrawingId, setActiveDrawingId] = useState<string | null>(null)
  const [activeDrawingBlockId, setActiveDrawingBlockId] = useState<string | null>(null)
  const [drawingTitle, setDrawingTitle] = useState('')
  const [drawingInitialData, setDrawingInitialData] = useState<DrawingInitialData | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DrawingDeleteRequest | null>(null)
  const pendingInsertRef = useRef<((value: DrawingInsertResult | null) => void) | null>(null)

  const resolvePendingInsert = useCallback((value: DrawingInsertResult | null): void => {
    const resolve = pendingInsertRef.current
    pendingInsertRef.current = null
    resolve?.(value)
  }, [])

  const clearEditorState = useCallback((): void => {
    setEditorOpen(false)
    setEditorSaving(false)
    setActiveDrawingId(null)
    setActiveDrawingBlockId(null)
    setDrawingTitle('')
    setDrawingInitialData(null)
  }, [])

  const resetDrawingState = useCallback((): void => {
    resolvePendingInsert(null)
    setPendingDelete(null)
    clearEditorState()
  }, [clearEditorState, resolvePendingInsert])

  const openNewDrawing = useCallback((drawingId?: string): string | null => {
    if (!args.canOpenDrawing) return null
    args.setError(null)
    const nextDrawingId = drawingId ?? createDrawingId()
    setActiveDrawingId(nextDrawingId)
    setActiveDrawingBlockId(null)
    setDrawingTitle('')
    setDrawingInitialData(null)
    setEditorOpen(true)
    return nextDrawingId
  }, [args.canOpenDrawing, args.setError])

  const openDrawingAttachment = useCallback(async (
    sceneAttachmentName: string,
    options?: { blockId?: string; title?: string },
  ): Promise<void> => {
    const drawingId = getDrawingIdFromAttachment(sceneAttachmentName)
    const sceneDataUrl = args.draftAttachments[sceneAttachmentName]
    if (!drawingId || !sceneDataUrl) {
      args.setError('未找到对应的绘图源文件')
      return
    }

    try {
      args.setError(null)
      const sceneData = await parseDrawingSceneData(sceneDataUrl)
      setActiveDrawingId(drawingId)
      setActiveDrawingBlockId(options?.blockId ?? null)
      setDrawingTitle(options?.title === '未命名绘图' ? '' : (options?.title ?? ''))
      setDrawingInitialData(sceneData)
      setEditorOpen(true)
      args.closeAttachments()
    } catch (error) {
      args.setError(formatErrorZh(error))
    }
  }, [args.closeAttachments, args.draftAttachments, args.setError])

  const openDrawingUrl = useCallback(async (
    sceneUrl: string,
    options?: { drawingId?: string; blockId?: string; title?: string },
  ): Promise<void> => {
    const sceneAttachmentName = getAttachmentNameFromUrl(sceneUrl)
    if (!sceneAttachmentName) {
      args.setError('未找到对应的绘图源文件')
      return
    }

    if (options?.drawingId && !args.draftAttachments[sceneAttachmentName]) {
      const fallbackNames = getDrawingAttachmentNames(options.drawingId)
      if (args.draftAttachments[fallbackNames.scene]) {
        await openDrawingAttachment(fallbackNames.scene, options)
        return
      }
    }

    await openDrawingAttachment(sceneAttachmentName, options)
  }, [args.draftAttachments, args.setError, openDrawingAttachment])

  const requestInsertDrawing = useCallback(async (): Promise<DrawingInsertResult | null> => {
    const drawingId = openNewDrawing()
    if (!drawingId) return null

    return await new Promise<DrawingInsertResult | null>((resolve) => {
      pendingInsertRef.current = resolve
    })
  }, [openNewDrawing])

  const saveDrawing = useCallback(async (payload: DrawingSavePayload): Promise<void> => {
    const sceneBytes = new TextEncoder().encode(payload.sceneJson).length
    if (sceneBytes > MAX_DRAWING_SCENE_BYTES) {
      throw new Error('绘图源文件超过 3MB。Excalidraw 内嵌图片会显著增大体积，请压缩图片或减少嵌入图片后重试')
    }

    const previewDataUrl = await fileToDataUrl(payload.previewBlob)
    const previewBytes = estimateDataUrlBytes(previewDataUrl)
    if ((previewBytes ?? Number.MAX_SAFE_INTEGER) > MAX_DRAWING_PREVIEW_BYTES) {
      throw new Error('绘图预览图超过 1.5MB，请缩小画布或减少复杂内容后重试')
    }

    const attachmentNames = getDrawingAttachmentNames(payload.drawingId)
    const sceneDataUrl = sceneJsonToDataUrl(payload.sceneJson)

    setEditorSaving(true)
    args.setError(null)
    try {
      args.setDraftAttachments((currentAttachments) => ({
        ...currentAttachments,
        [attachmentNames.scene]: sceneDataUrl,
        [attachmentNames.preview]: previewDataUrl,
      }))

      if (pendingInsertRef.current) {
        resolvePendingInsert({
          drawingId: payload.drawingId,
          previewFilename: attachmentNames.preview,
          sceneFilename: attachmentNames.scene,
          title: payload.title,
        })
      } else {
        const currentContent = args.blockNoteRef.current?.getMarkdown() ?? args.draftContentRef.current
        if (countAttachmentRefs(currentContent, attachmentNames.preview) === 0) {
          args.blockNoteRef.current?.insertDrawingCard({
            drawingId: payload.drawingId,
            previewFilename: attachmentNames.preview,
            sceneFilename: attachmentNames.scene,
            title: payload.title,
          })
          window.setTimeout(args.syncDraftContentFromEditor, 0)
        } else if (activeDrawingBlockId) {
          const editor = args.blockNoteRef.current?.getEditor() as any
          editor?.updateBlock?.(activeDrawingBlockId, {
            type: 'drawingCard',
            props: { title: payload.title || '未命名绘图' },
          })
          window.setTimeout(args.syncDraftContentFromEditor, 0)
        }
      }

      setEditorOpen(false)
      setActiveDrawingBlockId(null)
      setDrawingTitle('')
      setDrawingInitialData(null)
    } finally {
      setEditorSaving(false)
    }
  }, [
    activeDrawingBlockId,
    args.blockNoteRef,
    args.draftContentRef,
    args.setDraftAttachments,
    args.setError,
    args.syncDraftContentFromEditor,
    resolvePendingInsert,
  ])

  const downloadDrawingPreview = useCallback((previewAttachmentUrl: string): void => {
    const attachmentName = getAttachmentNameFromUrl(previewAttachmentUrl)
    if (attachmentName) args.downloadAttachment(attachmentName)
  }, [args.downloadAttachment])

  const deleteDrawing = useCallback((blockId: string, drawingId: string): void => {
    const editor = args.blockNoteRef.current?.getEditor() as any
    editor?.removeBlocks?.([blockId])

    const attachmentNames = getDrawingAttachmentNames(drawingId)
    args.setDraftAttachments((currentAttachments) => {
      const nextAttachments = { ...currentAttachments }
      delete nextAttachments[attachmentNames.scene]
      delete nextAttachments[attachmentNames.preview]
      return nextAttachments
    })
    window.setTimeout(args.syncDraftContentFromEditor, 0)
  }, [args.blockNoteRef, args.setDraftAttachments, args.syncDraftContentFromEditor])

  const confirmDeleteDrawing = useCallback((): void => {
    const request = pendingDelete
    setPendingDelete(null)
    if (request) deleteDrawing(request.blockId, request.drawingId)
  }, [deleteDrawing, pendingDelete])

  const renameDrawing = useCallback((blockId: string, title: string): void => {
    const editor = args.blockNoteRef.current?.getEditor() as any
    if (!editor?.updateBlock) return
    editor.updateBlock(blockId, {
      type: 'drawingCard',
      props: { title },
    })
    window.setTimeout(args.syncDraftContentFromEditor, 0)
  }, [args.blockNoteRef, args.syncDraftContentFromEditor])

  const handleEditorOpenChange = useCallback((open: boolean): void => {
    setEditorOpen(open)
    if (open) return

    resolvePendingInsert(null)
    setActiveDrawingBlockId(null)
    setDrawingTitle('')
    setDrawingInitialData(null)
    setEditorSaving(false)
  }, [resolvePendingInsert])

  useEffect(() => () => resolvePendingInsert(null), [resolvePendingInsert])

  return {
    editorOpen,
    editorSaving,
    activeDrawingId,
    drawingTitle,
    drawingInitialData,
    pendingDelete,
    setDrawingTitle,
    handleEditorOpenChange,
    resetDrawingState,
    requestInsertDrawing,
    openDrawingAttachment,
    openDrawingUrl,
    saveDrawing,
    downloadDrawingPreview,
    renameDrawing,
    requestDeleteDrawing: setPendingDelete,
    cancelDeleteDrawing: () => setPendingDelete(null),
    confirmDeleteDrawing,
  }
}
