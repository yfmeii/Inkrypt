import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (!el.isConnected) return false
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('aria-disabled') === 'true') return false
    return true
  })
}

export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const raf = window.requestAnimationFrame(() => {
      const focusables = getFocusable(container)
      if (focusables.length) focusables[0].focus()
      else container.focus()
    })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusables = getFocusable(container)
      if (!focusables.length) {
        e.preventDefault()
        container.focus()
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const isInside = activeEl ? container.contains(activeEl) : false

      if (e.shiftKey) {
        if (!isInside || activeEl === first) {
          e.preventDefault()
          last.focus()
        }
        return
      }

      if (!isInside || activeEl === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown)
      if (prev) {
        try {
          prev.focus()
        } catch {
          // ignore
        }
      }
    }
  }, [active, containerRef])
}

