/**
 * 媒体查询 Hook
 */

import { useEffect, useState } from 'react'

/**
 * 监听媒体查询状态变化
 * @param query - CSS 媒体查询字符串
 * @returns 是否匹配
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)

    setMatches(mql.matches)

    if ('addEventListener' in mql) {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }

    // Safari < 14 兼容
    ;(mql as any).addListener(onChange)
    return () => (mql as any).removeListener(onChange)
  }, [query])

  return matches
}
