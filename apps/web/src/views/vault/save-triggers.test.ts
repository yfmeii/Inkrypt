import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVaultSaveTriggers, type SaveSelected } from './save-triggers'

function createArgs(performSaveSelected: SaveSelected) {
  return {
    performSaveSelected,
    hasMasterKey: true,
    hasSelection: true,
    selectedBaselineReady: true,
    dirty: true,
    attachmentsBusy: false,
    busy: false,
    draftTitle: 'Title',
    draftContent: 'Content',
    draftTags: 'tag',
    draftFavorite: false,
    draftAttachments: {},
  }
}

describe('useVaultSaveTriggers', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('autosaves eligible dirty drafts after one second', async () => {
    const performSaveSelected = vi.fn(async () => ({
      status: 'skipped' as const,
      reason: 'not-ready' as const,
    }))
    renderHook(() => useVaultSaveTriggers(createArgs(performSaveSelected)))

    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })

    expect(performSaveSelected).toHaveBeenCalledWith({ silent: true })
  })

  it('restarts autosave when draft input changes', async () => {
    const performSaveSelected = vi.fn(async () => ({
      status: 'skipped' as const,
      reason: 'not-ready' as const,
    }))
    const { rerender } = renderHook(
      ({ draftContent }) => useVaultSaveTriggers({
        ...createArgs(performSaveSelected),
        draftContent,
      }),
      { initialProps: { draftContent: 'first' } },
    )

    act(() => vi.advanceTimersByTime(800))
    rerender({ draftContent: 'second' })
    act(() => vi.advanceTimersByTime(800))
    expect(performSaveSelected).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })
    expect(performSaveSelected).toHaveBeenCalledTimes(1)
  })

  it('blocks autosave while attachments are changing', () => {
    const performSaveSelected = vi.fn(async () => ({
      status: 'skipped' as const,
      reason: 'not-ready' as const,
    }))
    renderHook(() => useVaultSaveTriggers({
      ...createArgs(performSaveSelected),
      attachmentsBusy: true,
    }))

    act(() => vi.advanceTimersByTime(1500))
    expect(performSaveSelected).not.toHaveBeenCalled()
  })

  it('cancels pending autosave while a manual save is busy', () => {
    const performSaveSelected = vi.fn(async () => ({
      status: 'skipped' as const,
      reason: 'not-ready' as const,
    }))
    const { rerender } = renderHook(
      ({ busy }) => useVaultSaveTriggers({
        ...createArgs(performSaveSelected),
        busy,
      }),
      { initialProps: { busy: false } },
    )

    act(() => vi.advanceTimersByTime(800))
    rerender({ busy: true })
    act(() => vi.advanceTimersByTime(500))

    expect(performSaveSelected).not.toHaveBeenCalled()
  })

  it('handles Ctrl+S in capture flow using the latest save function', async () => {
    const firstSave = vi.fn(async () => ({
      status: 'skipped' as const,
      reason: 'not-ready' as const,
    }))
    const latestSave = vi.fn(async () => ({
      status: 'skipped' as const,
      reason: 'not-ready' as const,
    }))
    const { rerender } = renderHook(
      ({ performSaveSelected }) => useVaultSaveTriggers({
        ...createArgs(performSaveSelected),
        dirty: false,
      }),
      { initialProps: { performSaveSelected: firstSave } },
    )
    rerender({ performSaveSelected: latestSave })

    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      cancelable: true,
    })
    const stopPropagation = vi.spyOn(event, 'stopPropagation')
    await act(async () => {
      window.dispatchEvent(event)
      await Promise.resolve()
    })

    expect(event.defaultPrevented).toBe(true)
    expect(stopPropagation).toHaveBeenCalled()
    expect(firstSave).not.toHaveBeenCalled()
    expect(latestSave).toHaveBeenCalledTimes(1)
  })
})
