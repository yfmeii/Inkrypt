import { useEffect, useRef, useState, useCallback } from 'react'
import * as Y from 'yjs'
import {
  YjsDocManager,
  SyncController,
  LocalPersistence,
  encodeYDoc,
  decodeYDoc,
  mergeYDocs,
  hasYDocUpdatesBeyond,
} from '../lib/yjs'
import type { SavedNoteReceipt, SyncResult, SyncStatus, NotePayloadWithYjs } from '../lib/yjs'
import type { Bytes } from '../lib/crypto'

export interface UseYjsSyncOptions {
  noteId: string
  masterKey: Bytes | null
  initialSnapshot?: string | null
  api: {
    getNote: (noteId: string) => Promise<NotePayloadWithYjs | null>
    putNote: (noteId: string, payload: NotePayloadWithYjs) => Promise<SavedNoteReceipt>
  }
  onSyncComplete?: (mergedRemote: boolean) => void
  onSyncError?: (error: string) => void
}

export interface UseYjsSyncReturn {
  doc: Y.Doc | null
  documentNoteId: string | null
  documentGeneration: number
  sync: () => Promise<SyncResult>
  isSyncing: boolean
  dirty: boolean
  lastSyncStatus: SyncStatus
  saveToLocal: () => Promise<void>
  loadFromLocal: () => Promise<string | null>
  deleteLocal: () => Promise<void>
}

/**
 * Hook to manage Yjs document synchronization
 * 封装 YjsDocManager、SyncController、LocalPersistence
 */
export function useYjsSync(options: UseYjsSyncOptions): UseYjsSyncReturn {
  const { noteId, masterKey, initialSnapshot, api, onSyncComplete, onSyncError } = options
  const initialSnapshotRef = useRef(initialSnapshot)
  initialSnapshotRef.current = initialSnapshot
  const apiRef = useRef(api)
  apiRef.current = api

  // 使用 ref 存储管理器实例，避免重复创建
  const docManagerRef = useRef<YjsDocManager | null>(null)
  const syncControllerRef = useRef<SyncController | null>(null)
  const localPersistenceRef = useRef<LocalPersistence | null>(null)

  // 状态
  const [activeDocument, setActiveDocument] = useState<{
    noteId: string
    generation: number
    document: Y.Doc
  } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [lastSyncStatus, setLastSyncStatus] = useState<SyncStatus>({ type: 'idle' })
  const [isSyncing, setIsSyncing] = useState(false)

  // 用于追踪同步中状态，避免 SyncController 的 success 在本地持久化完成前流入 UI
  const syncInProgressRef = useRef(false)
  const initializationRunIdRef = useRef(0)
  const documentGenerationRef = useRef(0)

  // 初始化管理器
  useEffect(() => {
    if (!docManagerRef.current) {
      docManagerRef.current = new YjsDocManager()
    }
    if (!localPersistenceRef.current) {
      localPersistenceRef.current = new LocalPersistence()
    }
    if (!syncControllerRef.current && docManagerRef.current) {
      syncControllerRef.current = new SyncController(docManagerRef.current, {
        getNote: (currentNoteId) => apiRef.current.getNote(currentNoteId),
        putNote: (currentNoteId, payload) => apiRef.current.putNote(currentNoteId, payload),
      })
      
      // 订阅同步状态变化
      // 注意：当 syncInProgressRef.current 为 true 时，不直接传递 'success' 状态
      // 因为此时本地快照尚未持久化，需要在 sync() 中手动处理最终状态
      syncControllerRef.current.onStatus((status) => {
        if (syncInProgressRef.current && status.type === 'success') {
          // 不在此时设置 success 状态，等待 sync() 中本地持久化完成后再设置
          return
        }
        setLastSyncStatus(status)
        setIsSyncing(status.type === 'syncing')
      })
    }

    return () => {
      // 清理资源
      if (docManagerRef.current) {
        docManagerRef.current.destroy()
        docManagerRef.current = null
      }
      syncControllerRef.current = null
      localPersistenceRef.current = null
    }
  }, [])

  // 订阅 dirty 状态变化
  useEffect(() => {
    const docManager = docManagerRef.current
    if (!docManager) return

    const unsubscribe = docManager.onChange(() => {
      setDirty(docManager.isDirty())
    })

    return unsubscribe
  }, [])

  // 初始化文档
  useEffect(() => {
    const initializationRunId = ++initializationRunIdRef.current
    let initializationCancelled = false

    const isCurrentInitialization = () => (
      !initializationCancelled && initializationRunIdRef.current === initializationRunId
    )

    const initDoc = async () => {
      const docManager = docManagerRef.current
      const localPersistence = localPersistenceRef.current
      if (!docManager || !localPersistence || !masterKey) return

      try {
        if (!noteId) {
          if (isCurrentInitialization()) {
            setActiveDocument(null)
            setDirty(false)
          }
          return
        }

        // 尝试从本地加载，缺失时使用初始快照
        const localSnapshot = await localPersistence.loadSnapshot(noteId, masterKey)
        if (!isCurrentInitialization()) return

        const selectedInitialSnapshot = initialSnapshotRef.current
        let snapshot = localSnapshot ?? selectedInitialSnapshot ?? undefined
        let restoredLocalChanges = Boolean(localSnapshot && !selectedInitialSnapshot)
        if (localSnapshot && selectedInitialSnapshot && localSnapshot !== selectedInitialSnapshot) {
          const mergedDocument = decodeYDoc(selectedInitialSnapshot)
          const localDocument = decodeYDoc(localSnapshot)
          restoredLocalChanges = hasYDocUpdatesBeyond(localDocument, mergedDocument)
          mergeYDocs(mergedDocument, localDocument)
          snapshot = encodeYDoc(mergedDocument)
          mergedDocument.destroy()
          localDocument.destroy()
        }
        const initializedDoc = restoredLocalChanges
          ? await docManager.initialize(noteId, snapshot, { dirty: true })
          : await docManager.initialize(noteId, snapshot)
        if (!isCurrentInitialization()) return

        const generation = ++documentGenerationRef.current
        setActiveDocument({
          noteId,
          generation,
          document: initializedDoc,
        })
        setDirty(docManager.isDirty())
      } catch (error) {
        if (!isCurrentInitialization()) return
        console.error('Failed to initialize Yjs document:', error)
      }
    }

    setDirty(false)
    void initDoc()

    return () => {
      initializationCancelled = true
    }
  }, [noteId, masterKey])

  // 保存到本地
  const saveToLocal = useCallback(async () => {
    const docManager = docManagerRef.current
    const localPersistence = localPersistenceRef.current
    const documentState = docManager?.getState()

    if (
      !documentState ||
      documentState.noteId !== noteId ||
      !localPersistence ||
      !masterKey
    ) return

    try {
      const snapshot = encodeYDoc(documentState.doc)
      await localPersistence.saveSnapshot(noteId, snapshot, masterKey)
    } catch (error) {
      console.error('Failed to save to local storage:', error)
    }
  }, [masterKey, noteId])

  // 从本地加载
  const loadFromLocal = useCallback(async (): Promise<string | null> => {
    const localPersistence = localPersistenceRef.current
    if (!localPersistence || !masterKey) return null

    try {
      return await localPersistence.loadSnapshot(noteId, masterKey)
    } catch (error) {
      console.error('Failed to load from local storage:', error)
      return null
    }
  }, [masterKey, noteId])

  const deleteLocal = useCallback(async (): Promise<void> => {
    const localPersistence = localPersistenceRef.current
    if (!localPersistence || !noteId) return
    await localPersistence.deleteSnapshot(noteId)
  }, [noteId])

  // 同步函数
  const sync = useCallback(async (): Promise<SyncResult> => {
    const syncController = syncControllerRef.current
    const docManager = docManagerRef.current
    const syncDocumentState = docManager?.getState()
    if (
      !syncController ||
      !syncDocumentState ||
      syncDocumentState.noteId !== noteId
    ) {
      console.error('SyncController not initialized')
      return { success: false, mergedRemote: false, error: 'SyncController not initialized' }
    }
    const syncDocument = syncDocumentState.doc

    syncInProgressRef.current = true

    try {
      const result = await syncController.sync(noteId)

      if (result.success) {
        try {
          const localPersistence = localPersistenceRef.current
          if (localPersistence && masterKey) {
            const { encodeYDoc: encode } = await import('../lib/yjs')
            const snapshot = encode(syncDocument)
            await localPersistence.saveSnapshot(noteId, snapshot, masterKey)
          }
          setLastSyncStatus({ type: 'success', mergedRemote: result.mergedRemote })
          setIsSyncing(false)
          onSyncComplete?.(result.mergedRemote)
        } catch (localError) {
          const message = localError instanceof Error ? localError.message : '本地快照保存失败'
          console.error('Failed to persist local Yjs snapshot after sync:', localError)
          setLastSyncStatus({ type: 'error', message: `本地快照保存失败: ${message}`, canRetry: true })
          setIsSyncing(false)
          onSyncError?.(message)
          // NOTE: intentionally return result (success=true) here so VaultView.saveSelected()
          // proceeds with its downstream encrypted-note IDB write even when local Yjs snapshot fails.
        }
      } else {
        setIsSyncing(false)
        onSyncError?.(result.error ?? '同步失败')
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步失败'
      setIsSyncing(false)
      onSyncError?.(message)
      return { success: false, mergedRemote: false, error: message }
    } finally {
      syncInProgressRef.current = false
    }
  }, [masterKey, noteId, onSyncComplete, onSyncError])

  // 自动保存到本地（当文档变化时）
  useEffect(() => {
    const currentDocument = activeDocument?.noteId === noteId
      ? activeDocument.document
      : null
    if (!currentDocument || !dirty) return

    const timer = setTimeout(() => {
      saveToLocal()
    }, 1000) // 1秒后自动保存

    return () => clearTimeout(timer)
  }, [activeDocument, dirty, noteId, saveToLocal])

  // 最佳实践：页面隐藏或卸载时刷新本地快照（不阻塞，静默失败）
  useEffect(() => {
    const flushLocalSnapshot = () => {
      const docManager = docManagerRef.current
      const localPersistence = localPersistenceRef.current
      const documentState = docManager?.getState()
      if (
        !documentState ||
        documentState.noteId !== noteId ||
        !localPersistence ||
        !masterKey ||
        !noteId
      ) return

      const snapshot = encodeYDoc(documentState.doc)
      localPersistence.saveSnapshot(noteId, snapshot, masterKey).catch(() => {
        // 静默失败，不阻塞页面卸载
      })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushLocalSnapshot()
      }
    }

    const handlePageHide = () => {
      flushLocalSnapshot()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [masterKey, noteId])

  return {
    doc: activeDocument?.noteId === noteId ? activeDocument.document : null,
    documentNoteId: activeDocument?.noteId ?? null,
    documentGeneration: activeDocument?.noteId === noteId
      ? activeDocument.generation
      : 0,
    sync,
    isSyncing,
    dirty,
    lastSyncStatus,
    saveToLocal,
    loadFromLocal,
    deleteLocal,
  }
}
