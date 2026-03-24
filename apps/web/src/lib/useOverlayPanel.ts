import { useEffect, type RefObject } from 'react'
import { useFocusTrap } from './focusTrap'
import { useBodyScrollLock } from './scrollLock'

type UseOverlayPanelOptions = {
  focusActive?: boolean
  lockScroll?: boolean
  onEscape?: (() => void) | null
}

export function useOverlayPanel(
  containerRef: RefObject<HTMLElement | null>,
  { focusActive = true, lockScroll = true, onEscape = null }: UseOverlayPanelOptions,
): void {
  useFocusTrap(containerRef, focusActive)
  useBodyScrollLock(lockScroll)

  useEffect(() => {
    if (!onEscape) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      onEscape()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onEscape])
}
