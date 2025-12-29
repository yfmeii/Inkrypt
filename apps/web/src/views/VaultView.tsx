import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import * as FlexSearch from 'flexsearch'
import { ApiError, getJSON, postJSON } from '../lib/api'
import { compressImageToDataUrl, downloadDataUrl, fileToDataUrl, sanitizeAttachmentName, uniqueAttachmentName } from '../lib/attachments'
import { bytesToBase64, bytesToHex, decryptNotePayload, encryptNotePayload, isLegacyNoteCiphertext, noteAad, type NotePayload } from '../lib/crypto'
import { formatErrorZh } from '../lib/errors'
import { buildPairingDeepLink, formatPairingSecretForDisplay } from '../lib/pairingSecret'
import { useFocusTrap } from '../lib/focusTrap'
import { useBodyScrollLock } from '../lib/scrollLock'
import { scheduleIdle, cancelIdle, type IdleDeadlineLike } from '../lib/idle'
import { encodeSearchText, normalizeSearchText, extractPlainText, pickSearchPreviewLine, firstNonEmptyLine, escapeRegExp } from '../lib/search'
import { readInkryptNavState, withInkryptNavState, type InkryptNavPage, type InkryptNavState } from '../lib/navigation'
import {
  idbGetAllEncryptedNotes,
  idbDeleteDraftNote,
  idbGetDraftNote,
  idbGetEncryptedNote,
  idbGetLastSync,
  idbSetDraftNote,
  idbSetLastSync,
  idbUpsertEncryptedNotes,
  type EncryptedNoteRecord,
} from '../lib/idb'
import { deriveSharedSecretBits, encryptMasterKeyForTransfer, exportPublicKeyJwk, generateEphemeralEcdhKeyPair, generateSasEmoji } from '../lib/pairing'
import { useInkryptStore, type DecryptedNote } from '../state/store'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { BlockNoteComponent, type BlockNoteComponentRef } from '../components/BlockNote'
import { AttachmentsPanel } from '../components/AttachmentsPanel'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Toast, ToastStack } from '../components/Toast'
import { SettingsPanel } from '../components/SettingsPanel'
import { QrCode } from '../components/QrCode'
import { SearchDialog } from '../components/SearchDialog'
import { useYjsSync } from '../hooks/useYjsSync'
import { detectNoteFormat, migrateToYjs, type YjsNotePayload } from '../lib/yjs/migration'
import type { NotePayloadWithYjs } from '../lib/yjs/syncController'
import { encodeYDoc, mergeYDocs } from '../lib/yjs/serializer'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from '../components/ui/sidebar'
import { Button } from '../components/ui/button'
import { ScrollArea } from '../components/ui/scroll-area'
import { Plus, Search, Settings, RefreshCw, Lock, X, Star, Edit3 } from 'lucide-react'
import { cn } from '../lib/utils'

type NotesGetResponse = { notes: EncryptedNoteRecord[] }
type NotesPostResponse = {
  saved: Array<{ id: string; version: number; updated_at: number }>
  conflicts: string[]
}

type SyncSavedRecord = { version: number; updated_at: number }

/** 笔记内容存储限制（超过此长度的内容会被截断） */
const NOTE_CONTENT_STORE_LIMIT = 20_000

/** 搜索分页大小 */
const SEARCH_PAGE_SIZE = 200

/**
 * 构建笔记搜索文本（用于全文搜索索引）
 * 标题和标签会重复两次以增加权重
 */
function buildNoteSearchText(payload: NotePayload): string {
  const title = payload.meta.title ?? ''
  const content = payload.content ?? ''
  const tags = payload.meta.tags?.join(' ') ?? ''
  const plainContent = extractPlainText(content)
  return `${title}\n${title}\n${tags}\n${tags}\n${plainContent}`
}

/**
 * 截断笔记内容以适应存储限制
 */
function clampNoteContentForStore(content: string): string {
  if (content.length <= NOTE_CONTENT_STORE_LIMIT) return content
  return content.slice(0, NOTE_CONTENT_STORE_LIMIT)
}

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

  const notesRef = useRef<DecryptedNote[]>(notes)
  notesRef.current = notes

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [searchLimit, setSearchLimit] = useState(SEARCH_PAGE_SIZE)
  const [notesLoaded, setNotesLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyText, setBusyText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedBaseline, setSelectedBaseline] = useState<NotePayload | null>(null)
  const [editBaseVersion, setEditBaseVersion] = useState<number | null>(null)
  const [localDraftInfo, setLocalDraftInfo] = useState<{ savedAt: number; baseVersion: number } | null>(null)
  const [localDraftSaving, setLocalDraftSaving] = useState(false)
  const [localDraftError, setLocalDraftError] = useState<string | null>(null)
  const selectedLoadRunIdRef = useRef(0)
  const localDraftSaveRunIdRef = useRef(0)
  const localDraftSaveTimerRef = useRef<number | null>(null)
  const localDraftSaveIdleHandleRef = useRef<number | null>(null)

  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftTags, setDraftTags] = useState('')
  const [draftFavorite, setDraftFavorite] = useState(false)
  const [draftAttachments, setDraftAttachments] = useState<Record<string, string>>({})
  const draftContentRef = useRef(draftContent)
  const draftStateRef = useRef<{
    title: string
    tags: string[]
    is_favorite: boolean
    attachments: Record<string, string>
    content: string
    createdAt: number
  }>({
    title: '',
    tags: [],
    is_favorite: false,
    attachments: {},
    content: '',
    createdAt: Date.now(),
  })

  useEffect(() => {
    draftContentRef.current = draftContent
  }, [draftContent])

  const [showHelp, setShowHelp] = useState(false)
  const [showRecoveryCode, setShowRecoveryCode] = useState(false)
  const [confirmShowRecoveryCode, setConfirmShowRecoveryCode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [showAttachments, setShowAttachments] = useState(false)
  const [attachmentsBusy, setAttachmentsBusy] = useState(false)
  const [attachmentsProgress, setAttachmentsProgress] = useState<{ done: number; total: number } | null>(null)
  const [confirmRemoveAttachment, setConfirmRemoveAttachment] = useState<{ name: string; refs: number } | null>(null)
  const [confirmDeleteNote, setConfirmDeleteNote] = useState(false)
  const [confirmLock, setConfirmLock] = useState(false)
  const [confirmCleanupUnusedAttachments, setConfirmCleanupUnusedAttachments] = useState<string[] | null>(null)
  // Default true if not set
  const [showInfo, setShowInfo] = useState(() => !localStorage.getItem('inkrypt_hide_info'))

  const isNarrow = useMediaQuery('(max-width: 900px)')
  const [mobilePane, setMobilePane] = useState<'list' | 'editor'>('list')

  function ensureHistoryIsListEntry(): void {
    if (typeof window === 'undefined') return
    const nav = readInkryptNavState(history.state)
    if (nav) return
    history.replaceState(withInkryptNavState(history.state, { v: 1, page: 'list' }), '')
  }

  function navigateToNote(noteId: string): void {
    selectNote(noteId)
    if (isNarrow) setMobilePane('editor')

    if (typeof window === 'undefined' || !isNarrow) return
    ensureHistoryIsListEntry()

    const currentNav = readInkryptNavState(history.state)
    const next = withInkryptNavState(history.state, { v: 1, page: 'note', noteId })

    if (currentNav?.page === 'note') history.replaceState(next, '')
    else history.pushState(next, '')
  }

  function navigateToList(): void {
    if (!isNarrow) return
    if (typeof window === 'undefined') {
      setMobilePane('list')
      return
    }

    const currentNav = readInkryptNavState(history.state)
    if (currentNav?.page === 'note') {
      history.back()
      return
    }

    ensureHistoryIsListEntry()
    setMobilePane('list')
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    ensureHistoryIsListEntry()

    const applyNav = (state: unknown) => {
      const nav = readInkryptNavState(state)
      if (!nav || nav.page === 'list') {
        if (isNarrow) setMobilePane('list')
        return
      }

      const noteId = nav.noteId
      if (!noteId || !notesRef.current.some((n) => n.id === noteId)) {
        history.replaceState(withInkryptNavState(history.state, { v: 1, page: 'list' }), '')
        if (isNarrow) setMobilePane('list')
        return
      }

      selectNote(noteId)
      if (isNarrow) setMobilePane('editor')
    }

    applyNav(history.state)
    const onPopState = (event: PopStateEvent) => applyNav(event.state)

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [isNarrow, selectNote])

  const blockNoteRef = useRef<BlockNoteComponentRef | null>(null)
  const [blockNoteKey, setBlockNoteKey] = useState(0)
  const yjsContentSyncTimerRef = useRef<number | null>(null)
  const recoveryCodeModalRef = useRef<HTMLDivElement | null>(null)
  const helpModalRef = useRef<HTMLDivElement | null>(null)

  useFocusTrap(recoveryCodeModalRef, showRecoveryCode)
  useFocusTrap(helpModalRef, showHelp)

  const pairingRunIdRef = useRef(0)
  const pairingKeyPairRef = useRef<CryptoKeyPair | null>(null)
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingError, setPairingError] = useState<string | null>(null)
  const [pairing, setPairing] = useState<{
    sessionCode: string
    sessionSecret: string
    expiresAt: number
    sas: string | null
    sharedSecret: ArrayBuffer | null
    stage: 'waiting_join' | 'sas' | 'sent'
    sasConfirmed: boolean
  } | null>(null)

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

  const selected = useMemo(
    () => (selectedNoteId ? notes.find((n) => n.id === selectedNoteId) ?? null : null),
    [notes, selectedNoteId],
  )

  useEffect(() => {
    const createdAt = selectedBaseline?.meta.created_at ?? selected?.payload.meta.created_at ?? Date.now()
    draftStateRef.current = {
      title: draftTitle.trim() || '未命名',
      tags: draftTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      is_favorite: draftFavorite,
      attachments: draftAttachments,
      content: draftContentRef.current,
      createdAt,
    }
  }, [draftAttachments, draftContent, draftFavorite, draftTags, draftTitle, selected, selectedBaseline])

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

  const syncApi = useMemo(() => ({
    getNote: async (noteId: string) => {
      if (!masterKey) return null
      const res = await getJSON<NotesGetResponse>('/api/notes?since=0')
      const record = res.notes.find((n) => n.id === noteId && !n.is_deleted) ?? null
      if (!record) {
        syncRemoteVersionRef.current = 0
        return null
      }
      syncRemoteVersionRef.current = record.version
      const payload = await decryptNotePayload(masterKey, record.encrypted_data, record.data_iv, noteAad(noteId))
      return payload as NotePayloadWithYjs
    },
    putNote: async (noteId: string, payload: NotePayloadWithYjs) => {
      if (!masterKey) throw new Error('No master key')
      const draft = draftStateRef.current
      const mergedPayload: NotePayloadWithYjs = {
        ...payload,
        content: draft.content,
        attachments: draft.attachments,
        meta: {
          ...payload.meta,
          title: draft.title,
          created_at: draft.createdAt,
          tags: draft.tags,
          is_favorite: draft.is_favorite,
        },
      }
      const payloadForEncrypt: NotePayload = {
        ...mergedPayload,
        attachments: mergedPayload.attachments ?? {},
      }
      const enc = await encryptNotePayload(masterKey, payloadForEncrypt, noteAad(noteId))
      let res: NotesPostResponse
      try {
        res = await postJSON<NotesPostResponse>('/api/notes', [{
          id: noteId,
          encrypted_data: enc.encrypted_data,
          iv: enc.iv,
          base_version: syncRemoteVersionRef.current || selectedRef.current?.version || 0,
          is_deleted: false,
        }])
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          throw new Error('同步繁忙，请稍后再试')
        }
        throw err
      }

      if (res.conflicts.includes(noteId)) {
        throw new Error('同步繁忙，请稍后再试')
      }
      const saved = res.saved.find((s) => s.id === noteId)
      if (saved) syncSavedRef.current = saved
    }
  }), [masterKey])

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

  useEffect(() => {
    if (!selectedNoteId || !yjsSync.doc) return
    setBlockNoteKey((k) => k + 1)
  }, [selectedNoteId, yjsSync.doc])

  const draftTagsNormalized = useMemo(
    () =>
      draftTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .join(', '),
    [draftTags],
  )

  const dirty = useMemo(() => {
    if (!selectedBaseline) return false

    const baseTagsNormalized = selectedBaseline.meta.tags.join(', ')
    const baseAttachments = selectedBaseline.attachments ?? {}

    const canonical = (obj: Record<string, string>) =>
      JSON.stringify(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))

    return (
      draftTitle !== selectedBaseline.meta.title ||
      draftContent !== selectedBaseline.content ||
      draftFavorite !== selectedBaseline.meta.is_favorite ||
      draftTagsNormalized !== baseTagsNormalized ||
      canonical(draftAttachments) !== canonical(baseAttachments)
    )
  }, [draftAttachments, draftContent, draftFavorite, draftTagsNormalized, draftTitle, selectedBaseline])

  const selectedNoteIdRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const selectedBaselineRef = useRef<NotePayload | null>(null)
  selectedNoteIdRef.current = selectedNoteId
  dirtyRef.current = dirty
  selectedBaselineRef.current = selectedBaseline

  // 同步按钮状态 - 使用 Yjs sync 状态
  const isSyncing = yjsSync.isSyncing || (busy && busyText === '正在同步…')
  const yjsDirty = yjsSync.dirty || dirty
  const syncStatus = yjsSync.lastSyncStatus
  const editorInputsDisabled = attachmentsBusy || !selectedBaseline || (busy && !isSyncing)
  const editorContentDisabled = editorInputsDisabled || !yjsSync.doc
  
  const syncButtonTitle = isSyncing ? '同步中…' :
    syncStatus.type === 'error' ? '同步失败，请稍后重试' :
    syncStatus.type === 'success' ? (syncStatus.mergedRemote ? '已合并远端更改' : '已同步') :
    yjsDirty ? (
      localDraftSaving ? '正在保存草稿…' :
      localDraftInfo ? `已自动保存 · ${new Date(localDraftInfo.savedAt).toLocaleTimeString()}` :
      '未同步更改'
    ) : selected ? `已同步 · ${new Date(selected.updated_at).toLocaleTimeString()}` : '点击同步'
  
  // 状态点颜色：已同步=翠绿，待同步=琥珀，冲突/失败=玫红
  const statusDotColor = syncStatus.type === 'error' || localDraftError ? 'bg-rose-500' :
    yjsDirty ? 'bg-amber-500' : 'bg-emerald-500'
  
  const syncButton = (
    <Button 
      variant="ghost" 
      size="icon" 
      className="size-9 relative text-muted-foreground hover:text-foreground"
      onClick={() => void saveSelected()}
      onMouseDown={(event) => event.preventDefault()}
      disabled={busy || !selected || !yjsSync.doc}
      title={syncButtonTitle}
    >
      <RefreshCw className={cn("size-[18px]", isSyncing && "animate-spin")} />
      {/* 右下角状态小圆点 */}
      {!isSyncing && (
        <span className={cn(
          "absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full",
          "ring-2 ring-background",
          statusDotColor
        )} />
      )}
      <span className="sr-only">同步</span>
    </Button>
  )

  const searchQuery = deferredSearch.trim()
  const searchQueryLower = searchQuery.toLowerCase()

  useEffect(() => {
    setSearchLimit(SEARCH_PAGE_SIZE)
  }, [searchQuery])

  function renderHighlighted(text: string): ReactNode {
    if (!searchQuery) return text
    if (!text) return text

    const re = new RegExp(escapeRegExp(searchQuery), 'ig')
    const nodes: ReactNode[] = []
    let last = 0

    for (const m of text.matchAll(re)) {
      const idx = m.index ?? 0
      if (idx > last) nodes.push(text.slice(last, idx))
      nodes.push(
        <mark key={`${idx}-${m[0]}`} className="hl">
          {m[0]}
        </mark>,
      )
      last = idx + m[0].length
      if (nodes.length > 50) break
    }

    if (nodes.length === 0) return text
    if (last < text.length) nodes.push(text.slice(last))
    return <>{nodes}</>
  }

  function detectSearchHit(note: DecryptedNote): 'title' | 'tags' | 'content' | null {
    if (!searchQuery) return null

    const title = (note.payload.meta.title || '').toLowerCase()
    if (title.includes(searchQueryLower)) return 'title'

    const tags = note.payload.meta.tags.join(', ').toLowerCase()
    if (tags.includes(searchQueryLower)) return 'tags'

    const content = (note.payload.content || '').toLowerCase()
    if (content.includes(searchQueryLower)) return 'content'

    return null
  }

  // 自动保存到云端的定时器
  const autoSaveTimerRef = useRef<number | null>(null)
  const autoSaveRunIdRef = useRef(0)

  // 自动保存到云端的函数（使用 ref 避免依赖问题）
  const saveSelectedRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (!masterKey || !selected || !selectedBaseline) return
    if (busy) return

    const noteId = selected.id

    if (localDraftSaveTimerRef.current) window.clearTimeout(localDraftSaveTimerRef.current)
    if (localDraftSaveIdleHandleRef.current) cancelIdle(localDraftSaveIdleHandleRef.current)
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
    localDraftSaveTimerRef.current = null
    localDraftSaveIdleHandleRef.current = null
    autoSaveTimerRef.current = null

    if (!dirty) {
      setLocalDraftSaving(false)
      setLocalDraftError(null)
      setLocalDraftInfo(null)
      void idbDeleteDraftNote(noteId).catch(() => null)
      return
    }

    const baseVersion =
      typeof editBaseVersion === 'number' && Number.isFinite(editBaseVersion) ? editBaseVersion : selected.version

    const runId = ++localDraftSaveRunIdRef.current
    const autoSaveRunId = ++autoSaveRunIdRef.current

    localDraftSaveTimerRef.current = window.setTimeout(() => {
      if (localDraftSaveRunIdRef.current !== runId) return
      setLocalDraftSaving(true)

      localDraftSaveIdleHandleRef.current = scheduleIdle(() => {
        void (async () => {
          try {
            const payload: NotePayload = {
              meta: {
                title: draftTitle.trim(),
                created_at: selectedBaseline.meta.created_at,
                tags: draftTags
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
                is_favorite: draftFavorite,
              },
              content: draftContent,
              attachments: draftAttachments,
            }

            const enc = await encryptNotePayload(masterKey, payload, noteAad(noteId))
            const savedAt = Date.now()
            await idbSetDraftNote({
              v: 1,
              note_id: noteId,
              base_version: baseVersion,
              encrypted_data: enc.encrypted_data,
              data_iv: enc.iv,
              saved_at: savedAt,
            })

            if (localDraftSaveRunIdRef.current !== runId) return
            setLocalDraftInfo({ savedAt, baseVersion })
            setLocalDraftError(null)

            // 本地草稿保存成功后，延迟 2 秒自动同步到云端
            if (autoSaveRunIdRef.current === autoSaveRunId) {
              autoSaveTimerRef.current = window.setTimeout(() => {
                if (autoSaveRunIdRef.current !== autoSaveRunId) return
                if (saveSelectedRef.current) {
                  void saveSelectedRef.current()
                }
              }, 2000)
            }
          } catch (err) {
            if (localDraftSaveRunIdRef.current !== runId) return
            setLocalDraftError(formatErrorZh(err))
          } finally {
            if (localDraftSaveRunIdRef.current !== runId) return
            setLocalDraftSaving(false)
          }
        })()
      })
    }, 800)

    return () => {
      if (localDraftSaveTimerRef.current) window.clearTimeout(localDraftSaveTimerRef.current)
      if (localDraftSaveIdleHandleRef.current) cancelIdle(localDraftSaveIdleHandleRef.current)
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
      localDraftSaveTimerRef.current = null
      localDraftSaveIdleHandleRef.current = null
      autoSaveTimerRef.current = null
    }
  }, [
    busy,
    dirty,
    draftAttachments,
    draftContent,
    draftFavorite,
    draftTags,
    draftTitle,
    editBaseVersion,
    masterKey,
    selected,
    selectedBaseline,
  ])

  const indexRef = useRef<any | null>(null)
  const indexedVersionsRef = useRef<Map<string, number>>(new Map())
  const indexTextRef = useRef<Map<string, string>>(new Map())
  const indexIdleHandleRef = useRef<number | null>(null)
  const indexRunIdRef = useRef(0)
  const indexAutoRebuildRef = useRef(0)
  const [indexTick, setIndexTick] = useState(0)
  const [indexBuild, setIndexBuild] = useState<{ done: number; total: number } | null>(null)
  const [indexEpoch, setIndexEpoch] = useState(0)
  const [indexError, setIndexError] = useState<string | null>(null)

  useEffect(() => {
    if (masterKey) return

    indexRunIdRef.current += 1
    indexAutoRebuildRef.current = 0

    if (indexIdleHandleRef.current) cancelIdle(indexIdleHandleRef.current)
    indexIdleHandleRef.current = null

    indexedVersionsRef.current.clear()
    indexTextRef.current.clear()
    indexRef.current = null

    setIndexBuild(null)
    setIndexError(null)
    setIndexTick((t) => t + 1)
    setIndexEpoch((e) => e + 1)
    setSearch('')
    setSearchLimit(SEARCH_PAGE_SIZE)
  }, [masterKey])

  useEffect(() => {
    const Flex: any = (FlexSearch as any).default ?? FlexSearch
    if (!indexRef.current) indexRef.current = new Flex.Index({ tokenize: 'forward', cache: 200, encode: encodeSearchText })

    const idx = indexRef.current
    const indexed = indexedVersionsRef.current
    const indexText = indexTextRef.current

    const currentIds = new Set(notes.map((n) => n.id))
    const toRemove: string[] = []
    for (const id of indexed.keys()) {
      if (!currentIds.has(id)) toRemove.push(id)
    }

    const toUpsert: Array<{ id: string; version: number; text: string }> = []
    for (const n of notes) {
      if (indexed.get(n.id) === n.version) continue
      const text = indexText.get(n.id) ?? `${n.payload.meta.title}\n${n.payload.content}\n${n.payload.meta.tags.join(' ')}`
      toUpsert.push({ id: n.id, version: n.version, text })
    }

    const total = toRemove.length + toUpsert.length
    if (total === 0) {
      setIndexBuild(null)
      return
    }

    const runId = ++indexRunIdRef.current
    let done = 0
    setIndexBuild({ done: 0, total })
    setIndexError(null)

    if (indexIdleHandleRef.current) cancelIdle(indexIdleHandleRef.current)

    let hadFailures = false
    let requestedRebuild = false

    const work = (deadline?: IdleDeadlineLike) => {
      if (indexRunIdRef.current !== runId) return

      const timeRemaining = () =>
        deadline && typeof deadline.timeRemaining === 'function' ? deadline.timeRemaining() : 8

      while ((toRemove.length || toUpsert.length) && timeRemaining() > 5) {
        if (toRemove.length) {
          const id = toRemove.pop()
          if (id) {
            try {
              idx.remove(id)
            } catch {
              // ignore
            }
            indexed.delete(id)
          }
        } else {
          const n = toUpsert.pop()
          if (n) {
            try {
              if (indexed.has(n.id)) idx.update(n.id, n.text)
              else idx.add(n.id, n.text)
              indexed.set(n.id, n.version)
            } catch {
              hadFailures = true
              if (!requestedRebuild && indexAutoRebuildRef.current < 1) {
                requestedRebuild = true
              }
            }
          }
        }
        done += 1
      }

      if (indexRunIdRef.current !== runId) return

      setIndexBuild({ done, total })
      setIndexTick((t) => t + 1)

      if (toRemove.length || toUpsert.length) {
        indexIdleHandleRef.current = scheduleIdle(work)
        return
      }

      if (requestedRebuild) {
        indexAutoRebuildRef.current += 1
        indexed.clear()
        indexRef.current = null
        setIndexTick((t) => t + 1)
        setIndexBuild(null)
        setIndexEpoch((e) => e + 1)
        return
      }

      if (hadFailures) {
        setIndexError('搜索索引构建失败：部分笔记可能无法被搜索（可尝试刷新页面或重新解锁）。')
      }

      setIndexBuild(null)
    }

    indexIdleHandleRef.current = scheduleIdle(work)

    return () => {
      indexRunIdRef.current += 1
      if (indexIdleHandleRef.current) cancelIdle(indexIdleHandleRef.current)
    }
  }, [indexEpoch, notes])

  const fallbackSearchRunIdRef = useRef(0)
  const fallbackSearchIdleHandleRef = useRef<number | null>(null)
  const [fallbackSearch, setFallbackSearch] = useState<{ ids: string[]; hasMore: boolean } | null>(null)
  const [fallbackSearchBusy, setFallbackSearchBusy] = useState(false)

  const sortedNotes = useMemo(() => [...notes].sort((a, b) => b.updated_at - a.updated_at), [notes])

  const noteById = useMemo(() => {
    const out = new Map<string, DecryptedNote>()
    for (const n of sortedNotes) out.set(n.id, n)
    return out
  }, [sortedNotes])

  const indexSearch = useMemo(() => {
    if (!searchQuery) return { ids: null as string[] | null, hasMore: false }
    const idx = indexRef.current
    if (!idx) return { ids: [] as string[], hasMore: false }
    try {
      const results = idx.search(searchQuery, { limit: searchLimit + 1, suggest: true }) as string[]
      const hasMore = results.length > searchLimit
      return { ids: hasMore ? results.slice(0, searchLimit) : results, hasMore }
    } catch {
      return { ids: [] as string[], hasMore: false }
    }
  }, [indexTick, searchLimit, searchQuery])

  const activeSearch = indexSearch.ids !== null
  const indexHasResults = Boolean(indexSearch.ids && indexSearch.ids.length > 0)
  const searchIds = indexHasResults ? indexSearch.ids! : fallbackSearch?.ids ?? []
  const searchHasMore = indexHasResults ? indexSearch.hasMore : fallbackSearch?.hasMore ?? false

  useEffect(() => {
    if (!activeSearch) {
      setFallbackSearch(null)
      setFallbackSearchBusy(false)
      return
    }

    if (indexHasResults) {
      setFallbackSearch(null)
      setFallbackSearchBusy(false)
      return
    }

    const q = searchQuery
    if (!q) {
      setFallbackSearch(null)
      setFallbackSearchBusy(false)
      return
    }

    const runId = ++fallbackSearchRunIdRef.current
    if (fallbackSearchIdleHandleRef.current) cancelIdle(fallbackSearchIdleHandleRef.current)
    fallbackSearchIdleHandleRef.current = null
    setFallbackSearch(null)
    setFallbackSearchBusy(true)

    const qLower = q.toLowerCase()
    const qNorm = normalizeSearchText(q)
    const useNorm = qNorm !== qLower
    const needle = useNorm ? qNorm : qLower

    const total = notes.length
    let done = 0
    const hits: Array<{ id: string; score: number; updatedAt: number }> = []

    const work = (deadline?: IdleDeadlineLike) => {
      if (fallbackSearchRunIdRef.current !== runId) return

      const timeRemaining = () =>
        deadline && typeof deadline.timeRemaining === 'function' ? deadline.timeRemaining() : 8

      while (done < total && timeRemaining() > 5) {
        const n = notes[done]
        done += 1
        if (!n) continue

        const titleRaw = n.payload.meta.title || ''
        const tagsRaw = n.payload.meta.tags.join(' ')
        const contentRaw = n.payload.content || ''

        const title = useNorm ? normalizeSearchText(titleRaw) : titleRaw.toLowerCase()
        let score = 0
        if (title.includes(needle)) score = 3
        else {
          const tags = useNorm ? normalizeSearchText(tagsRaw) : tagsRaw.toLowerCase()
          if (tags.includes(needle)) score = 2
          else {
            const content = useNorm ? normalizeSearchText(contentRaw) : contentRaw.toLowerCase()
            if (content.includes(needle)) score = 1
          }
        }

        if (score > 0) hits.push({ id: n.id, score, updatedAt: n.updated_at })
      }

      if (fallbackSearchRunIdRef.current !== runId) return

      if (done < total) {
        fallbackSearchIdleHandleRef.current = scheduleIdle(work)
        return
      }

      hits.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
      const ids = hits.map((h) => h.id)
      const hasMore = ids.length > searchLimit
      setFallbackSearch({ ids: hasMore ? ids.slice(0, searchLimit) : ids, hasMore })
      if (fallbackSearchRunIdRef.current === runId) setFallbackSearchBusy(false)
    }

    fallbackSearchIdleHandleRef.current = scheduleIdle(work)

    return () => {
      if (fallbackSearchIdleHandleRef.current) cancelIdle(fallbackSearchIdleHandleRef.current)
      fallbackSearchIdleHandleRef.current = null
      if (fallbackSearchRunIdRef.current === runId) setFallbackSearchBusy(false)
    }
  }, [activeSearch, indexHasResults, notes, searchLimit, searchQuery])

  const visibleNotes = useMemo(() => {
    if (!activeSearch) return sortedNotes
    const out: DecryptedNote[] = []
    for (const id of searchIds) {
      const n = noteById.get(id)
      if (n) out.push(n)
    }
    return out
  }, [activeSearch, noteById, searchIds, sortedNotes])

  const attachmentRefs = useMemo(() => {
    const out: Record<string, number> = {}
    const names = Object.keys(draftAttachments)
    if (!names.length) return out
    // Content is already markdown
    for (const name of names) out[name] = countAttachmentRefs(draftContent, name)
    return out
  }, [draftAttachments, draftContent])

  useEffect(() => {
    if (!isNarrow) return
    if (!selectedNoteId) {
      navigateToList()
      return
    }

    // 只有当用户主动点击笔记进入编辑器后，才同步 history state
    if (mobilePane !== 'editor') return
    const nav = readInkryptNavState(history.state)
    if (nav?.page !== 'note' || nav.noteId !== selectedNoteId) {
      navigateToNote(selectedNoteId)
    }
  }, [isNarrow, mobilePane, selectedNoteId])

  useEffect(() => {
    const noteId = selectedNoteId
    const runId = ++selectedLoadRunIdRef.current

    if (localDraftSaveTimerRef.current) window.clearTimeout(localDraftSaveTimerRef.current)
    if (localDraftSaveIdleHandleRef.current) cancelIdle(localDraftSaveIdleHandleRef.current)
    localDraftSaveTimerRef.current = null
    localDraftSaveIdleHandleRef.current = null
    setLocalDraftSaving(false)

    setShowAttachments(false)

    if (!noteId) {
      setSelectedBaseline(null)
      setEditBaseVersion(null)
      setDraftTitle('')
      setDraftContent('')
      setDraftTags('')
      setDraftFavorite(false)
      setDraftAttachments({})
      setLocalDraftInfo(null)
      setLocalDraftError(null)
      // 在清空内容后更新 blockNoteKey
      setBlockNoteKey(k => k + 1)
      return
    }

    setSelectedBaseline(null)
    setEditBaseVersion(selected && selected.id === noteId ? selected.version : null)
    setDraftAttachments({})
    setLocalDraftInfo(null)
    setLocalDraftError(null)
    if (selected && selected.id === noteId) {
      setDraftTitle(selected.payload.meta.title)
      setDraftContent(selected.payload.content)
      setDraftTags(selected.payload.meta.tags.join(', '))
      setDraftFavorite(selected.payload.meta.is_favorite)
    } else {
      setDraftTitle('')
      setDraftContent('')
      setDraftTags('')
      setDraftFavorite(false)
    }
    // 在设置初始内容后更新 blockNoteKey，确保 BlockNote 组件使用正确的初始内容
    setBlockNoteKey(k => k + 1)

    if (!masterKey) return

    void (async () => {
      try {
        const enc = await idbGetEncryptedNote(noteId)
        if (!enc) return
        if (selectedLoadRunIdRef.current !== runId) return

        const payload = await decryptNotePayload(masterKey, enc.encrypted_data, enc.data_iv, noteAad(noteId))
        const format = detectNoteFormat(payload as YjsNotePayload)
        if (selectedLoadRunIdRef.current !== runId) return

        // 使用 flushSync 确保状态更新立即生效
        flushSync(() => {
          setSelectedBaseline(payload)
          setDraftTitle(payload.meta.title)
          setDraftContent(payload.content)
          setDraftTags(payload.meta.tags.join(', '))
          setDraftFavorite(payload.meta.is_favorite)
          setDraftAttachments(payload.attachments ?? {})
          setEditBaseVersion(enc.version)
          // 在同一个 flushSync 中更新 blockNoteKey
          setBlockNoteKey(k => k + 1)
        })

        try {
          const draft = await idbGetDraftNote(noteId)
          if (!draft) return
          if (selectedLoadRunIdRef.current !== runId) return

          const draftPayload = await decryptNotePayload(masterKey, draft.encrypted_data, draft.data_iv, noteAad(noteId))
          if (selectedLoadRunIdRef.current !== runId) return

          // 使用 flushSync 确保状态更新立即生效
          flushSync(() => {
            setDraftTitle(draftPayload.meta.title)
            if (format === 'legacy') {
              setDraftContent(draftPayload.content)
            }
            setDraftTags(draftPayload.meta.tags.join(', '))
            setDraftFavorite(draftPayload.meta.is_favorite)
            setDraftAttachments(draftPayload.attachments ?? {})
            setEditBaseVersion(draft.base_version)
            setLocalDraftInfo({ savedAt: draft.saved_at, baseVersion: draft.base_version })
            // 在同一个 flushSync 中更新 blockNoteKey
            setBlockNoteKey(k => k + 1)
          })
        } catch {
          void idbDeleteDraftNote(noteId).catch(() => null)
        }
      } catch (err) {
        if (selectedLoadRunIdRef.current !== runId) return
        setError(formatErrorZh(err))
      }
    })()
  }, [masterKey, selectedNoteId])

  useEffect(() => {
    void (async () => {
      setNotesLoaded(false)
      try {
        await loadNotesFromIdb()
      } finally {
        setNotesLoaded(true)
      }
      await syncNow()
      setTimeout(() => void migrateLegacyNotesInBackground().catch(() => null), 0)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function migrateLegacyNotesInBackground(): Promise<void> {
    if (!masterKey) return
    if (legacyMigrationInFlightRef.current) return

    const runId = legacyMigrationRunIdRef.current
    legacyMigrationInFlightRef.current = true
    try {
      const all = await idbGetAllEncryptedNotes()
      const candidates = all.filter((n) => !n.is_deleted && isLegacyNoteCiphertext(n.encrypted_data))
      if (candidates.length === 0) return

      let migrated = 0
      const MAX_AUTO_MIGRATIONS = 20

      for (const n of candidates) {
        if (legacyMigrationRunIdRef.current !== runId) return
        if (!masterKey) return
        if (migrated >= MAX_AUTO_MIGRATIONS) return

        if (n.id === selectedNoteIdRef.current && dirtyRef.current) continue
        const draft = await idbGetDraftNote(n.id)
        if (draft) continue

        let payload: NotePayload
        try {
          payload = await decryptNotePayload(masterKey, n.encrypted_data, n.data_iv, noteAad(n.id))
        } catch {
          continue
        }

        const enc = await encryptNotePayload(masterKey, payload, noteAad(n.id))
        if (isLegacyNoteCiphertext(enc.encrypted_data)) continue

        let res: NotesPostResponse
        try {
          res = await postJSON<NotesPostResponse>('/api/notes', [
            { id: n.id, encrypted_data: enc.encrypted_data, iv: enc.iv, base_version: n.version, is_deleted: false },
          ])
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            res = err.payload as NotesPostResponse
          } else {
            continue
          }
        }

        if (res.conflicts.includes(n.id)) continue
        const saved = res.saved.find((s) => s.id === n.id)
        if (!saved) continue

        migrated += 1
        await idbUpsertEncryptedNotes([
          {
            id: n.id,
            version: saved.version,
            updated_at: saved.updated_at,
            is_deleted: 0,
            encrypted_data: enc.encrypted_data,
            data_iv: enc.iv,
          },
        ])

        const payloadForStore: NotePayload = { ...payload, content: clampNoteContentForStore(payload.content), attachments: {} }
        indexTextRef.current.set(n.id, buildNoteSearchText(payload))
        upsertNote({ id: n.id, version: saved.version, updated_at: saved.updated_at, is_deleted: 0, payload: payloadForStore })

        if (n.id === selectedNoteIdRef.current && !dirtyRef.current && selectedBaselineRef.current) {
          setSelectedBaseline(payload)
          setEditBaseVersion(saved.version)
        }

        await new Promise((r) => setTimeout(r, 150))
      }
    } finally {
      legacyMigrationInFlightRef.current = false
    }
  }

  async function loadNotesFromIdb(): Promise<void> {
    if (!masterKey) return
    try {
      indexRunIdRef.current += 1
      if (indexIdleHandleRef.current) cancelIdle(indexIdleHandleRef.current)
      indexIdleHandleRef.current = null
      indexedVersionsRef.current.clear()
      indexTextRef.current.clear()
      indexRef.current = null
      setIndexTick((t) => t + 1)
      setIndexBuild(null)
      setIndexEpoch((e) => e + 1)

      const all = await idbGetAllEncryptedNotes()
      const decrypted: DecryptedNote[] = []
      for (const n of all) {
        if (n.is_deleted) continue
        try {
          const payload = await decryptNotePayload(masterKey, n.encrypted_data, n.data_iv, noteAad(n.id))
          indexTextRef.current.set(n.id, buildNoteSearchText(payload))
          decrypted.push({ ...n, payload: { ...payload, content: clampNoteContentForStore(payload.content), attachments: {} } })
        } catch {
          // ignore corrupted note; keep encrypted in IDB for forensic
        }
      }
      decrypted.sort((a, b) => b.updated_at - a.updated_at)
      setNotes(decrypted)
    } catch (err) {
      setError(formatErrorZh(err))
    }
  }

  async function syncNow() {
    if (!masterKey) return
    setError(null)
    setBusyText('正在同步…')
    setBusy(true)
    try {
      const since = await idbGetLastSync()
      const res = await getJSON<NotesGetResponse>(`/api/notes?since=${since}`)

      if (res.notes.length > 0) {
        await idbUpsertEncryptedNotes(res.notes)
        const maxUpdated = Math.max(...res.notes.map((n) => n.updated_at))
        await idbSetLastSync(Math.max(since, maxUpdated))

        for (const n of res.notes) {
          if (n.is_deleted) {
            indexTextRef.current.delete(n.id)
            removeNote(n.id)
            continue
          }

          try {
            const payload = await decryptNotePayload(masterKey, n.encrypted_data, n.data_iv, noteAad(n.id))
            const payloadForStore: NotePayload = { ...payload, content: clampNoteContentForStore(payload.content), attachments: {} }
            indexTextRef.current.set(n.id, buildNoteSearchText(payload))
            upsertNote({ ...n, payload: payloadForStore })

            // 如果当前选中的笔记有远端更新且本地没有未保存的修改，更新编辑器内容
            if (selectedNoteId === n.id && !dirty && selectedBaseline) {
              flushSync(() => {
                setSelectedBaseline(payload)
                setDraftTitle(payload.meta.title)
                setDraftContent(payload.content)
                setDraftTags(payload.meta.tags.join(', '))
                setDraftFavorite(payload.meta.is_favorite)
                setDraftAttachments(payload.attachments ?? {})
                setEditBaseVersion(n.version)
                setBlockNoteKey(k => k + 1)
              })
            }
          } catch {
            // 解密失败，保留加密数据在 IDB 中以便后续排查
          }
        }
      }
    } catch (err) {
      setError(formatErrorZh(err))
    } finally {
      setBusy(false)
      setBusyText(null)
      setTimeout(() => void migrateLegacyNotesInBackground().catch(() => null), 0)
    }
  }

  async function createNote() {
    if (!masterKey) return
    setError(null)
    setBusyText('正在创建笔记…')
    setBusy(true)
    try {
      const id = crypto.randomUUID()
      const payload: NotePayload = {
        meta: { title: '', created_at: Date.now(), tags: [], is_favorite: false },
        content: '',
        attachments: {},
      }

      const enc = await encryptNotePayload(masterKey, payload, noteAad(id))
      let res: NotesPostResponse
      try {
        res = await postJSON<NotesPostResponse>('/api/notes', [
          { id, encrypted_data: enc.encrypted_data, iv: enc.iv, base_version: 0, is_deleted: false },
        ])
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          res = err.payload as NotesPostResponse
        } else {
          throw err
        }
      }

      if (res.conflicts.includes(id)) {
        throw new Error('同步失败，请稍后重试')
      }

      const saved = res.saved.find((s) => s.id === id)
      if (!saved) throw new Error('已上传，但未收到服务器确认。请稍后点“从云端同步”确认结果')

      await idbUpsertEncryptedNotes([
        {
          id,
          version: saved.version,
          updated_at: saved.updated_at,
          is_deleted: 0,
          encrypted_data: enc.encrypted_data,
          data_iv: enc.iv,
        },
      ])

      upsertNote({
        id,
        version: saved.version,
        updated_at: saved.updated_at,
        is_deleted: 0,
        payload,
      })
      indexTextRef.current.set(id, buildNoteSearchText(payload))
      navigateToNote(id)
    } catch (err) {
      setError(formatErrorZh(err))
    } finally {
      setBusy(false)
      setBusyText(null)
    }
  }

  async function saveSelected() {
    if (!masterKey || !selected) return
    setError(null)
    if (localDraftSaveTimerRef.current) window.clearTimeout(localDraftSaveTimerRef.current)
    if (localDraftSaveIdleHandleRef.current) cancelIdle(localDraftSaveIdleHandleRef.current)
    localDraftSaveTimerRef.current = null
    localDraftSaveIdleHandleRef.current = null
    setBusyText('正在同步…')
    setBusy(true)
    try {
      const requireSyncSaved = (): SyncSavedRecord => {
        const saved = syncSavedRef.current
        if (!saved) throw new Error('同步完成，但未收到服务器确认')
        return saved
      }
      const markdown = blockNoteRef.current?.getMarkdown()
      if (typeof markdown === 'string' && markdown !== draftContentRef.current) {
        draftContentRef.current = markdown
        setDraftContent(markdown)
      }
      const content = typeof markdown === 'string' ? markdown : draftContentRef.current
      const payload: NotePayload = {
        meta: {
          title: draftTitle.trim() || '未命名',
          created_at: selectedBaseline?.meta.created_at ?? selected.payload.meta.created_at,
          tags: draftTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          is_favorite: draftFavorite,
        },
        content,
        attachments: draftAttachments,
      }
      const payloadForStore: NotePayload = { ...payload, content: clampNoteContentForStore(payload.content), attachments: {} }
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

      indexTextRef.current.set(selected.id, buildNoteSearchText(payload))
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
      setBusy(false)
      setBusyText(null)
    }
  }

  // 更新 saveSelectedRef 以便自动保存使用
  useEffect(() => {
    saveSelectedRef.current = saveSelected
  })

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
      const payload = selected.payload
      const enc = await encryptNotePayload(masterKey, payload, noteAad(selected.id))
      let res: NotesPostResponse
      try {
        res = await postJSON<NotesPostResponse>('/api/notes', [
          {
            id: selected.id,
            encrypted_data: enc.encrypted_data,
            iv: enc.iv,
            base_version: selected.version,
            is_deleted: true,
          },
        ])
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          res = err.payload as NotesPostResponse
        } else {
          throw err
        }
      }

      if (res.conflicts.includes(selected.id)) {
        throw new Error('同步失败，请稍后重试')
      }

      const saved = res.saved.find((s) => s.id === selected.id)
      if (!saved) throw new Error('已删除，但未收到服务器确认。请稍后点“从云端同步”确认结果')

      await idbUpsertEncryptedNotes([
        {
          id: selected.id,
          version: saved.version,
          updated_at: saved.updated_at,
          is_deleted: 1,
          encrypted_data: enc.encrypted_data,
          data_iv: enc.iv,
        },
      ])

      indexTextRef.current.delete(selected.id)
      removeNote(selected.id)
    } catch (err) {
      setError(formatErrorZh(err))
    } finally {
      setBusy(false)
      setBusyText(null)
    }
  }

  async function optimizeImageAttachment(file: File): Promise<{ dataUrl: string; filename: string; bytes: number }> {
    const res = await compressImageToDataUrl(file, { maxBytes: 1_000_000 })
    return { dataUrl: res.dataUrl, filename: res.filename, bytes: res.bytes }
  }

  async function addAttachments(files: File[]): Promise<Array<{ name: string; isImage: boolean }>> {
    if (!selected) return []
    if (attachmentsBusy) return []
    setError(null)
    setAttachmentsBusy(true)
    setAttachmentsProgress({ done: 0, total: files.length })
    try {
      const next: Record<string, string> = { ...draftAttachments }
      const existing = new Set(Object.keys(next))
      const added: Array<{ name: string; isImage: boolean }> = []
      const failures: Array<{ file: string; message: string }> = []
      const total = files.length
      let done = 0

      for (const file of files) {
        const label = file.name || 'attachment'
        try {
          if (file.type.startsWith('image/')) {
            if (file.type === 'image/svg+xml') throw new Error('不支持 SVG 图片，请转换为 PNG/JPG/WebP 后重试')
            const optimized = await optimizeImageAttachment(file)
            if (!Number.isFinite(optimized.bytes) || optimized.bytes <= 0) throw new Error('图片压缩失败，请更换图片或降低分辨率后重试')
            if (optimized.bytes > 1_000_000) throw new Error('图片压缩后仍然超过 1MB，请裁剪/降低分辨率后重试')
            const name = uniqueAttachmentName(optimized.filename, existing)
            existing.add(name)
            next[name] = optimized.dataUrl
            added.push({ name, isImage: true })
          } else {
            if (file.size > 1_000_000) throw new Error('附件过大（建议单个文件 < 1MB）')
            const dataUrl = await fileToDataUrl(file)
            const desired = file.name ? sanitizeAttachmentName(file.name) : 'attachment'
            const name = uniqueAttachmentName(desired, existing)
            existing.add(name)
            next[name] = dataUrl
            added.push({ name, isImage: false })
          }
        } catch (err) {
          failures.push({ file: label, message: formatErrorZh(err) })
        } finally {
          done += 1
          setAttachmentsProgress({ done, total })
          await new Promise<void>((r) => requestAnimationFrame(() => r()))
        }
      }

      setDraftAttachments(next)
      if (failures.length) {
        const preview = failures
          .slice(0, 3)
          .map((f) => `${f.file}：${f.message}`)
          .join('\n')
        const more = failures.length > 3 ? `\n…以及另外 ${failures.length - 3} 个文件` : ''
        setError(`部分附件添加失败：\n${preview}${more}`)
      }
      return added
    } finally {
      setAttachmentsBusy(false)
      setAttachmentsProgress(null)
    }
  }

  function countAttachmentRefs(markdown: string, name: string): number {
    const encoded = encodeURIComponent(name)
    const patterns = new Set([encoded, name])
    let count = 0
    for (const p of patterns) {
      const re = new RegExp(`attachment:${escapeRegExp(p)}`, 'g')
      count += markdown.match(re)?.length ?? 0
    }
    return count
  }

  function actuallyRemoveAttachment(name: string): void {
    setDraftAttachments((prev) => {
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  function removeAttachment(name: string): void {
    const refs = countAttachmentRefs(draftContent, name)
    if (refs > 0) {
      setConfirmRemoveAttachment({ name, refs })
      return
    }
    actuallyRemoveAttachment(name)
  }

  function downloadAttachment(name: string): void {
    const dataUrl = draftAttachments[name]
    if (!dataUrl) return
    downloadDataUrl(dataUrl, name)
  }

  /**
   * Handle BlockNote content changes
   * Content is already markdown string
   */
  function handleBlockNoteChange(markdown: string): void {
    draftContentRef.current = markdown
    setDraftContent(markdown)
  }

  function handleYjsDocChange(): void {
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

  useEffect(() => {
    return () => {
      if (yjsContentSyncTimerRef.current) {
        window.clearTimeout(yjsContentSyncTimerRef.current)
        yjsContentSyncTimerRef.current = null
      }
    }
  }, [])

  /**
   * Handle adding attachment from BlockNote
   * Returns the attachment URL in attachment: format
   */
  async function handleBlockNoteAddAttachment(file: File): Promise<string> {
    const added = await addAttachments([file])
    if (added.length > 0) {
      return `attachment:${encodeURIComponent(added[0].name)}`
    }
    throw new Error('Failed to add attachment')
  }

  /**
   * Handle files dropped or pasted in BlockNote
   */
  function handleBlockNoteFiles(files: File[]): void {
    void addAttachments(files)
  }

  const recoveryCodeBase64 = masterKey ? bytesToBase64(masterKey) : ''
  const recoveryCodeHex = masterKey ? bytesToHex(masterKey) : ''

  async function startPairing() {
    if (!masterKey) return
    setPairingError(null)
    setPairingBusy(true)

    pairingKeyPairRef.current = null
    const runId = ++pairingRunIdRef.current

    try {
      const keyPair = await generateEphemeralEcdhKeyPair()
      pairingKeyPairRef.current = keyPair
      const publicKey = await exportPublicKeyJwk(keyPair.publicKey)

      const resp = await postJSON<{ sessionCode: string; sessionSecret: string; expiresAt: number }>('/api/handshake/init', {
        publicKey,
      })

      void navigator.clipboard.writeText(resp.sessionSecret).catch(() => null)
      setPairing({
        sessionCode: resp.sessionCode,
        sessionSecret: resp.sessionSecret,
        expiresAt: resp.expiresAt,
        sas: null,
        sharedSecret: null,
        stage: 'waiting_join',
        sasConfirmed: false,
      })

      let sharedSecret: ArrayBuffer | null = null

      while (runId === pairingRunIdRef.current) {
        const status = await postJSON<{
          status: 'waiting_join' | 'waiting_confirm' | 'finished'
          expiresAt: number
          bobPublicKey: any
        }>('/api/handshake/status/alice', { sessionCode: resp.sessionCode, sessionSecret: resp.sessionSecret })

        setPairing((p) => (p ? { ...p, expiresAt: status.expiresAt } : p))

        if (!sharedSecret && status.bobPublicKey && keyPair.privateKey) {
          sharedSecret = await deriveSharedSecretBits(keyPair.privateKey, status.bobPublicKey as JsonWebKey)
          const sas = await generateSasEmoji(sharedSecret)
          setPairing((p) => (p ? { ...p, sharedSecret, sas, stage: 'sas', sasConfirmed: false } : p))
          break
        }

        await new Promise((r) => setTimeout(r, 1000))
      }
    } catch (err) {
      setPairingError(formatErrorZh(err))
    } finally {
      setPairingBusy(false)
    }
  }

  async function cancelPairing() {
    const code = pairing?.sessionCode
    const secret = pairing?.sessionSecret
    pairingRunIdRef.current += 1
    pairingKeyPairRef.current = null
    setPairing(null)
    if (code && secret) void postJSON('/api/handshake/cancel', { sessionCode: code, sessionSecret: secret }).catch(() => null)
  }

  async function confirmPairing() {
    if (!pairing || !pairing.sharedSecret || !masterKey) return
    setPairingError(null)
    setPairingBusy(true)
    try {
      const { encryptedPayload, iv } = await encryptMasterKeyForTransfer(pairing.sharedSecret, masterKey)
      await postJSON('/api/handshake/confirm', {
        sessionCode: pairing.sessionCode,
        sessionSecret: pairing.sessionSecret,
        encryptedPayload,
        iv,
      })
      setPairing((p) => (p ? { ...p, stage: 'sent' } : p))
    } catch (err) {
      setPairingError(formatErrorZh(err))
    } finally {
      setPairingBusy(false)
    }
  }

  if (!masterKey) return null

  function lockAndLogout() {
    lock()
    void postJSON('/auth/logout', {}).catch(() => null)
  }

  return (
    <SidebarProvider
      className="h-screen"
      style={{ "--sidebar-width": "280px", "--header-height": "64px" } as React.CSSProperties}
    >
      {/* Toast notifications */}
      <ToastStack>
        {indexBuild ? <Toast kind="loading" message={`正在构建搜索索引…（${indexBuild.done}/${indexBuild.total}）`} /> : null}
        {indexError ? <Toast kind="error" message={indexError} onClose={() => setIndexError(null)} /> : null}
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

      {/* Left Sidebar - Note List (照抄 ref 设计) */}
      {(!isNarrow || mobilePane === 'list') && (
      <Sidebar collapsible="none" className={cn(
        "px-2 relative border-r border-border/40",
        isNarrow && "w-full! border-r-0"
      )}>

        {/* 侧边栏头部 - Logo */}
        <SidebarHeader className="h-[--header-height] shrink-0 justify-center px-4! py-2!">
          <div className="flex w-full items-center">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Lock className="h-4 w-4" />
            </div>
            <div className="flex flex-col items-start flex-1 text-left ml-2">
              <span className="text-sm font-medium truncate">
                {brandName}
              </span>
              <span className="text-[11px] text-muted-foreground truncate">
                已端到端加密
              </span>
            </div>
            {/* 移动端顶部操作按钮 */}
            {isNarrow && (
              <div className="flex items-center gap-1 ml-auto">
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
            )}
          </div>
        </SidebarHeader>

        <SidebarContent>
          {/* 笔记分组 */}
          <SidebarGroup className="py-0">
            <SidebarGroupLabel className="text-xs font-normal text-muted-foreground px-2">
              {searchQuery ? (
                <span>搜索结果 ({searchHasMore ? `${visibleNotes.length}+` : visibleNotes.length}/{notes.length})</span>
              ) : (
                <span>全部笔记 ({notes.length})</span>
              )}
              {searchHasMore ? (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs ml-2"
                  onClick={() => setSearchLimit((v) => v + SEARCH_PAGE_SIZE)}
                  disabled={Boolean(indexBuild) || fallbackSearchBusy}
                >
                  加载更多
                </Button>
              ) : null}
            </SidebarGroupLabel>
            <SidebarGroupContent className="py-1">
          <ScrollArea className="flex-1">
            <div className="noteList flex flex-col gap-2 px-2" role="listbox" aria-label="笔记列表">
              {!notesLoaded ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-3" />
                  <p className="text-sm text-muted-foreground">正在加载…</p>
                </div>
              ) : busy && busyText === '正在同步…' && notes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-3" />
                  <p className="text-sm text-muted-foreground">正在同步…</p>
                </div>
              ) : searchQuery && fallbackSearchBusy ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-3" />
                  <p className="text-sm text-muted-foreground">正在搜索…</p>
                </div>
              ) : visibleNotes.length === 0 ? (
                searchQuery ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                    <Search className="h-12 w-12 text-muted-foreground/50 mb-3" />
                    <p className="font-medium mb-1">未找到匹配结果</p>
                    <p className="text-sm text-muted-foreground mb-4">尝试其他关键词</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSearch('')}
                    >
                      清空搜索
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                    <div className="rounded-full bg-muted p-4 mb-4">
                      <Edit3 className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <p className="font-medium mb-1">暂无笔记</p>
                    <p className="text-sm text-muted-foreground">点击顶栏「新建」开始记录</p>
                  </div>
                )
              ) : (
                visibleNotes.map((n) => {
                  const hit = detectSearchHit(n)
                  const hitLabel = hit === 'title' ? '标题' : hit === 'tags' ? '标签' : hit === 'content' ? '内容' : null
                  const tagsText = n.payload.meta.tags.join(', ')
                  const previewLine =
                    searchQuery
                      ? pickSearchPreviewLine(n.payload.content || '', searchQuery) ??
                        pickSearchPreviewLine(tagsText, searchQuery) ??
                        firstNonEmptyLine(n.payload.content || '') ??
                        tagsText
                      : null

                  return (
                    <button
                      key={n.id}
                      className={cn(
                        "w-full text-left p-2.5 rounded-lg transition-colors border",
                        n.id === selectedNoteId 
                          ? "bg-accent text-accent-foreground border-primary/40" 
                          : "bg-accent/30 border-border hover:bg-accent/60 hover:border-primary/30"
                      )}
                      onClick={() => navigateToNote(n.id)}
                      type="button"
                      role="option"
                      aria-selected={n.id === selectedNoteId}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="font-medium text-sm truncate flex-1">
                          {renderHighlighted(n.payload.meta.title || '未命名')}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {hitLabel ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                              {hitLabel}
                            </span>
                          ) : null}
                          {n.payload.meta.is_favorite ? (
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          ) : null}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {searchQuery ? (
                          previewLine ? renderHighlighted(previewLine) : null
                        ) : (
                          <span>{new Date(n.updated_at).toLocaleString()}</span>
                        )}
                      </div>
                      {!searchQuery && tagsText ? (
                        <div className="text-xs text-muted-foreground/70 truncate mt-0.5">
                          {renderHighlighted(tagsText)}
                        </div>
                      ) : null}
                    </button>
                  )
                })
              )}
            </div>
          </ScrollArea>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      )}

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
                <div className="editorTitleBar">
                  <input
                    className="titleInput"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="未命名"
                    aria-label="标题"
                    disabled={editorInputsDisabled}
                  />
                  <div className="editorTitleActions">
                    <button
                      className={draftFavorite ? 'iconBtn active' : 'iconBtn'}
                      data-label={draftFavorite ? '取消收藏' : '收藏'}
                      onClick={() => setDraftFavorite(!draftFavorite)}
                      type="button"
                      title={draftFavorite ? '取消收藏' : '收藏'}
                      aria-label={draftFavorite ? '取消收藏' : '收藏'}
                      aria-pressed={draftFavorite}
                      disabled={busy || attachmentsBusy || !selectedBaseline}
                    >
                      {draftFavorite ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.01 4.38.38-3.32 2.88 1 4.28L12 15.4z" />
                        </svg>
                      )}
                    </button>
                    {/* 保存按钮 - 图标样式 */}
                    <button
                      className="iconBtn"
                      onClick={saveSelected}
                      onMouseDown={(event) => event.preventDefault()}
                      disabled={busy || !dirty}
                      type="button"
                      title="保存并同步到云端"
                      aria-label="保存"
                      style={{ marginLeft: 'auto' }}
                    >
                      {busy && busyText === '正在上传…' ? (
                        <span className="spinner" aria-hidden="true" />
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z" />
                        </svg>
                      )}
                    </button>
                    {/* 删除按钮 - 图标样式 */}
                    <button
                      className="iconBtn"
                      onClick={() => setConfirmDeleteNote(true)}
                      disabled={busy || !selectedBaseline}
                      type="button"
                      title="删除笔记"
                      aria-label="删除"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                      </svg>
                    </button>
                  </div>
                </div>

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

      <AnimatePresence>
        {pairing ? (
          <motion.div
            className="modalOverlay"
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pairingTitle"
              style={{ position: 'relative' }}
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            >
            <button
              type="button"
              onClick={() => {
                if (pairing.stage === 'sent') setPairing(null)
                else void cancelPairing()
              }}
              style={{
                position: 'absolute',
                top: '0.75rem',
                right: '0.75rem',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="关闭"
            >
              <X className="h-5 w-5 text-muted-foreground hover:text-foreground" />
            </button>
            <div className="row">
              <strong id="pairingTitle">添加新设备</strong>
            </div>

            <p className="muted small">
              配对口令已复制到剪贴板（有效期至 {new Date(pairing.expiresAt).toLocaleTimeString()}）。请在新设备输入/粘贴该口令，或在移动端扫码。
            </p>

            <div className="pairTicket">
              <QrCode
                text={
                  typeof window === 'undefined'
                    ? pairing.sessionSecret
                    : buildPairingDeepLink(pairing.sessionSecret, window.location.href)
                }
                size={220}
                className="pairingQr"
                alt="配对口令二维码"
              />
              <div className="pairPhraseBox" aria-label="配对口令">
                <pre className="pairPhraseText">{formatPairingSecretForDisplay(pairing.sessionSecret)}</pre>
              </div>
            </div>

            <div className="row">
              <button
                className="btn"
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(buildPairingDeepLink(pairing.sessionSecret, window.location.href))
                    .catch(() => null)
                }
              >
                复制配对链接
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => void navigator.clipboard.writeText(pairing.sessionSecret).catch(() => null)}
              >
                复制配对口令
              </button>
              {pairing.stage !== 'sent' ? (
                <button className="btn danger" type="button" onClick={() => void cancelPairing()} disabled={pairingBusy}>
                  取消
                </button>
              ) : null}
            </div>

            {pairing.sas ? (
              <div className="infoBox" style={{ marginTop: 10 }}>
                <strong>Emoji 指纹：</strong>
                <span className="sasEmoji">{pairing.sas}</span>
                <div className="muted small">请和新设备上的 Emoji 指纹核对一致。</div>
              </div>
            ) : (
              <p className="muted small">等待新设备加入…</p>
            )}

            {pairing.stage === 'sas' ? (
              <div className="row" style={{ marginTop: 10 }}>
                <label className="rememberRow" style={{ flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={pairing.sasConfirmed}
                    onChange={(e) => setPairing((p) => (p ? { ...p, sasConfirmed: e.target.checked } : p))}
                    disabled={pairingBusy}
                  />
                  <span>我已核对 Emoji 指纹</span>
                </label>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void confirmPairing()}
                  disabled={pairingBusy || !pairing.sasConfirmed}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  确认一致并发送密钥
                </button>
                <span className="muted small">确认后会加密发送主密钥给新设备</span>
              </div>
            ) : null}

            {pairing.stage === 'sent' ? <p className="muted small">已发送密钥，请在新设备完成 Passkey 创建。</p> : null}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {confirmRemoveAttachment ? (
        <ConfirmDialog
          title="删除附件？"
          message={`正文仍引用该附件 ${confirmRemoveAttachment.refs} 处。删除后，这些位置会显示为缺失图片或坏链接。\n\n仍要删除「${confirmRemoveAttachment.name}」吗？`}
          confirmText="继续删除"
          confirmVariant="danger"
          onCancel={() => setConfirmRemoveAttachment(null)}
          onConfirm={() => {
            const ctx = confirmRemoveAttachment
            setConfirmRemoveAttachment(null)
            actuallyRemoveAttachment(ctx.name)
          }}
        />
      ) : null}

      {confirmCleanupUnusedAttachments ? (
        <ConfirmDialog
          title="清理未引用附件？"
          message={
            `将删除 ${confirmCleanupUnusedAttachments.length} 个未被正文引用的附件。\n\n这不会修改正文内容。\n\n清理后请点击“上传”同步到云端。\n\n${confirmCleanupUnusedAttachments
              .slice(0, 8)
              .map((n) => `- ${n}`)
              .join('\n')}${confirmCleanupUnusedAttachments.length > 8 ? `\n…以及另外 ${confirmCleanupUnusedAttachments.length - 8} 个附件` : ''}`
          }
          confirmText="清理"
          confirmVariant="danger"
          onCancel={() => setConfirmCleanupUnusedAttachments(null)}
          onConfirm={() => {
            const names = confirmCleanupUnusedAttachments
            setConfirmCleanupUnusedAttachments(null)
            setDraftAttachments((prev) => {
              const next = { ...prev }
              for (const name of names) delete next[name]
              return next
            })
          }}
        />
      ) : null}

      {confirmDeleteNote && selected ? (
        <ConfirmDialog
          title="删除这条笔记？"
          message={`确定要删除「${selected.payload.meta.title || '未命名'}」吗？\n\n删除会同步到云端并影响所有设备，无法恢复。`}
          confirmText="删除"
          confirmVariant="danger"
          onCancel={() => setConfirmDeleteNote(false)}
          onConfirm={() => {
            setConfirmDeleteNote(false)
            void softDeleteSelected()
          }}
        />
      ) : null}

      {confirmLock ? (
        <ConfirmDialog
          title="锁定并退出？"
          message={'这会清空本机解密密钥并退出。\n\n下次需要再次进行 Passkey 验证才能解锁。\n\n确定要继续吗？'}
          confirmText="锁定并退出"
          confirmVariant="danger"
          onCancel={() => setConfirmLock(false)}
          onConfirm={() => {
            setConfirmLock(false)
            lockAndLogout()
          }}
        />
      ) : null}

      {confirmShowRecoveryCode ? (
        <ConfirmDialog
          title="显示恢复码？"
          message={'恢复码等同于主密钥。任何人获取恢复码都能解密你的所有笔记。\n\n确定要显示并复制恢复码吗？'}
          confirmText="显示并复制"
          confirmVariant="danger"
          onCancel={() => setConfirmShowRecoveryCode(false)}
          onConfirm={() => {
            setConfirmShowRecoveryCode(false)
            void navigator.clipboard.writeText(recoveryCodeBase64).catch(() => null)
            setShowRecoveryCode(true)
          }}
        />
      ) : null}

      <AnimatePresence>
        {showRecoveryCode ? (
          <motion.div
            className="modalOverlay"
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="recoveryCodeTitle"
              ref={recoveryCodeModalRef}
              tabIndex={-1}
              style={{ position: 'relative' }}
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            >
            <button
              type="button"
              onClick={() => setShowRecoveryCode(false)}
              style={{
                position: 'absolute',
                top: '0.75rem',
                right: '0.75rem',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="关闭"
            >
              <X className="h-5 w-5 text-muted-foreground hover:text-foreground" />
            </button>
            <div className="row">
              <strong id="recoveryCodeTitle">恢复码（主密钥）</strong>
            </div>
            <p className="muted small">Base64 已复制到剪贴板。请离线保存，勿在公共场合展示。</p>
            <label className="field">
              <span>Base64</span>
              <textarea readOnly value={recoveryCodeBase64} rows={3} />
            </label>
            <label className="field">
              <span>Hex</span>
              <textarea readOnly value={recoveryCodeHex} rows={3} />
            </label>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showHelp ? (
          <motion.div
            className="modalOverlay"
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="helpTitle"
              ref={helpModalRef}
              tabIndex={-1}
              style={{ position: 'relative' }}
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            >
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              style={{
                position: 'absolute',
                top: '0.75rem',
                right: '0.75rem',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="关闭"
            >
              <X className="h-5 w-5 text-muted-foreground hover:text-foreground" />
            </button>
            <div className="row">
              <strong id="helpTitle">使用帮助</strong>
            </div>

            <div className="helpBody">
              <h3 className="helpTitle">快速入口</h3>
              <ul className="helpList">
                <li>设置（右上角齿轮）：管理设备、同步、恢复码和帮助。</li>
                <li>锁定（右上角红色按钮）：清空本机解密密钥并退出当前会话。</li>
                <li>新建：桌面端在左侧「+ 新建」；移动端在列表页右下角「+」悬浮按钮。</li>
                <li>移动端导航：点列表中的笔记进入编辑；点左上角返回箭头回到列表。</li>
              </ul>

              <h3 className="helpTitle">编辑与同步</h3>
              <ul className="helpList">
                <li>编辑会自动加密保存在本地（无需手动保存）。</li>
                <li>右下角显示“未上传”时，点击“上传”把修改同步到云端（Ctrl/Cmd+S）。</li>
                <li>想获取云端最新内容，点击右上角「从云端同步」（不会上传本地修改）。</li>
                <li>标签用逗号分隔（例如：工作, 日记）；搜索会同时匹配标题/内容/标签。</li>
              </ul>

              <h3 className="helpTitle">附件</h3>
              <ul className="helpList">
                <li>点击回形针打开附件面板；支持拖拽文件添加。</li>
                <li>图片也可以直接拖到正文编辑区，自动插入引用。</li>
                <li>附件会随笔记一起加密并同步（建议单个文件 &lt; 1MB）。</li>
                <li>移除附件后，记得点击“上传”同步到云端。</li>
              </ul>

              <p className="muted small">
                安全提示：恢复码等同于主密钥，务必离线保存；任何人获取恢复码都能解密你的所有笔记。
              </p>
            </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
      />

      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        brandName={brandName}
        onSetBrandName={setBrandName}
        theme={theme}
        onSetTheme={setTheme}
        mode={mode}
        onSetMode={setMode}
        credentialId={credentialId}
        onSetDeviceName={setDeviceName}
        onLock={lockAndLogout}
        busy={busy}
        pairingBusy={pairingBusy}
        masterKey={masterKey}
        onSync={syncNow}
        onStartPairing={startPairing}
        onShowRecoveryCode={() => setConfirmShowRecoveryCode(true)}
        onShowHelp={() => setShowHelp(true)}
      />

      {/* 搜索对话框 */}
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSearch={(query) => {
          if (!query.trim()) return []
          const q = query.toLowerCase()
          return notes
            .filter((n) => {
              const title = (n.payload.meta.title || '').toLowerCase()
              const plainContent = extractPlainText(n.payload.content || '').toLowerCase()
              const tags = n.payload.meta.tags.join(' ').toLowerCase()
              return title.includes(q) || plainContent.includes(q) || tags.includes(q)
            })
            .slice(0, 10)
            .map((n) => {
              const preview = pickSearchPreviewLine(n.payload.content || '', query)
                || firstNonEmptyLine(n.payload.content || '')
                || ''
              return {
                id: n.id,
                title: n.payload.meta.title || '未命名',
                preview,
                date: new Date(n.updated_at).toLocaleString('zh-CN', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                tags: n.payload.meta.tags,
              }
            })
        }}
        onSelect={(id) => {
          navigateToNote(id)
          setSearchOpen(false)
        }}
      />
    </SidebarProvider>
  )
}
