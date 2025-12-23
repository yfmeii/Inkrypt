import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useId, useRef } from 'react'
import { useFocusTrap } from '../lib/focusTrap'
import { useBodyScrollLock } from '../lib/scrollLock'

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
  const titleId = useId()
  const messageId = useId()
  const modalRef = useRef<HTMLDivElement | null>(null)

  useFocusTrap(modalRef, true)
  useBodyScrollLock(true)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const onOverlayPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (!closeOnOverlay) return
    onCancel()
  }

  const onOverlayClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
  }

  return (
    <div className="modalOverlay" role="presentation" onPointerDown={onOverlayPointerDown} onClick={onOverlayClick}>
      <div
        className="modal card confirmDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onPointerDown={(e) => e.stopPropagation()}
        ref={modalRef}
        tabIndex={-1}
      >
        <strong id={titleId} className="confirmDialogTitle">{title}</strong>
        <p id={messageId} className="confirmDialogMessage muted">
          {message}
        </p>
        <div className="confirmDialogActions">
          <button className="btn" type="button" onClick={onCancel}>
            {cancelText}
          </button>
          <button className={confirmVariant === 'danger' ? 'btn danger' : 'btn primary'} type="button" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
