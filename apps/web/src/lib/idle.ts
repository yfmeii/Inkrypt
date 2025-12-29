/**
 * 空闲时间调度工具
 * 
 * 封装 requestIdleCallback API，提供跨浏览器兼容性
 */

export type IdleDeadlineLike = { 
  timeRemaining: () => number
  didTimeout: boolean 
}

/**
 * 在浏览器空闲时执行回调
 * @param cb - 回调函数
 * @returns 句柄，可用于取消
 */
export function scheduleIdle(cb: (deadline?: IdleDeadlineLike) => void): number {
  if (typeof window === 'undefined') return 0
  const w = window as any
  if (typeof w.requestIdleCallback === 'function') {
    return w.requestIdleCallback(cb, { timeout: 200 })
  }
  return window.setTimeout(() => cb(undefined), 0)
}

/**
 * 取消空闲回调
 * @param handle - scheduleIdle 返回的句柄
 */
export function cancelIdle(handle: number): void {
  if (typeof window === 'undefined') return
  const w = window as any
  if (typeof w.cancelIdleCallback === 'function') {
    w.cancelIdleCallback(handle)
  } else {
    window.clearTimeout(handle)
  }
}
