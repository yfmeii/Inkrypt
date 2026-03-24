import { useEffect, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { Check, Download, Ellipsis, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const CARD_ICON_SIZE = 14
const CARD_INLINE_ICON_SIZE = 12

function stopEditorSelection(event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>) {
  event.stopPropagation()
}

type DrawingCardProps = {
  blockId: string
  drawingId: string
  previewUrl: string
  previewAttachmentUrl: string
  sceneUrl: string
  title?: string
  onEdit?: (blockId: string, drawingId: string, sceneUrl: string, title: string) => void
  onDownload?: (previewAttachmentUrl: string) => void
  onDelete?: (blockId: string, drawingId: string, sceneUrl: string, title: string) => void
  onRename?: (blockId: string, title: string) => void
}

export function DrawingCard({ blockId, drawingId, previewUrl, previewAttachmentUrl, sceneUrl, title, onEdit, onDownload, onDelete, onRename }: DrawingCardProps) {
  const resolvedTitle = title || '未命名绘图'
  const [isRenaming, setIsRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState(resolvedTitle)

  useEffect(() => {
    setDraftTitle(resolvedTitle)
  }, [resolvedTitle])

  const handleEdit = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onEdit?.(blockId, drawingId, sceneUrl, resolvedTitle)
  }

  const handleRenameSubmit = () => {
    const nextTitle = draftTitle.trim() || '未命名绘图'
    onRename?.(blockId, nextTitle)
    setDraftTitle(nextTitle)
    setIsRenaming(false)
  }

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleRenameSubmit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setDraftTitle(resolvedTitle)
      setIsRenaming(false)
    }
  }

  return (
    <div className="drawing-card" data-drawing-id={drawingId} data-scene-url={sceneUrl} contentEditable={false} suppressContentEditableWarning>
      <div className="drawing-card__toolbar">
        <div className="drawing-card__eyebrow">Excalidraw</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="drawing-card__menu-trigger"
              onPointerDown={stopEditorSelection}
              onMouseDown={stopEditorSelection}
              onClick={stopEditorSelection}
            >
              <Ellipsis size={CARD_ICON_SIZE} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setIsRenaming(true)}>
              <Pencil size={CARD_ICON_SIZE} />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit?.(blockId, drawingId, sceneUrl, resolvedTitle)}>
              <Pencil size={CARD_ICON_SIZE} />
              编辑绘图
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDownload?.(previewAttachmentUrl)}>
              <Download size={CARD_ICON_SIZE} />
              下载 PNG
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete?.(blockId, drawingId, sceneUrl, resolvedTitle)}>
              <Trash2 size={CARD_ICON_SIZE} />
              删除绘图
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="drawing-card__preview-wrap">
        <img className="drawing-card__preview" src={previewUrl} alt={resolvedTitle} draggable={false} />
      </div>
      <div className="drawing-card__meta">
        <div>
          {isRenaming ? (
            <div className="drawing-card__rename-row">
              <Input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                onKeyDown={handleRenameKeyDown}
                className="h-8"
                autoFocus
                onMouseDown={stopEditorSelection}
                onPointerDown={stopEditorSelection}
              />
              <Button type="button" variant="ghost" size="icon-sm" className="drawing-card__rename-confirm" onMouseDown={stopEditorSelection} onPointerDown={stopEditorSelection} onClick={handleRenameSubmit}>
                <Check size={CARD_INLINE_ICON_SIZE} />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" className="drawing-card__rename-cancel" onMouseDown={stopEditorSelection} onPointerDown={stopEditorSelection} onClick={() => { setDraftTitle(resolvedTitle); setIsRenaming(false) }}>
                <X size={CARD_INLINE_ICON_SIZE} />
              </Button>
            </div>
          ) : (
            <button type="button" className="drawing-card__title-button" onMouseDown={stopEditorSelection} onPointerDown={stopEditorSelection} onClick={() => setIsRenaming(true)}>
              <div className="drawing-card__title">{resolvedTitle}</div>
            </button>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onMouseDown={stopEditorSelection} onPointerDown={stopEditorSelection} onClick={handleEdit}>
          编辑
        </Button>
      </div>
    </div>
  )
}
