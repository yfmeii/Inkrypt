import { useEffect, useState } from 'react'

type UsePresenceMountOptions = {
  exitDelayMs?: number
  respectReducedMotion?: boolean
}

export function usePresenceMount(
  isOpen: boolean,
  { exitDelayMs = 0, respectReducedMotion = false }: UsePresenceMountOptions = {},
): boolean {
  const [mounted, setMounted] = useState(isOpen)

  useEffect(() => {
    if (!isOpen) return
    setMounted(true)
  }, [isOpen])

  useEffect(() => {
    if (isOpen || !mounted) return
    if (!respectReducedMotion || !('matchMedia' in window)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMounted(false)
    }
  }, [isOpen, mounted, respectReducedMotion])

  useEffect(() => {
    if (isOpen || !mounted || exitDelayMs <= 0) return
    const timeoutId = window.setTimeout(() => setMounted(false), exitDelayMs)
    return () => window.clearTimeout(timeoutId)
  }, [exitDelayMs, isOpen, mounted])

  return mounted
}
