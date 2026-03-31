import { useEffect, useRef, useState, useCallback } from 'react'
import * as Y from 'yjs'
import {
  YjsDocManager,
  SyncController,
  LocalPersistence,
  encodeYDoc,
} from '../lib/yjs'
import type { SyncResult, SyncStatus, NotePayloadWithYjs } from '../lib/yjs'

export interface UseYjsSyncOptions {
  noteId: string
  initialSnapshot?: string | null
  api: {
    getNote: (noteId: string) => Promise<NotePayloadWithYjs | null>
    putNote: (noteId: string, payload: NotePayloadWithYjs) => Promise<void>
  }
  onSyncComplete?: (mergedRemote: boolean) => void
  onSyncError?: (error: string) => void
}

export interface UseYjsSyncReturn {
  doc: Y.Doc | null
  sync: () => Promise<SyncResult>
  isSyncing: boolean
  dirty: boolean
  lastSyncStatus: SyncStatus
  saveToLocal: () => Promise<void>
  loadFromLocal: () => Promise<string | null>
}

/**
 * Hook to manage Yjs document synchronization
 * 封装 YjsDocManager、SyncController、LocalPersistence
 */
export function useYjsSync(options: UseYjsSyncOptions): UseYjsSyncReturn {
  const { noteId, initialSnapshot, api, onSyncComplete, onSyncError } = options

  // 使用 ref 存储管理器实例，避免重复创建
  const docManagerRef = useRef<YjsDocManager | null>(null)
  const syncControllerRef = useRef<SyncController | null>(null)
  const localPersistenceRef = useRef<LocalPersistence | null>(null)

  // 状态
  const [doc, setDoc] = useState<Y.Doc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [lastSyncStatus, setLastSyncStatus] = useState<SyncStatus>({ type: 'idle' })
  const [isSyncing, setIsSyncing] = useState(false)

  // 用于追踪同步中状态，避免 SyncController 的 success 在本地持久化完成前流入 UI
  const syncInProgressRef = useRef(false)

  // 初始化管理器
  useEffect(() => {
    if (!docManagerRef.current) {
      docManagerRef.current = new YjsDocManager()
    }
    if (!localPersistenceRef.current) {
      localPersistenceRef.current = new LocalPersistence()
    }
    if (!syncControllerRef.current && docManagerRef.current) {
      syncControllerRef.current = new SyncController(docManagerRef.current, api)
      
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
  }, [api])

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
    const initDoc = async () => {
      const docManager = docManagerRef.current
      const localPersistence = localPersistenceRef.current
      if (!docManager || !localPersistence) return

      try {
        if (!noteId) {
          setDoc(null)
          setDirty(false)
          return
        }

        // 尝试从本地加载，缺失时使用初始快照
        const localSnapshot = await localPersistence.loadSnapshot(noteId)
        const snapshot = localSnapshot ?? initialSnapshot ?? undefined
        const initializedDoc = await docManager.initialize(noteId, snapshot)
        setDoc(initializedDoc)
        setDirty(docManager.isDirty())
      } catch (error) {
        console.error('Failed to initialize Yjs document:', error)
      }
    }

    initDoc()
  }, [noteId, initialSnapshot])

  // 保存到本地
  const saveToLocal = useCallback(async () => {
    const docManager = docManagerRef.current
    const localPersistence = localPersistenceRef.current
    const currentDoc = docManager?.getDoc()

    if (!currentDoc || !localPersistence) return

    try {
      const snapshot = encodeYDoc(currentDoc)
      await localPersistence.saveSnapshot(noteId, snapshot)
    } catch (error) {
      console.error('Failed to save to local storage:', error)
    }
  }, [noteId])

  // 从本地加载
  const loadFromLocal = useCallback(async (): Promise<string | null> => {
    const localPersistence = localPersistenceRef.current
    if (!localPersistence) return null

    try {
      return await localPersistence.loadSnapshot(noteId)
    } catch (error) {
      console.error('Failed to load from local storage:', error)
      return null
    }
  }, [noteId])

  // 同步函数
  const sync = useCallback(async (): Promise<SyncResult> => {
    const syncController = syncControllerRef.current
    if (!syncController) {
      console.error('SyncController not initialized')
      return { success: false, mergedRemote: false, error: 'SyncController not initialized' }
    }

    syncInProgressRef.current = true

    try {
      const result = await syncController.sync(noteId)

      if (result.success) {
        try {
          const docManager = docManagerRef.current
          const localPersistence = localPersistenceRef.current
          const currentDoc = docManager?.getDoc()
          if (currentDoc && localPersistence) {
            const { encodeYDoc: encode } = await import('../lib/yjs')
            const snapshot = encode(currentDoc)
            await localPersistence.saveSnapshot(noteId, snapshot)
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
  }, [noteId, onSyncComplete, onSyncError])

  // 自动保存到本地（当文档变化时）
  useEffect(() => {
    if (!doc || !dirty) return

    const timer = setTimeout(() => {
      saveToLocal()
    }, 1000) // 1秒后自动保存

    return () => clearTimeout(timer)
  }, [doc, dirty, saveToLocal])

  // 最佳实践：页面隐藏或卸载时刷新本地快照（不阻塞，静默失败）
  useEffect(() => {
    const flushLocalSnapshot = () => {
      const docManager = docManagerRef.current
      const localPersistence = localPersistenceRef.current
      const currentDoc = docManager?.getDoc()
      if (!currentDoc || !localPersistence || !noteId) return

      const snapshot = encodeYDoc(currentDoc)
      localPersistence.saveSnapshot(noteId, snapshot).catch(() => {
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
  }, [noteId])

  return {
    doc,
    sync,
    isSyncing,
    dirty,
    lastSyncStatus,
    saveToLocal,
    loadFromLocal,
  }
}
