import { useEffect, useState } from 'react'
import type { ModeId } from '../../state/store'

export function useIsDark(mode: ModeId): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false
    if (mode === 'dark') return true
    if (mode === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    if (mode === 'dark') {
      setIsDark(true)
      return
    }
    if (mode === 'light') {
      setIsDark(false)
      return
    }
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    setIsDark(mql.matches)
    const handler = (event: MediaQueryListEvent) => setIsDark(event.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [mode])

  return isDark
}
