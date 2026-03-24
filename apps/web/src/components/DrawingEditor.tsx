import { useCallback, useRef, useState } from 'react'
import { Excalidraw, exportToBlob, serializeAsJSON } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type DrawingEditorProps = {
  open: boolean
  drawingId: string | null
  title: string
  initialData: ExcalidrawInitialDataState | null
  isSaving?: boolean
  onOpenChange: (open: boolean) => void
  onTitleChange: (value: string) => void
  onSave: (payload: { drawingId: string; title: string; sceneJson: string; previewBlob: Blob }) => Promise<void> | void
}

export function DrawingEditor({ open, drawingId, title, initialData, isSaving = false, onOpenChange, onTitleChange, onSave }: DrawingEditorProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!drawingId) return
    const api = apiRef.current
    if (!api) {
      setLocalError('绘图编辑器尚未准备好，请稍后重试')
      return
    }

    try {
      setLocalError(null)
      const elements = api.getSceneElementsIncludingDeleted()
      const appState = api.getAppState()
      const files = api.getFiles()
      const sceneJson = serializeAsJSON(elements, appState, files, 'local')
      const previewBlob = await exportToBlob({
        elements: api.getSceneElements(),
        appState: {
          ...appState,
          exportBackground: true,
        } satisfies Partial<AppState>,
        files: files as BinaryFiles,
        mimeType: 'image/png',
        exportPadding: 16,
      })
      await onSave({ drawingId, title: title.trim(), sceneJson, previewBlob })
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '绘图保存失败，请稍后重试')
    }
  }, [drawingId, onSave, title])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(96vw,1200px)] gap-0 overflow-hidden border-border/60 p-0 sm:max-w-[min(96vw,1200px)]">
        <DialogHeader className="border-b border-border/60 px-6 py-4">
          <DialogTitle>绘图</DialogTitle>
          <DialogDescription>使用 Excalidraw 绘制草图，保存后会作为加密附件跟随当前笔记同步。</DialogDescription>
          <Input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="为这张绘图命名"
            className="mt-2"
            disabled={isSaving}
          />
        </DialogHeader>
        <div className="h-[min(72vh,820px)] min-h-[420px] w-full bg-muted/20">
          <Excalidraw
            excalidrawAPI={(api) => {
              apiRef.current = api
            }}
            initialData={initialData ?? undefined}
            langCode="zh-CN"
          />
        </div>
        <DialogFooter className="border-t border-border/60 px-6 py-4">
          {localError ? <p className="mr-auto text-sm text-destructive">{localError}</p> : <div className="mr-auto" />}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>取消</Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSaving || !drawingId}>
            {isSaving ? '正在保存…' : '保存绘图'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
