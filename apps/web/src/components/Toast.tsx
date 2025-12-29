import type { ReactNode } from 'react'
import { XIcon, Loader2Icon, AlertCircleIcon, InfoIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastKind = 'error' | 'info' | 'loading'

export function ToastStack({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-[min(780px,calc(100%-24px))] pointer-events-none"
      aria-live="polite"
      aria-relevant="additions text"
    >
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
    <div
      className={cn(
        'pointer-events-auto rounded-lg px-4 py-3 flex items-start justify-between gap-3 shadow-lg border',
        kind === 'error' && 'bg-destructive/10 border-destructive/20 text-destructive',
        kind === 'info' && 'bg-secondary border-border text-secondary-foreground',
        kind === 'loading' && 'bg-card border-border text-card-foreground'
      )}
      role={kind === 'error' ? 'alert' : undefined}
    >
      <div className="flex gap-2.5 items-start min-w-0">
        {kind === 'loading' && (
          <Loader2Icon className="size-4 animate-spin shrink-0 mt-0.5" />
        )}
        {kind === 'error' && (
          <AlertCircleIcon className="size-4 shrink-0 mt-0.5" />
        )}
        {kind === 'info' && (
          <InfoIcon className="size-4 shrink-0 mt-0.5" />
        )}
        <div className="text-sm whitespace-pre-wrap break-words">{message}</div>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="rounded-md p-1 opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-opacity shrink-0"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  )
}
