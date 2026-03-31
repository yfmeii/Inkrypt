import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useYjsSync } from './useYjsSync'

type SyncStatusEvent = {
  type: string
  mergedRemote?: boolean
  message?: string
  canRetry?: boolean
}

type SyncResultShape = {
  success: boolean
  mergedRemote: boolean
  error?: string
}

const mocks = vi.hoisted(() => {
  const doc = { kind: 'mock-y-doc' }

  let statusCallback: ((status: SyncStatusEvent) => void) | null = null
  let dirty = false

  const syncImpl = vi.fn(async (_noteId: string, _statusCallback: ((status: SyncStatusEvent) => void) | null): Promise<SyncResultShape> => ({ success: true, mergedRemote: false }))
  const saveSnapshotImpl = vi.fn(async (_noteId: string, _snapshot: string): Promise<void> => {})
  const loadSnapshotImpl = vi.fn(async (_noteId: string): Promise<string | null> => null)
  const initializeImpl = vi.fn(async (_noteId: string, _snapshot?: string): Promise<typeof doc> => doc)
  const encodeYDoc = vi.fn((_doc: typeof doc) => 'encoded-snapshot')

  class MockYjsDocManager {
    initialize = vi.fn((noteId: string, snapshot?: string) => initializeImpl(noteId, snapshot))
    getDoc = vi.fn(() => doc)
    onChange = vi.fn(() => () => undefined)
    isDirty = vi.fn(() => dirty)
    destroy = vi.fn()
  }

  class MockSyncController {
    onStatus = vi.fn((callback: ((status: SyncStatusEvent) => void) | null) => {
      statusCallback = callback
    })

    sync = vi.fn(async (noteId: string) => syncImpl(noteId, statusCallback))
  }

  class MockLocalPersistence {
    saveSnapshot = vi.fn((noteId: string, snapshot: string) => saveSnapshotImpl(noteId, snapshot))
    loadSnapshot = vi.fn((noteId: string) => loadSnapshotImpl(noteId))
  }

  return {
    doc,
    getStatusCallback: () => statusCallback,
    setDirty: (value: boolean) => {
      dirty = value
    },
    resetState: () => {
      statusCallback = null
      dirty = false
      syncImpl.mockReset()
      saveSnapshotImpl.mockReset()
      loadSnapshotImpl.mockReset()
      initializeImpl.mockReset()
      encodeYDoc.mockReset()
      syncImpl.mockResolvedValue({ success: true, mergedRemote: false })
      saveSnapshotImpl.mockResolvedValue(undefined)
      loadSnapshotImpl.mockResolvedValue(null)
      initializeImpl.mockResolvedValue(doc)
      encodeYDoc.mockReturnValue('encoded-snapshot')
    },
    syncImpl,
    saveSnapshotImpl,
    loadSnapshotImpl,
    initializeImpl,
    encodeYDoc,
    MockYjsDocManager,
    MockSyncController,
    MockLocalPersistence,
  }
})

vi.mock('../lib/yjs', () => ({
  YjsDocManager: mocks.MockYjsDocManager,
  SyncController: mocks.MockSyncController,
  LocalPersistence: mocks.MockLocalPersistence,
  encodeYDoc: mocks.encodeYDoc,
}))

describe('useYjsSync', () => {
  beforeEach(() => {
    mocks.resetState()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  test('keeps syncing state until local snapshot persistence completes', async () => {
    let resolveSave: (() => void) | null = null
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve
    })

    mocks.syncImpl.mockImplementation(async (_noteId: string, statusCallback: ((status: SyncStatusEvent) => void) | null) => {
      statusCallback?.({ type: 'syncing' })
      statusCallback?.({ type: 'success', mergedRemote: false })
      return { success: true, mergedRemote: false }
    })
    mocks.saveSnapshotImpl.mockImplementation(async () => savePromise)

    const onSyncComplete = vi.fn()
    const { result } = renderHook(() =>
      useYjsSync({
        noteId: 'note-1',
        api: { getNote: vi.fn(), putNote: vi.fn() },
        onSyncComplete,
      })
    )

    await waitFor(() => expect(result.current.doc).not.toBeNull())

    let syncPromise: Promise<SyncResultShape>
    await act(async () => {
      syncPromise = result.current.sync()
      await Promise.resolve()
    })

    expect(result.current.lastSyncStatus).toEqual({ type: 'syncing' })
    expect(result.current.isSyncing).toBe(true)
    expect(onSyncComplete).not.toHaveBeenCalled()

    await act(async () => {
      resolveSave?.()
      await syncPromise!
    })

    expect(result.current.lastSyncStatus).toEqual({ type: 'success', mergedRemote: false })
    expect(result.current.isSyncing).toBe(false)
    expect(onSyncComplete).toHaveBeenCalledWith(false)
  })

  test('surfaces local snapshot failure as error status but still returns remote success', async () => {
    mocks.syncImpl.mockImplementation(async (_noteId: string, statusCallback: ((status: SyncStatusEvent) => void) | null) => {
      statusCallback?.({ type: 'syncing' })
      statusCallback?.({ type: 'success', mergedRemote: true })
      return { success: true, mergedRemote: true }
    })
    mocks.saveSnapshotImpl.mockRejectedValue(new Error('disk full'))

    const onSyncComplete = vi.fn()
    const onSyncError = vi.fn()
    const { result } = renderHook(() =>
      useYjsSync({
        noteId: 'note-1',
        api: { getNote: vi.fn(), putNote: vi.fn() },
        onSyncComplete,
        onSyncError,
      })
    )

    await waitFor(() => expect(result.current.doc).not.toBeNull())

    let syncResult: Awaited<ReturnType<typeof result.current.sync>> | undefined
    await act(async () => {
      syncResult = await result.current.sync()
    })

    expect(syncResult).toEqual({ success: true, mergedRemote: true })
    expect(result.current.lastSyncStatus).toEqual({
      type: 'error',
      message: '本地快照保存失败: disk full',
      canRetry: true,
    })
    expect(result.current.isSyncing).toBe(false)
    expect(onSyncError).toHaveBeenCalledWith('disk full')
    expect(onSyncComplete).not.toHaveBeenCalled()
  })

  test('flushes local snapshot when page becomes hidden or pagehide fires', async () => {
    const { result } = renderHook(() =>
      useYjsSync({
        noteId: 'note-1',
        api: { getNote: vi.fn(), putNote: vi.fn() },
      })
    )

    await waitFor(() => expect(result.current.doc).not.toBeNull())

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      })
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pagehide'))
      await Promise.resolve()
    })

    expect(mocks.saveSnapshotImpl).toHaveBeenNthCalledWith(1, 'note-1', 'encoded-snapshot')
    expect(mocks.saveSnapshotImpl).toHaveBeenNthCalledWith(2, 'note-1', 'encoded-snapshot')
  })
})
