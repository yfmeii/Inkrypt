import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { postJSON } from '../lib/api'
import { bytesToBase64, bytesToHex, encryptNotePayload, noteAad, type NotePayload } from '../lib/crypto'
import { formatErrorZh } from '../lib/errors'
import { useFocusTrap } from '../lib/focusTrap'
import { useBodyScrollLock } from '../lib/scrollLock'
import { estimateDataUrlBytes, fileToDataUrl } from '../lib/attachments'
import {
  idbDeleteDraftNote,
  idbUpsertEncryptedNotes,
} from '../lib/idb'
import { useInkryptStore, type DecryptedNote } from '../state/store'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { BlockNoteComponent, type BlockNoteComponentRef } from '../components/BlockNote'
import { DrawingEditor } from '../components/DrawingEditor'
import { AttachmentsPanel } from '../components/AttachmentsPanel'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Toast, ToastStack } from '../components/Toast'
import { SettingsPanel } from '../components/SettingsPanel'
import { SearchDialog } from '../components/SearchDialog'
import { useYjsSync } from '../hooks/useYjsSync'
import { detectNoteFormat, migrateToYjs, encodeYDoc, mergeYDocs } from '../lib/yjs'
import type { NotePayloadWithYjs, YjsNotePayload } from '../lib/yjs'
import { countAttachmentRefs, useVaultAttachments } from './vault/attachments'
import {
  type LocalDraftInfo,
  applySelectedBaselineState,
  applySelectedDraftOverlay,
  loadSelectedDraftSnapshot,
  resetSelectedDraftState,
  seedSelectedDraftState,
  useSelectedDraftController,
  useLocalDraftPersistence,
} from './vault/drafts'
import { useVaultNavigation } from './vault/navigation'
import { useVaultPairing } from './vault/pairing'
import {
  VaultDialogs,
  type VaultDialogsControllers,
} from './vault/VaultDialogs'
import { VaultEditorHeader } from './vault/VaultEditorHeader'
import { VaultSidebar } from './vault/VaultSidebar'
import { loadNotesFromIdb as loadNotesFromIdbState } from './vault/lifecycle.local'
import {
  createNotePersistence,
  deleteNotePersistence,
  syncNotesFromRemote,
} from './vault/lifecycle.remote'
import { createVaultSyncApi } from './vault/lifecycle.sync-api'
import { migrateLegacyNotesInBackground as migrateLegacyNotesInBackgroundState } from './vault/lifecycle.migration'
import { type SyncSavedRecord } from './vault/lifecycle.shared'
import { buildSyncButtonState, prepareSelectedSave, SYNC_BUSY_TEXT } from './vault/editor-state'
import { buildSearchDialogResults, createSearchQueryState, SEARCH_PAGE_SIZE, useVaultSearchIndex, useVaultSearchResults } from './vault/search'
import {
  createDrawingId,
  type DrawingInitialData,
  getAttachmentNameFromUrl,
  getDrawingAttachmentNames,
  getDrawingIdFromAttachment,
  MAX_DRAWING_PREVIEW_BYTES,
  MAX_DRAWING_SCENE_BYTES,
  parseDrawingSceneData,
  sceneJsonToDataUrl,
} from '../lib/drawing'
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar'
import { Button } from '../components/ui/button'
import { Plus, Search, Settings, RefreshCw, Lock, Edit3 } from 'lucide-react'
import { cn } from '../lib/utils'
import type { QuickActionsController } from '../components/settings/QuickActionsSection'

export function VaultView() {
  const masterKey = useInkryptStore((s) => s.masterKey)
  const credentialId = useInkryptStore((s) => s.credentialId)
  const setDeviceName = useInkryptStore((s) => s.setDeviceName)
  const brandName = useInkryptStore((s) => s.brandName)
  const setBrandName = useInkryptStore((s) => s.setBrandName)
  const theme = useInkryptStore((s) => s.theme)
  const setTheme = useInkryptStore((s) => s.setTheme)
  const mode = useInkryptStore((s) => s.mode)
  const setMode = useInkryptStore((s) => s.setMode)
  const notes = useInkryptStore((s) => s.notes)
  const selectedNoteId = useInkryptStore((s) => s.selectedNoteId)
  const lock = useInkryptStore((s) => s.lock)
  const setNotes = useInkryptStore((s) => s.setNotes)
  const upsertNote = useInkryptStore((s) => s.upsertNote)
  const removeNote = useInkryptStore((s) => s.removeNote)
  const selectNote = useInkryptStore((s) => s.selectNote)

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [searchLimit, setSearchLimit] = useState(SEARCH_PAGE_SIZE)
  const [notesLoaded, setNotesLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyText, setBusyText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showRecoveryCode, setShowRecoveryCode] = useState(false)
  const [confirmShowRecoveryCode, setConfirmShowRecoveryCode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [confirmDeleteNote, setConfirmDeleteNote] = useState(false)
  const [confirmLock, setConfirmLock] = useState(false)
  const [confirmDeleteDrawing, setConfirmDeleteDrawing] = useState<{ blockId: string; drawingId: string; title: string } | null>(null)
  const [drawingEditorOpen, setDrawingEditorOpen] = useState(false)
  const [drawingEditorSaving, setDrawingEditorSaving] = useState(false)
  const [activeDrawingId, setActiveDrawingId] = useState<string | null>(null)
  const [activeDrawingBlockId, setActiveDrawingBlockId] = useState<string | null>(null)
  const [drawingTitle, setDrawingTitle] = useState('')
  const [drawingInitialData, setDrawingInitialData] = useState<DrawingInitialData | null>(null)
  // Default true if not set
  const [showInfo, setShowInfo] = useState(() => !localStorage.getItem('inkrypt_hide_info'))

  const isNarrow = useMediaQuery('(max-width: 900px)')
  const { mobilePane, navigateToNote, navigateToList } = useVaultNavigation({
    isNarrow,
    notes,
    selectedNoteId,
    selectNote,
  })

  const selected = useMemo(
    () => (selectedNoteId ? notes.find((note) => note.id === selectedNoteId) ?? null : null),
    [notes, selectedNoteId],
  )

  const [localDraftInfo, setLocalDraftInfo] = useState<LocalDraftInfo | null>(null)
  const [localDraftSaving, setLocalDraftSaving] = useState(false)
  const [localDraftError, setLocalDraftError] = useState<string | null>(null)

  const {
    selectedBaseline,
    setSelectedBaseline,
    editBaseVersion,
    setEditBaseVersion,
    draftTitle,
    setDraftTitle,
    draftContent,
    setDraftContent,
    draftTags,
    setDraftTags,
    draftFavorite,
    setDraftFavorite,
    draftAttachments,
    setDraftAttachments,
    blockNoteKey,
    setBlockNoteKey,
    draftContentRef,
    draftStateRef,
    dirty,
    stateSetters: selectedDraftStateSetters,
  } = useSelectedDraftController({
    selected,
    setLocalDraftInfo,
    setLocalDraftError,
  })

  const {
    showAttachments,
    setShowAttachments,
    attachmentsBusy,
    attachmentsProgress,
    confirmRemoveAttachment,
    setConfirmRemoveAttachment,
    confirmCleanupUnusedAttachments,
    setConfirmCleanupUnusedAttachments,
    attachmentRefs,
    resetAttachmentUi,
    addAttachments,
    actuallyRemoveAttachment,
    removeAttachment,
    downloadAttachment,
    handleBlockNoteAddAttachment,
    handleBlockNoteFiles,
  } = useVaultAttachments({
    selected,
    draftAttachments,
    draftContent,
    setDraftAttachments,
    setError,
  })

  const blockNoteRef = useRef<BlockNoteComponentRef | null>(null)
  const yjsContentSyncTimerRef = useRef<number | null>(null)
  const pendingDrawingInsertRef = useRef<((value: { drawingId: string; previewFilename: string; sceneFilename: string; title: string } | null) => void) | null>(null)
  const recoveryCodeModalRef = useRef<HTMLDivElement>(null)
  const helpModalRef = useRef<HTMLDivElement>(null)

  useFocusTrap(recoveryCodeModalRef, showRecoveryCode)
  useFocusTrap(helpModalRef, showHelp)

  const {
    pairing,
    setPairing,
    pairingBusy,
    pairingError,
    setPairingError,
    startPairing,
    cancelPairing,
    confirmPairing,
  } = useVaultPairing(masterKey)

  const legacyMigrationRunIdRef = useRef(0)
  const legacyMigrationInFlightRef = useRef(false)
  useEffect(() => {
    legacyMigrationRunIdRef.current += 1
  }, [masterKey])

  useBodyScrollLock(Boolean(pairing) || showRecoveryCode || showHelp)

  useEffect(() => {
    if (!pairing && !showRecoveryCode && !showHelp) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return

      if (showHelp) {
        setShowHelp(false)
        return
      }

      if (showRecoveryCode) {
        setShowRecoveryCode(false)
        return
      }

      if (pairing) {
        if (pairing.stage === 'sent') setPairing(null)
        else void cancelPairing()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelPairing, pairing, showHelp, showRecoveryCode])

  // 更新浏览器标题为自定义显示名称
  useEffect(() => {
    document.title = brandName
    return () => {
      document.title = 'Inkrypt'
    }
  }, [brandName])

  const selectedFormat = useMemo(() => {
    if (!selected) return 'legacy'
    return detectNoteFormat(selected.payload as YjsNotePayload)
  }, [selected])

  const selectedSnapshot = useMemo(() => {
    if (!selected || selectedFormat !== 'yjs') return null
    return (selected.payload as YjsNotePayload).yjsSnapshotB64 ?? null
  }, [selected, selectedFormat])

  const syncRemoteVersionRef = useRef<number>(0)
  const syncSavedRef = useRef<SyncSavedRecord | null>(null)
  const selectedRef = useRef<DecryptedNote | null>(null)
  selectedRef.current = selected

  const syncApi = useMemo(
    () => createVaultSyncApi({ masterKey, draftStateRef, selectedRef, syncRemoteVersionRef, syncSavedRef }),
    [masterKey],
  )

  // Yjs sync hook - 仅在选中笔记且有 masterKey 时启用
  const yjsSync = useYjsSync({
    noteId: masterKey && selectedNoteId ? selectedNoteId : '',
    initialSnapshot: selectedSnapshot,
    api: syncApi,
    onSyncError: (error) => {
      setError(error)
    }
  })

  useEffect(() => {
    syncRemoteVersionRef.current = 0
    syncSavedRef.current = null
  }, [selectedNoteId])

  const selectedNoteIdRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const selectedBaselineRef = useRef<NotePayload | null>(null)
  selectedNoteIdRef.current = selectedNoteId
  dirtyRef.current = dirty
  selectedBaselineRef.current = selectedBaseline

  const searchQuery = useMemo(() => createSearchQueryState(deferredSearch), [deferredSearch])

  useEffect(() => {
    setSearchLimit(SEARCH_PAGE_SIZE)
  }, [searchQuery])

  const {
    indexBuild,
    indexError,
    clearIndexError,
    resetSearchState,
    rememberNoteSearchText,
    forgetNoteSearchText,
    searchIndex,
    searchIndexTick,
  } = useVaultSearchIndex(notes, masterKey)

  useEffect(() => {
    if (masterKey) return
    resetSearchState()
    setSearch('')
    setSearchLimit(SEARCH_PAGE_SIZE)
  }, [masterKey, resetSearchState])

  const { fallbackSearchBusy, searchHasMore, visibleNotes } = useVaultSearchResults({
    notes,
    searchQuery,
    searchLimit,
    searchIndexTick,
    searchIndex,
  })

  // 自动保存到云端的函数（使用 ref 避免依赖问题）
  const saveSelectedRef = useRef<((options?: { silent?: boolean }) => Promise<void>) | null>(null)

  const {
    cancelPendingSave: cancelPendingLocalDraftSave,
  } = useLocalDraftPersistence({
    masterKey,
    selected,
    selectedBaseline,
    editBaseVersion,
    busy,
    dirty,
    draftTitle,
    draftContent,
    draftTags,
    draftFavorite,
    draftAttachments,
    setLocalDraftInfo,
    setLocalDraftSaving,
    setLocalDraftError,
  })

  // 同步按钮状态 - 使用 Yjs sync 状态
  const yjsDirty = yjsSync.dirty || dirty
  const syncStatus = yjsSync.lastSyncStatus
  const syncButtonState = buildSyncButtonState({
    isSyncing: yjsSync.isSyncing,
    busy,
    busyText,
    syncStatus,
    yjsDirty,
    localDraftSaving,
    localDraftInfo,
    selectedUpdatedAt: selected?.updated_at ?? null,
    localDraftError,
  })
  const isSyncing = syncButtonState.isSyncing
  const editorInputsDisabled = attachmentsBusy || !selectedBaseline || (busy && !isSyncing)
  const editorContentDisabled = editorInputsDisabled

  const syncButton = (
    <Button 
      variant="ghost" 
      size="icon" 
      className="size-9 relative text-muted-foreground hover:text-foreground"
      onClick={() => void saveSelected()}
      onMouseDown={(event) => event.preventDefault()}
      disabled={busy || !selected || !yjsSync.doc}
      title={syncButtonState.title}
    >
      <RefreshCw className={cn("size-[18px]", isSyncing && "animate-spin")} />
      {/* 右下角状态小圆点 */}
      {!isSyncing && (
        <span className={cn(
          "absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full",
          "ring-2 ring-background",
          syncButtonState.statusDotColor
        )} />
      )}
      <span className="sr-only">同步</span>
    </Button>
  )

  const selectedLoadRunIdRef = useRef(0)

  useEffect(() => {
    const noteId = selectedNoteId
    const runId = ++selectedLoadRunIdRef.current
    const selectedSnapshot = selectedRef.current

    cancelPendingLocalDraftSave()
    setLocalDraftSaving(false)
    resetAttachmentUi()
    setDrawingEditorOpen(false)
    setDrawingEditorSaving(false)
    setConfirmDeleteDrawing(null)
    setActiveDrawingId(null)
    setActiveDrawingBlockId(null)
    setDrawingTitle('')
    setDrawingInitialData(null)
    if (pendingDrawingInsertRef.current) {
      pendingDrawingInsertRef.current(null)
      pendingDrawingInsertRef.current = null
    }

    if (!noteId) {
      resetSelectedDraftState(selectedDraftStateSetters)
      return
    }

    seedSelectedDraftState({ noteId, selected: selectedSnapshot, setters: selectedDraftStateSetters })

    if (!masterKey) return

    void (async () => {
      try {
        const snapshot = await loadSelectedDraftSnapshot({ masterKey, noteId })
        if (!snapshot) {
          const currentSelected = selectedRef.current
          if (!currentSelected || currentSelected.id !== noteId) return
          flushSync(() => {
            applySelectedBaselineState({
              baseline: currentSelected.payload,
              baselineVersion: currentSelected.version,
              setters: selectedDraftStateSetters,
            })
          })
          return
        }
        if (selectedLoadRunIdRef.current !== runId) return

        flushSync(() => {
          applySelectedBaselineState({
            baseline: snapshot.baseline,
            baselineVersion: snapshot.baselineVersion,
            setters: selectedDraftStateSetters,
          })
        })

        if (!snapshot.draft) return
        if (selectedLoadRunIdRef.current !== runId) return

        flushSync(() => {
          const draft = snapshot.draft
          if (!draft) return
          applySelectedDraftOverlay({
            payload: draft.payload,
            baseVersion: draft.baseVersion,
            savedAt: draft.savedAt,
            includeContent: snapshot.format === 'legacy',
            setters: selectedDraftStateSetters,
          })
        })
      } catch (err) {
        if (selectedLoadRunIdRef.current !== runId) return
        const currentSelected = selectedRef.current
        if (currentSelected && currentSelected.id === noteId) {
          flushSync(() => {
            applySelectedBaselineState({
              baseline: currentSelected.payload,
              baselineVersion: currentSelected.version,
              setters: selectedDraftStateSetters,
            })
          })
        }
        setError(formatErrorZh(err))
      }
    })()
  }, [cancelPendingLocalDraftSave, masterKey, resetAttachmentUi, selectedDraftStateSetters, selectedNoteId])

  useEffect(() => {
    void (async () => {
      setNotesLoaded(false)
      try {
        await loadNotesFromIdbState({
          masterKey,
          resetSearchState,
          rememberNoteSearchText,
          setNotes,
        })
      } finally {
        setNotesLoaded(true)
      }
      await syncNow()
      setTimeout(() => void runLegacyMigration().catch(() => null), 0)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runLegacyMigration(): Promise<void> {
    if (legacyMigrationInFlightRef.current) return

    const runId = legacyMigrationRunIdRef.current
    legacyMigrationInFlightRef.current = true
    try {
      await migrateLegacyNotesInBackgroundState({
        masterKey,
        selectedNoteId: selectedNoteIdRef.current,
        dirty: dirtyRef.current,
        selectedBaseline: selectedBaselineRef.current,
        currentRunId: runId,
        getActiveRunId: () => legacyMigrationRunIdRef.current,
        rememberNoteSearchText,
        upsertNote,
        onSelectedMigrated: (payload, version) => {
          setSelectedBaseline(payload)
          setEditBaseVersion(version)
        },
      })
    } finally {
      legacyMigrationInFlightRef.current = false
    }
  }

  async function syncNow() {
    if (!masterKey) return
    setError(null)
    setBusyText(SYNC_BUSY_TEXT)
    setBusy(true)
    try {
      await syncNotesFromRemote({
        masterKey,
        selectedNoteId,
        dirty,
        selectedBaseline,
        forgetNoteSearchText,
        rememberNoteSearchText,
        removeNote,
        upsertNote,
        onSelectedRemoteUpdate: (note, payload) => {
          flushSync(() => {
            setSelectedBaseline(payload)
            setDraftTitle(payload.meta.title)
            setDraftContent(payload.content)
            setDraftTags(payload.meta.tags.join(', '))
            setDraftFavorite(payload.meta.is_favorite)
            setDraftAttachments(payload.attachments ?? {})
            setEditBaseVersion(note.version)
            setBlockNoteKey((key) => key + 1)
          })
        },
      })
    } catch (err) {
      setError(formatErrorZh(err))
    } finally {
      setBusy(false)
      setBusyText(null)
      setTimeout(() => void runLegacyMigration().catch(() => null), 0)
    }
  }

  async function createNote() {
    if (!masterKey) return
    setError(null)
    setBusyText('正在创建笔记…')
    setBusy(true)
    try {
      const id = await createNotePersistence({ masterKey, upsertNote, rememberNoteSearchText })
      navigateToNote(id)
    } catch (err) {
      setError(formatErrorZh(err))
    } finally {
      setBusy(false)
      setBusyText(null)
    }
  }

  async function saveSelected(options?: { silent?: boolean }) {
    if (!masterKey || !selected) return
    setError(null)
    cancelPendingLocalDraftSave()
    const silent = options?.silent === true
    if (!silent) {
      setBusyText(SYNC_BUSY_TEXT)
      setBusy(true)
    }
    try {
      const requireSyncSaved = (): SyncSavedRecord => {
        const saved = syncSavedRef.current
        if (!saved) throw new Error('同步完成，但未收到服务器确认')
        return saved
      }
      const { content, payload, payloadForStore } = prepareSelectedSave({
        markdown: blockNoteRef.current?.getMarkdown(),
        currentContent: draftContentRef.current,
        updateDraftContent: (nextContent) => {
          draftContentRef.current = nextContent
          setDraftContent(nextContent)
        },
        draftTitle,
        createdAt: selectedBaseline?.meta.created_at ?? selected.payload.meta.created_at,
        draftTags,
        draftFavorite,
        draftAttachments,
      })
      syncSavedRef.current = null
      draftStateRef.current = {
        title: payload.meta.title,
        tags: payload.meta.tags,
        is_favorite: payload.meta.is_favorite,
        attachments: draftAttachments,
        content,
        createdAt: payload.meta.created_at,
      }
      if (!yjsSync.doc) throw new Error('文档尚未初始化，请稍后再试')

      if (selectedFormat === 'legacy' && yjsSync.doc) {
        const editor = blockNoteRef.current?.getEditor()
        const fragment = yjsSync.doc.getXmlFragment('document-store')
        if (editor && fragment.length === 0) {
          const migration = await migrateToYjs(payload, editor)
          mergeYDocs(yjsSync.doc, migration.doc)
        }
      }

      const result = await yjsSync.sync()
      if (!result.success) throw new Error(result.error ?? '同步失败，请稍后重试')

      const saved = requireSyncSaved()

      const yjsSnapshotB64 = yjsSync.doc ? encodeYDoc(yjsSync.doc) : undefined
      const payloadWithYjs = yjsSnapshotB64
        ? ({ ...payload, format: 'blocknote+yjs-v1', yjsSnapshotB64 } as NotePayload)
        : payload
      const enc = await encryptNotePayload(masterKey, payloadWithYjs, noteAad(selected.id))

      await idbUpsertEncryptedNotes([
        {
          id: selected.id,
          version: saved.version,
          updated_at: saved.updated_at,
          is_deleted: 0,
          encrypted_data: enc.encrypted_data,
          data_iv: enc.iv,
        },
      ])

      rememberNoteSearchText(selected.id, payload)
      upsertNote({ ...selected, version: saved.version, updated_at: saved.updated_at, payload: payloadForStore })
      setSelectedBaseline(payload)
      setEditBaseVersion(saved.version)
      setLocalDraftInfo(null)
      setLocalDraftError(null)
      setLocalDraftSaving(false)
      await idbDeleteDraftNote(selected.id)
    } catch (err) {
      setError(formatErrorZh(err))
    } finally {
      if (!silent) {
        setBusy(false)
        setBusyText(null)
      }
    }
  }

  // 更新 saveSelectedRef 以便自动保存使用
  useEffect(() => {
    saveSelectedRef.current = saveSelected
  })

  useEffect(() => {
    if (!selected || !masterKey || !selectedBaseline || !dirty) return
    if (attachmentsBusy) return

    const timer = window.setTimeout(() => {
      if (saveSelectedRef.current) {
        void saveSelectedRef.current({ silent: true })
      }
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [attachmentsBusy, dirty, draftAttachments, draftContent, draftFavorite, draftTags, draftTitle, masterKey, selected, selectedBaseline])

  // Ctrl/Cmd+S to save current note to cloud
  // 使用捕获阶段，确保在 BlockNote 编辑器之前处理快捷键
  useEffect(() => {
    const handleSaveShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        e.stopPropagation()
        // 只要有选中的笔记且不在忙碌状态，就允许保存
        if (selected && !busy) {
          // 使用 ref 获取最新的 saveSelected 函数
          if (saveSelectedRef.current) {
            void saveSelectedRef.current()
          }
        }
      }
    }
    // 使用 capture: true 确保在编辑器之前捕获事件
    window.addEventListener('keydown', handleSaveShortcut, true)
    return () => window.removeEventListener('keydown', handleSaveShortcut, true)
  }, [selected, busy])

  async function softDeleteSelected() {
    if (!masterKey || !selected) return
    setError(null)
    setBusyText('正在删除…')
    setBusy(true)
    try {
      await deleteNotePersistence({ masterKey, selected, forgetNoteSearchText, removeNote })
    } catch (err) {
      setError(formatErrorZh(err))
    } finally {
      setBusy(false)
      setBusyText(null)
    }
  }

  /**
   * Handle BlockNote content changes
   * Content is already markdown string
   */
  function handleBlockNoteChange(markdown: string): void {
    draftContentRef.current = markdown
    setDraftContent(markdown)
  }

  function handleYjsDocChange(event: { suppressDraftUpdate: boolean }): void {
    if (event.suppressDraftUpdate) return
    if (yjsContentSyncTimerRef.current) {
      window.clearTimeout(yjsContentSyncTimerRef.current)
    }
    yjsContentSyncTimerRef.current = window.setTimeout(() => {
      const markdown = blockNoteRef.current?.getMarkdown()
      if (typeof markdown === 'string' && markdown !== draftContentRef.current) {
        draftContentRef.current = markdown
        setDraftContent(markdown)
      }
    }, 200)
  }

  function syncDraftContentFromEditor(): void {
    const markdown = blockNoteRef.current?.getMarkdown()
    if (typeof markdown === 'string') {
      draftContentRef.current = markdown
      setDraftContent(markdown)
    }
  }

  function openNewDrawing(drawingId?: string): string | null {
    if (!selected || busy || attachmentsBusy || !selectedBaseline) return null
    setError(null)
    const nextId = drawingId ?? createDrawingId()
    setActiveDrawingId(nextId)
    setActiveDrawingBlockId(null)
    setDrawingTitle('')
    setDrawingInitialData(null)
    setDrawingEditorOpen(true)
    return nextId
  }

  async function openExistingDrawing(sceneAttachmentName: string, options?: { blockId?: string; title?: string }): Promise<void> {
    const drawingId = getDrawingIdFromAttachment(sceneAttachmentName)
    const sceneDataUrl = draftAttachments[sceneAttachmentName]
    if (!drawingId || !sceneDataUrl) {
      setError('未找到对应的绘图源文件')
      return
    }

    try {
      setError(null)
      const sceneData = await parseDrawingSceneData(sceneDataUrl)
      setActiveDrawingId(drawingId)
      setActiveDrawingBlockId(options?.blockId ?? null)
      setDrawingTitle(options?.title === '未命名绘图' ? '' : (options?.title ?? ''))
      setDrawingInitialData(sceneData)
      setDrawingEditorOpen(true)
      setShowAttachments(false)
    } catch (err) {
      setError(formatErrorZh(err))
    }
  }

  async function openExistingDrawingByUrl(sceneUrl: string, options?: { drawingId?: string; blockId?: string; title?: string }): Promise<void> {
    const sceneAttachmentName = getAttachmentNameFromUrl(sceneUrl)
    if (!sceneAttachmentName) {
      setError('未找到对应的绘图源文件')
      return
    }

    if (options?.drawingId && !draftAttachments[sceneAttachmentName]) {
      const { scene } = getDrawingAttachmentNames(options.drawingId)
      if (draftAttachments[scene]) {
        await openExistingDrawing(scene, options)
        return
      }
    }

    await openExistingDrawing(sceneAttachmentName, options)
  }

  async function handleInsertDrawingFromSlashMenu(): Promise<{ drawingId: string; previewFilename: string; sceneFilename: string; title: string } | null> {
    const drawingId = openNewDrawing()
    if (!drawingId) return null
    return await new Promise((resolve) => {
      pendingDrawingInsertRef.current = resolve
    })
  }

  async function handleSaveDrawing(payload: { drawingId: string; title: string; sceneJson: string; previewBlob: Blob }): Promise<void> {
    const { drawingId, title, sceneJson, previewBlob } = payload
    const sceneBytes = new TextEncoder().encode(sceneJson).length
    if (sceneBytes > MAX_DRAWING_SCENE_BYTES) {
      throw new Error('绘图源文件超过 3MB。Excalidraw 内嵌图片会显著增大体积，请压缩图片或减少嵌入图片后重试')
    }

    const previewDataUrl = await fileToDataUrl(previewBlob)
    const previewBytes = estimateDataUrlBytes(previewDataUrl)
    if ((previewBytes ?? Number.MAX_SAFE_INTEGER) > MAX_DRAWING_PREVIEW_BYTES) {
      throw new Error('绘图预览图超过 1.5MB，请缩小画布或减少复杂内容后重试')
    }

    const { scene, preview } = getDrawingAttachmentNames(drawingId)
    const sceneDataUrl = sceneJsonToDataUrl(sceneJson)

    setDrawingEditorSaving(true)
    setError(null)
    try {
      setDraftAttachments((prev) => ({
        ...prev,
        [scene]: sceneDataUrl,
        [preview]: previewDataUrl,
      }))

      if (pendingDrawingInsertRef.current) {
        const resolvePendingInsert = pendingDrawingInsertRef.current
        pendingDrawingInsertRef.current = null
        resolvePendingInsert({
          drawingId,
          previewFilename: preview,
          sceneFilename: scene,
          title,
        })
      } else {
        const currentContent = blockNoteRef.current?.getMarkdown() ?? draftContentRef.current
        if (countAttachmentRefs(currentContent, preview) === 0) {
          blockNoteRef.current?.insertDrawingCard({
            drawingId,
            previewFilename: preview,
            sceneFilename: scene,
            title,
          })
          window.setTimeout(() => syncDraftContentFromEditor(), 0)
        } else if (activeDrawingBlockId) {
          const editor = blockNoteRef.current?.getEditor() as any
          if (editor?.updateBlock) {
            editor.updateBlock(activeDrawingBlockId, {
              type: 'drawingCard',
              props: {
                title: title || '未命名绘图',
              },
            })
            window.setTimeout(() => syncDraftContentFromEditor(), 0)
          }
        }
      }

      setDrawingEditorOpen(false)
      setActiveDrawingBlockId(null)
      setDrawingTitle('')
      setDrawingInitialData(null)
    } finally {
      setDrawingEditorSaving(false)
    }
  }

  function handleDownloadDrawingPreview(previewAttachmentUrl: string): void {
    const attachmentName = getAttachmentNameFromUrl(previewAttachmentUrl)
    if (!attachmentName) return
    downloadAttachment(attachmentName)
  }

  function handleDeleteDrawing(blockId: string, drawingId: string): void {
    const editor = blockNoteRef.current?.getEditor() as any
    const { scene, preview } = getDrawingAttachmentNames(drawingId)

    if (editor?.removeBlocks) {
      editor.removeBlocks([blockId])
    }

    setDraftAttachments((prev) => {
      const next = { ...prev }
      delete next[scene]
      delete next[preview]
      return next
    })

    window.setTimeout(() => syncDraftContentFromEditor(), 0)
  }

  function handleRenameDrawing(blockId: string, title: string): void {
    const editor = blockNoteRef.current?.getEditor() as any
    if (!editor?.updateBlock) return
    editor.updateBlock(blockId, {
      type: 'drawingCard',
      props: { title },
    })
    window.setTimeout(() => syncDraftContentFromEditor(), 0)
  }

  useEffect(() => {
    return () => {
      if (yjsContentSyncTimerRef.current) {
        window.clearTimeout(yjsContentSyncTimerRef.current)
        yjsContentSyncTimerRef.current = null
      }
      if (pendingDrawingInsertRef.current) {
        pendingDrawingInsertRef.current(null)
        pendingDrawingInsertRef.current = null
      }
    }
  }, [])

  const recoveryCodeBase64 = masterKey ? bytesToBase64(masterKey) : ''
  const recoveryCodeHex = masterKey ? bytesToHex(masterKey) : ''

  if (!masterKey) return null

  function lockAndLogout() {
    lock()
    void postJSON('/auth/logout', {}).catch(() => null)
  }

  const vaultDialogsControllers: VaultDialogsControllers = {
    pairing: {
      pairing,
      pairingBusy,
      setPairing,
      cancelPairing,
      confirmPairing,
    },
    attachments: {
      confirmRemoveAttachment,
      setConfirmRemoveAttachment,
      actuallyRemoveAttachment,
      confirmCleanupUnusedAttachments,
      setConfirmCleanupUnusedAttachments,
      setDraftAttachments,
    },
    noteActions: {
      confirmDeleteNote,
      selectedTitle: selected?.payload.meta.title || '未命名',
      onCancelDeleteNote: () => setConfirmDeleteNote(false),
      onConfirmDeleteNote: () => {
        setConfirmDeleteNote(false)
        void softDeleteSelected()
      },
      confirmLock,
      onCancelLock: () => setConfirmLock(false),
      onConfirmLock: () => {
        setConfirmLock(false)
        lockAndLogout()
      },
      confirmShowRecoveryCode,
      onCancelShowRecoveryCode: () => setConfirmShowRecoveryCode(false),
      onConfirmShowRecoveryCode: () => {
        setConfirmShowRecoveryCode(false)
        void navigator.clipboard.writeText(recoveryCodeBase64).catch(() => null)
        setShowRecoveryCode(true)
      },
    },
    recovery: {
      showRecoveryCode,
      onCloseRecoveryCode: () => setShowRecoveryCode(false),
      recoveryCodeBase64,
      recoveryCodeHex,
      recoveryCodeModalRef,
    },
    help: {
      showHelp,
      onCloseHelp: () => setShowHelp(false),
      helpModalRef,
    },
  }

  const settingsQuickActionsController: QuickActionsController = {
    busy,
    pairingBusy,
    masterKey,
    onClose: () => setShowSettings(false),
    onSync: syncNow,
    onStartPairing: startPairing,
    onShowRecoveryCode: () => setConfirmShowRecoveryCode(true),
    onShowHelp: () => setShowHelp(true),
  }

  return (
    <SidebarProvider
      className="h-screen"
      style={{ "--sidebar-width": "280px", "--header-height": "64px" } as React.CSSProperties}
    >
      {/* Toast notifications */}
      <ToastStack>
        {indexBuild ? <Toast kind="loading" message={`正在构建搜索索引…（${indexBuild.done}/${indexBuild.total}）`} /> : null}
        {indexError ? <Toast kind="error" message={indexError} onClose={clearIndexError} /> : null}
        {attachmentsBusy ? (
          <Toast
            kind="loading"
            message={attachmentsProgress ? `正在处理附件…（${attachmentsProgress.done}/${attachmentsProgress.total}）` : '正在处理附件…'}
          />
        ) : null}
        {pairingBusy ? <Toast kind="loading" message="正在添加新设备…" /> : null}
        {busyText ? <Toast kind="loading" message={busyText} /> : null}
        {pairingError ? <Toast kind="error" message={pairingError} onClose={() => setPairingError(null)} /> : null}
        {error ? <Toast kind="error" message={error} onClose={() => setError(null)} /> : null}
      </ToastStack>

      <VaultSidebar
        isNarrow={isNarrow}
        mobilePane={mobilePane}
        brandName={brandName}
        searchQuery={searchQuery}
        notes={notes}
        visibleNotes={visibleNotes}
        searchHasMore={searchHasMore}
        fallbackSearchBusy={fallbackSearchBusy}
        indexBuild={indexBuild}
        notesLoaded={notesLoaded}
        busy={busy}
        busyText={busyText}
        selectedNoteId={selectedNoteId}
        onSelectNote={navigateToNote}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={() => setShowSettings(true)}
        onClearSearch={() => setSearch('')}
        onLoadMore={() => setSearchLimit((v) => v + SEARCH_PAGE_SIZE)}
        syncButton={syncButton}
      />

      {/* Main Content Area */}
      {(!isNarrow || mobilePane === 'editor') && (
      <SidebarInset className={cn(
        "flex flex-col min-w-0 h-screen",
        isNarrow && "w-full"
      )}>
        {/* Header */}
        <header className="flex h-[--header-height] shrink-0 items-center bg-background px-4 md:px-0 py-2 border-b border-border/50">
          {/* 移动端布局 - 完全照抄 ref */}
          <div className="flex w-full items-center justify-between md:hidden">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
                onClick={() => navigateToList()}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                  <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                </svg>
                <span className="sr-only">返回列表</span>
              </Button>
              <span className="text-sm font-medium truncate max-w-[120px]">
                {selected ? (selected.payload.meta.title || '未命名') : brandName}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="icon" 
                className="size-9 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="size-[18px]" />
                <span className="sr-only">搜索</span>
              </Button>
              {syncButton}
              <Button 
                variant="ghost" 
                size="icon" 
                className="size-9 text-muted-foreground hover:text-foreground" 
                onClick={() => setShowSettings(true)}
              >
                <Settings className="size-[18px]" />
                <span className="sr-only">设置</span>
              </Button>
            </div>
          </div>

          {/* 桌面端布局 */}
          <div className="hidden md:flex w-full px-6 items-center gap-4">
            {/* 搜索框 - 左侧，点击打开搜索对话框 */}
            <div className="relative w-64 cursor-pointer" onClick={() => setSearchOpen(true)}>
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <div className="h-8 border-none bg-muted pl-10 pr-3 text-sm rounded-md flex items-center text-muted-foreground">
                <span>搜索</span>
                <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </div>
            </div>

            {/* 右侧操作按钮 */}
            <div className="ml-auto flex items-center gap-1">
              {syncButton}
              <Button 
                variant="ghost" 
                size="icon" 
                className="size-9 text-muted-foreground hover:text-foreground" 
                onClick={() => setShowSettings(true)}
              >
                <Settings className="size-[18px]" />
                <span className="sr-only">设置</span>
              </Button>
              {/* 新建按钮 - 圆形主色调，完全照抄 ref */}
              <Button 
                className="mx-1 size-7 rounded-full bg-primary text-primary-foreground hover:bg-primary/90" 
                onClick={createNote}
                disabled={busy}
              >
                <Plus className="size-4" />
                <span className="sr-only">新建</span>
              </Button>
              {/* 锁定按钮 - 替代 ref 的主题切换 */}
              <Button 
                variant="ghost" 
                size="icon" 
                className="size-9 text-muted-foreground hover:text-foreground" 
                onClick={() => setConfirmLock(true)}
                disabled={busy}
              >
                <Lock className="size-[18px]" />
                <span className="sr-only">锁定</span>
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content Container */}
        <div className="flex flex-1 flex-col bg-background overflow-y-auto overflow-x-hidden min-w-0 hide-scrollbar">
          {/* Info Banner */}
          <AnimatePresence initial={false}>
            {showInfo ? (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="flex items-center justify-between gap-4 px-6 py-3 text-sm border-b border-border/40 bg-muted/30"
              >
                <span className="text-muted-foreground">每一点灵感都值得被安全记录。所有内容均加密存储。</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowInfo(false)
                    localStorage.setItem('inkrypt_hide_info', '1')
                  }}
                >
                  关闭
                </Button>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Editor Main Area - 全宽布局 */}
          <main
            className="flex-1 w-full px-2 md:px-12 py-4 min-w-0 flex flex-col"
            aria-hidden={isNarrow && mobilePane !== 'editor' ? true : undefined}
            {...(isNarrow && mobilePane !== 'editor' ? ({ inert: '' } as any) : {})}
          >
            <AnimatePresence mode="wait">
            {selected ? (
              <motion.div
                key={selectedNoteId || 'empty'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="flex-1 flex flex-col min-h-0"
              >
                <VaultEditorHeader
                  draftTitle={draftTitle}
                  setDraftTitle={setDraftTitle}
                  draftFavorite={draftFavorite}
                  setDraftFavorite={setDraftFavorite}
                  busy={busy}
                  attachmentsBusy={attachmentsBusy}
                  selectedBaselineReady={Boolean(selectedBaseline)}
                  dirty={dirty}
                  busyText={busyText}
                  onSave={() => {
                    void saveSelected()
                  }}
                  onDelete={() => setConfirmDeleteNote(true)}
                  onOpenAttachments={() => setShowAttachments(true)}
                />

                {!selectedBaseline ? <div className="editorHint muted small">正在解密笔记…</div> : null}

                <input
                  className="tagsInput"
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                  placeholder="标签（逗号分隔，例如：工作, 日记）"
                  aria-label="标签（逗号分隔）"
                  disabled={editorInputsDisabled}
                />

                <div className="contentInput blocknote-wrapper" data-editor-location="normal">
                  <BlockNoteComponent
                    key={`editor-${selectedNoteId}-${blockNoteKey}`}
                    ref={blockNoteRef}
                    initialContent={draftContent}
                    attachments={draftAttachments}
                    onChange={handleBlockNoteChange}
                    disabled={editorContentDisabled}
                    placeholder="请输入内容..."
                    onAddAttachment={handleBlockNoteAddAttachment}
                    onDropFiles={handleBlockNoteFiles}
                    onPasteFiles={handleBlockNoteFiles}
                    yjsDoc={yjsSync.doc ?? undefined}
                    onYjsDocChange={handleYjsDocChange}
                    onInsertDrawing={handleInsertDrawingFromSlashMenu}
                    onEditDrawing={(blockId, drawingId, sceneUrl, title) => {
                      void openExistingDrawingByUrl(sceneUrl, { blockId, drawingId, title })
                    }}
                    onDeleteDrawing={(blockId, drawingId, _sceneUrl, title) => {
                      setConfirmDeleteDrawing({ blockId, drawingId, title })
                    }}
                    onDownloadDrawingPreview={handleDownloadDrawingPreview}
                    onRenameDrawing={handleRenameDrawing}
                  />
                </div>

                {/* 底部按钮已移到顶部工具栏 */}
              </motion.div>
            ) : (
              <motion.div
                key="empty-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="flex flex-col items-center justify-center h-full text-center p-8"
              >
                <div className="rounded-full bg-muted/50 p-6 mb-4">
                  <Edit3 className="h-12 w-12 text-muted-foreground/50" />
                </div>
                <p className="text-lg font-medium mb-2 text-muted-foreground">选择笔记</p>
                <p className="text-sm text-muted-foreground/70">从侧边栏选择笔记，或点击「新建」开始</p>
              </motion.div>
            )}
            </AnimatePresence>
        </main>
        </div>
      </SidebarInset>
      )}

      {/* Mobile FAB */}
      {isNarrow && mobilePane === 'list' ? (
        <Button
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
          onClick={() => void createNote()}
          disabled={busy}
          aria-label="新建笔记"
        >
          <Plus className="h-6 w-6" />
        </Button>
      ) : null}

      <VaultDialogs {...vaultDialogsControllers} />

      <AttachmentsPanel
        isOpen={showAttachments}
        onClose={() => setShowAttachments(false)}
        attachments={draftAttachments}
        refs={attachmentRefs}
        busy={busy || attachmentsBusy}
        progress={attachmentsBusy ? attachmentsProgress : null}
        onAddFiles={(files) => void addAttachments(files)}
        onRemove={(name) => removeAttachment(name)}
        onDownload={(name) => downloadAttachment(name)}
        onCleanupUnused={(names) => setConfirmCleanupUnusedAttachments(names)}
        onOpenDrawing={(name) => {
          void openExistingDrawing(name)
        }}
      />

      <DrawingEditor
        open={drawingEditorOpen}
        drawingId={activeDrawingId}
        title={drawingTitle}
        initialData={drawingInitialData}
        isSaving={drawingEditorSaving}
        onOpenChange={(open) => {
          setDrawingEditorOpen(open)
          if (!open) {
            if (pendingDrawingInsertRef.current) {
              pendingDrawingInsertRef.current(null)
              pendingDrawingInsertRef.current = null
            }
            setActiveDrawingBlockId(null)
            setDrawingTitle('')
            setDrawingInitialData(null)
            setDrawingEditorSaving(false)
          }
        }}
        onTitleChange={setDrawingTitle}
        onSave={handleSaveDrawing}
      />

      {confirmDeleteDrawing ? (
        <ConfirmDialog
          title="删除绘图？"
          message={`将删除绘图卡片「${confirmDeleteDrawing.title}」以及对应的源文件和 PNG 预览。此操作不可撤销。`}
          confirmText="删除绘图"
          confirmVariant="danger"
          onCancel={() => setConfirmDeleteDrawing(null)}
          onConfirm={() => {
            const ctx = confirmDeleteDrawing
            setConfirmDeleteDrawing(null)
            handleDeleteDrawing(ctx.blockId, ctx.drawingId)
          }}
        />
      ) : null}

      <SettingsPanel
        isOpen={showSettings}
        brandName={brandName}
        onSetBrandName={setBrandName}
        theme={theme}
        onSetTheme={setTheme}
        mode={mode}
        onSetMode={setMode}
        credentialId={credentialId}
        onSetDeviceName={setDeviceName}
        onLock={lockAndLogout}
        {...settingsQuickActionsController}
      />

      {/* 搜索对话框 */}
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSearch={(query) => {
          return buildSearchDialogResults(notes, query)
        }}
        onSelect={(id) => {
          navigateToNote(id)
          setSearchOpen(false)
        }}
      />
    </SidebarProvider>
  )
}
