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
  receipt?: {
    noteId: string
    version: number
    changeSequence: string
    updatedAt: number
  }
}

const mocks = vi.hoisted(() => {
  const doc = { kind: 'mock-y-doc', destroy: vi.fn() }
  const masterKey = new Uint8Array(32).fill(7)
  const savedReceipt = {
    noteId: 'note-1',
    version: 2,
    changeSequence: '2',
    updatedAt: 100,
  }

  let statusCallback: ((status: SyncStatusEvent) => void) | null = null
  let dirty = false
  let currentNoteId: string | null = null

  const syncImpl = vi.fn(async (_noteId: string, _statusCallback: ((status: SyncStatusEvent) => void) | null): Promise<SyncResultShape> => ({ success: true, mergedRemote: false, receipt: savedReceipt }))
  const saveSnapshotImpl = vi.fn(async (_noteId: string, _snapshot: string, _masterKey: Uint8Array): Promise<void> => {})
  const loadSnapshotImpl = vi.fn(async (_noteId: string, _masterKey: Uint8Array): Promise<string | null> => null)
  const initializeImpl = vi.fn(async (_noteId: string, _snapshot?: string): Promise<typeof doc> => doc)
  const encodeYDoc = vi.fn((_doc: typeof doc) => 'encoded-snapshot')
  const hasYDocUpdatesBeyond = vi.fn(() => false)

  class MockYjsDocManager {
    initialize = vi.fn(async (noteId: string, snapshot?: string, options?: { dirty?: boolean }) => {
      currentNoteId = noteId
      dirty = options?.dirty === true
      return initializeImpl(noteId, snapshot)
    })
    getDoc = vi.fn(() => doc)
    getState = vi.fn(() => currentNoteId ? { noteId: currentNoteId, doc } : null)
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
    saveSnapshot = vi.fn((noteId: string, snapshot: string, encryptionKey: Uint8Array) => saveSnapshotImpl(noteId, snapshot, encryptionKey))
    loadSnapshot = vi.fn((noteId: string, encryptionKey: Uint8Array) => loadSnapshotImpl(noteId, encryptionKey))
    deleteSnapshot = vi.fn(async (_noteId: string): Promise<void> => {})
  }

  return {
    doc,
    masterKey,
    savedReceipt,
    getStatusCallback: () => statusCallback,
    setDirty: (value: boolean) => {
      dirty = value
    },
    resetState: () => {
      statusCallback = null
      dirty = false
      currentNoteId = null
      doc.destroy.mockReset()
      syncImpl.mockReset()
      saveSnapshotImpl.mockReset()
      loadSnapshotImpl.mockReset()
      initializeImpl.mockReset()
      encodeYDoc.mockReset()
      hasYDocUpdatesBeyond.mockReset()
      syncImpl.mockResolvedValue({ success: true, mergedRemote: false, receipt: savedReceipt })
      saveSnapshotImpl.mockResolvedValue(undefined)
      loadSnapshotImpl.mockResolvedValue(null)
      initializeImpl.mockResolvedValue(doc)
      encodeYDoc.mockReturnValue('encoded-snapshot')
      hasYDocUpdatesBeyond.mockReturnValue(false)
    },
    syncImpl,
    saveSnapshotImpl,
    loadSnapshotImpl,
    initializeImpl,
    encodeYDoc,
    hasYDocUpdatesBeyond,
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
  decodeYDoc: vi.fn(() => mocks.doc),
  mergeYDocs: vi.fn(),
  hasYDocUpdatesBeyond: mocks.hasYDocUpdatesBeyond,
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
      return { success: true, mergedRemote: false, receipt: mocks.savedReceipt }
    })
    mocks.saveSnapshotImpl.mockImplementation(async () => savePromise)

    const onSyncComplete = vi.fn()
    const { result } = renderHook(() =>
      useYjsSync({
        noteId: 'note-1',
        masterKey: mocks.masterKey,
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
      return { success: true, mergedRemote: true, receipt: mocks.savedReceipt }
    })
    mocks.saveSnapshotImpl.mockRejectedValue(new Error('disk full'))

    const onSyncComplete = vi.fn()
    const onSyncError = vi.fn()
    const { result } = renderHook(() =>
      useYjsSync({
        noteId: 'note-1',
        masterKey: mocks.masterKey,
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

    expect(syncResult).toEqual({ success: true, mergedRemote: true, receipt: mocks.savedReceipt })
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
        masterKey: mocks.masterKey,
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

    expect(mocks.saveSnapshotImpl).toHaveBeenNthCalledWith(1, 'note-1', 'encoded-snapshot', mocks.masterKey)
    expect(mocks.saveSnapshotImpl).toHaveBeenNthCalledWith(2, 'note-1', 'encoded-snapshot', mocks.masterKey)
  })

  test('ignores a stale note initialization after switching notes', async () => {
    let resolveNoteOneLoad: ((snapshot: string | null) => void) | null = null
    const noteOneLoad = new Promise<string | null>((resolve) => {
      resolveNoteOneLoad = resolve
    })
    const noteTwoLoad = Promise.resolve<string | null>('note-two-snapshot')

    mocks.loadSnapshotImpl.mockImplementation((noteId: string) => (
      noteId === 'note-1' ? noteOneLoad : noteTwoLoad
    ))

    const api = { getNote: vi.fn(), putNote: vi.fn() }
    const { result, rerender } = renderHook(
      ({ noteId }: { noteId: string }) => useYjsSync({ noteId, masterKey: mocks.masterKey, api }),
      { initialProps: { noteId: 'note-1' } },
    )

    rerender({ noteId: 'note-2' })

    await waitFor(() => expect(result.current.doc).not.toBeNull())
    expect(mocks.initializeImpl).toHaveBeenCalledWith('note-2', 'note-two-snapshot')
    expect(mocks.initializeImpl).not.toHaveBeenCalledWith('note-1', expect.anything())

    await act(async () => {
      resolveNoteOneLoad?.(null)
      await Promise.resolve()
    })

    expect(mocks.initializeImpl).not.toHaveBeenCalledWith('note-1', expect.anything())
    expect(result.current.doc).not.toBeNull()
  })

  test('does not replace the active document when the same note snapshot prop changes', async () => {
    const api = { getNote: vi.fn(), putNote: vi.fn() }
    const { result, rerender } = renderHook(
      ({ initialSnapshot }: { initialSnapshot: string }) => useYjsSync({
        noteId: 'note-1',
        masterKey: mocks.masterKey,
        initialSnapshot,
        api,
      }),
      { initialProps: { initialSnapshot: 'snapshot-one' } },
    )

    await waitFor(() => expect(result.current.doc).not.toBeNull())
    const firstGeneration = result.current.documentGeneration
    expect(mocks.initializeImpl).toHaveBeenCalledTimes(1)

    rerender({ initialSnapshot: 'snapshot-two' })
    await Promise.resolve()

    expect(result.current.documentGeneration).toBe(firstGeneration)
    expect(mocks.initializeImpl).toHaveBeenCalledTimes(1)
  })

  test('keeps restored local-only Yjs updates dirty', async () => {
    mocks.loadSnapshotImpl.mockResolvedValueOnce('local-snapshot')
    mocks.hasYDocUpdatesBeyond.mockReturnValueOnce(true)

    const { result } = renderHook(() => useYjsSync({
      noteId: 'note-1',
      masterKey: mocks.masterKey,
      initialSnapshot: 'server-snapshot',
      api: { getNote: vi.fn(), putNote: vi.fn() },
    }))

    await waitFor(() => expect(result.current.doc).not.toBeNull())

    expect(result.current.dirty).toBe(true)
    expect(mocks.initializeImpl).toHaveBeenCalledWith('note-1', 'encoded-snapshot')
  })
})
