import { useEffect } from 'react'

let lockCount = 0
let lockedScrollY = 0
let prevOverflow = ''
let prevPosition = ''
let prevTop = ''
let prevWidth = ''
let prevPaddingRight = ''

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function getScrollbarWidth(): number {
  return Math.max(0, window.innerWidth - document.documentElement.clientWidth)
}

function lockBodyScroll(): void {
  if (!isBrowser()) return
  const body = document.body

  if (lockCount === 0) {
    lockedScrollY = window.scrollY || 0
    prevOverflow = body.style.overflow
    prevPosition = body.style.position
    prevTop = body.style.top
    prevWidth = body.style.width
    prevPaddingRight = body.style.paddingRight

    const scrollbarWidth = getScrollbarWidth()
    if (scrollbarWidth > 0) {
      const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0
      body.style.paddingRight = `${currentPadding + scrollbarWidth}px`
    }

    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${lockedScrollY}px`
    body.style.width = '100%'
  }

  lockCount += 1
}

function unlockBodyScroll(): void {
  if (!isBrowser()) return
  if (lockCount <= 0) return
  lockCount -= 1
  if (lockCount > 0) return

  const body = document.body
  body.style.overflow = prevOverflow
  body.style.position = prevPosition
  body.style.top = prevTop
  body.style.width = prevWidth
  body.style.paddingRight = prevPaddingRight

  try {
    window.scrollTo(0, lockedScrollY)
  } catch {
    // ignore
  }
}

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    lockBodyScroll()
    return () => unlockBodyScroll()
  }, [active])
}

