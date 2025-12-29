import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const CLOSE_ANIMATION_MS = 200

export function ConfirmDialog({
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  confirmVariant = 'primary',
  closeOnOverlay = false,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmVariant?: 'primary' | 'danger'
  closeOnOverlay?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const [open, setOpen] = useState(true)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closingRef = useRef(false)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const closeWith = (callback: () => void) => {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
    timeoutRef.current = setTimeout(() => {
      callback()
    }, CLOSE_ANIMATION_MS)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeWith(onCancel)
        }
      }}
    >
      <DialogContent
        className="sm:max-w-[425px]"
        onPointerDownOutside={(e) => {
          if (!closeOnOverlay) {
            e.preventDefault()
          }
        }}
        onEscapeKeyDown={() => closeWith(onCancel)}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">
            {message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => closeWith(onCancel)}>
            {cancelText}
          </Button>
          <Button
            variant={confirmVariant === 'danger' ? 'destructive' : 'default'}
            onClick={() => closeWith(onConfirm)}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
