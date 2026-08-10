import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVaultEditorBridge } from './editor-bridge'

describe('useVaultEditorBridge', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('updates the draft immediately for direct editor changes', () => {
    const draftContentRef = { current: 'before' }
    const setDraftContent = vi.fn()
    const { result } = renderHook(() => useVaultEditorBridge({
      draftContentRef,
      setDraftContent,
    }))

    act(() => result.current.handleBlockNoteChange('after'))

    expect(draftContentRef.current).toBe('after')
    expect(setDraftContent).toHaveBeenCalledWith('after')
  })

  it('ignores initialization-only Yjs events', () => {
    const draftContentRef = { current: 'before' }
    const setDraftContent = vi.fn()
    const getMarkdown = vi.fn(() => 'normalized')
    const { result } = renderHook(() => useVaultEditorBridge({
      draftContentRef,
      setDraftContent,
    }))
    result.current.blockNoteRef.current = { getMarkdown } as never

    act(() => {
      result.current.handleYjsDocChange({ suppressDraftUpdate: true })
      vi.advanceTimersByTime(250)
    })

    expect(getMarkdown).not.toHaveBeenCalled()
    expect(setDraftContent).not.toHaveBeenCalled()
  })

  it('debounces runtime Yjs changes and skips identical markdown', () => {
    const draftContentRef = { current: 'before' }
    const setDraftContent = vi.fn()
    const getMarkdown = vi.fn(() => 'after')
    const { result } = renderHook(() => useVaultEditorBridge({
      draftContentRef,
      setDraftContent,
    }))
    result.current.blockNoteRef.current = { getMarkdown } as never

    act(() => {
      result.current.handleYjsDocChange({ suppressDraftUpdate: false })
      result.current.handleYjsDocChange({ suppressDraftUpdate: false })
      vi.advanceTimersByTime(200)
    })

    expect(getMarkdown).toHaveBeenCalledTimes(1)
    expect(setDraftContent).toHaveBeenCalledTimes(1)

    setDraftContent.mockClear()
    act(() => {
      result.current.handleYjsDocChange({ suppressDraftUpdate: false })
      vi.advanceTimersByTime(200)
    })
    expect(setDraftContent).not.toHaveBeenCalled()
  })

  it('cancels a pending Yjs read on unmount', () => {
    const setDraftContent = vi.fn()
    const getMarkdown = vi.fn(() => 'after')
    const { result, unmount } = renderHook(() => useVaultEditorBridge({
      draftContentRef: { current: 'before' },
      setDraftContent,
    }))
    result.current.blockNoteRef.current = { getMarkdown } as never

    act(() => result.current.handleYjsDocChange({ suppressDraftUpdate: false }))
    unmount()
    act(() => vi.runAllTimers())

    expect(getMarkdown).not.toHaveBeenCalled()
    expect(setDraftContent).not.toHaveBeenCalled()
  })
})
