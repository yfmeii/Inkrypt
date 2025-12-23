import type { ReactNode } from 'react'

export type ToastKind = 'error' | 'info' | 'loading'

export function ToastStack({ children }: { children: ReactNode }) {
  return (
    <div className="toastStack" aria-live="polite" aria-relevant="additions text">
      {children}
    </div>
  )
}

export function Toast({
  kind,
  message,
  onClose,
}: {
  kind: ToastKind
  message: ReactNode
  onClose?: () => void
}) {
  return (
    <div className={`toast ${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <div className="toastBody">
        {kind === 'loading' ? <span className="spinner" aria-hidden="true" /> : null}
        <div className="toastMessage">{message}</div>
      </div>
      {onClose ? (
        <button className="toastClose" type="button" onClick={onClose} aria-label="关闭" title="关闭">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      ) : null}
    </div>
  )
}

