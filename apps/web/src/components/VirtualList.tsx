import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

type VirtualListProps<T> = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'style'> & {
  style?: CSSProperties
  items: readonly T[]
  itemHeight: number
  itemGap?: number
  overscan?: number
  getKey?: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
  empty?: ReactNode
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function VirtualList<T>({
  style,
  items,
  itemHeight,
  itemGap,
  overscan = 6,
  getKey,
  renderItem,
  empty,
  ...containerProps
}: VirtualListProps<T>) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const update = () => setViewportHeight(el.clientHeight)
    update()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }

    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const totalHeight = items.length * itemHeight

  const range = useMemo(() => {
    const start = Math.floor(scrollTop / itemHeight) - overscan
    const end = Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan
    const startIndex = clamp(start, 0, items.length)
    const endIndex = clamp(end, startIndex, items.length)
    return { startIndex, endIndex }
  }, [itemHeight, items.length, overscan, scrollTop, viewportHeight])

  const offsetY = range.startIndex * itemHeight
  const visible = items.slice(range.startIndex, range.endIndex)
  const gap = Math.max(0, itemGap ?? 0)

  if (items.length === 0) {
    return (
      <div ref={ref} style={style} {...containerProps}>
        {empty ?? null}
      </div>
    )
  }

  return (
    <div ref={ref} style={style} {...containerProps}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
          {visible.map((item, i) => {
            const idx = range.startIndex + i
            const key = getKey ? getKey(item, idx) : String(idx)
            return (
              <div
                key={key}
                className="virtualRow"
                style={{
                  height: itemHeight,
                  boxSizing: 'border-box',
                  paddingBottom: gap,
                  ['--vl-gap' as any]: `${gap}px`,
                }}
              >
                <div style={{ height: '100%' }}>{renderItem(item, idx)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
