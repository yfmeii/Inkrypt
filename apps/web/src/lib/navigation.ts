/**
 * 导航状态管理
 * 
 * 用于管理 History API 中的导航状态
 */

export type InkryptNavPage = 'list' | 'note'

export type InkryptNavState = { 
  v: 1
  page: InkryptNavPage
  noteId?: string 
}

/**
 * 从 History state 中读取导航状态
 */
export function readInkryptNavState(state: unknown): InkryptNavState | null {
  if (!state || typeof state !== 'object') return null
  const nav = (state as any).inkryptNav
  if (!nav || typeof nav !== 'object') return null
  if ((nav as any).v !== 1) return null
  const page = (nav as any).page
  if (page !== 'list' && page !== 'note') return null
  if (page === 'note' && typeof (nav as any).noteId !== 'string') return null
  return nav as InkryptNavState
}

/**
 * 将导航状态合并到 History state 中
 */
export function withInkryptNavState(state: unknown, nav: InkryptNavState): Record<string, unknown> {
  if (state && typeof state === 'object') {
    return { ...(state as Record<string, unknown>), inkryptNav: nav }
  }
  return { inkryptNav: nav }
}
