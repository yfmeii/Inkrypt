import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import * as FlexSearch from 'flexsearch'
import { ApiError, deleteJSON, getJSON, postJSON } from '../lib/api'
import { compressImageToDataUrl, downloadDataUrl, fileToDataUrl, sanitizeAttachmentName, uniqueAttachmentName } from '../lib/attachments'
import { bytesToBase64, bytesToHex, decryptNotePayload, encryptNotePayload, isLegacyNoteCiphertext, noteAad, type NotePayload } from '../lib/crypto'
import { formatErrorZh } from '../lib/errors'
import { buildPairingDeepLink, formatPairingSecretForDisplay } from '../lib/pairingSecret'
import { useFocusTrap } from '../lib/focusTrap'
import { useBodyScrollLock } from '../lib/scrollLock'
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
import { MarkdownPreview } from '../components/MarkdownPreview'
import { AttachmentsPanel } from '../components/AttachmentsPanel'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DiffView } from '../components/DiffView'
import { Toast, ToastStack } from '../components/Toast'
import { VirtualList } from '../components/VirtualList'
import { SettingsPanel } from '../components/SettingsPanel'
import { QrCode } from '../components/QrCode'

type NotesGetResponse = { notes: EncryptedNoteRecord[] }
type NotesPostResponse = {
  saved: Array<{ id: string; version: number; updated_at: number }>
  conflicts: string[]
}

type ConflictsGetResponse = {
  note: EncryptedNoteRecord | null
  conflicts: Array<{
    id: string
    encrypted_data: string
    data_iv: string
    device_name: string | null
    created_at: number | null
  }>
}

type ConflictRecord = ConflictsGetResponse['conflicts'][number]

type InkryptNavPage = 'list' | 'note'
type InkryptNavState = { v: 1; page: InkryptNavPage; noteId?: string }

function readInkryptNavState(state: unknown): InkryptNavState | null {
  if (!state || typeof state !== 'object') return null
  const nav = (state as any).inkryptNav
  if (!nav || typeof nav !== 'object') return null
  if ((nav as any).v !== 1) return null
  const page = (nav as any).page
  if (page !== 'list' && page !== 'note') return null
  if (page === 'note' && typeof (nav as any).noteId !== 'string') return null
  return nav as InkryptNavState
}

function withInkryptNavState(state: unknown, nav: InkryptNavState): Record<string, unknown> {
  if (state && typeof state === 'object') return { ...(state as Record<string, unknown>), inkryptNav: nav }
  return { inkryptNav: nav }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)

    setMatches(mql.matches)

    if ('addEventListener' in mql) {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }

    // Safari < 14
    ; (mql as any).addListener(onChange)
    return () => (mql as any).removeListener(onChange)
  }, [query])

  return matches
}

type IdleDeadlineLike = { timeRemaining: () => number; didTimeout: boolean }

function scheduleIdle(cb: (deadline?: IdleDeadlineLike) => void): number {
  if (typeof window === 'undefined') return 0
  const w = window as any
  if (typeof w.requestIdleCallback === 'function') return w.requestIdleCallback(cb, { timeout: 200 })
  return window.setTimeout(() => cb(undefined), 0)
}

function cancelIdle(handle: number): void {
  if (typeof window === 'undefined') return
  const w = window as any
  if (typeof w.cancelIdleCallback === 'function') w.cancelIdleCallback(handle)
  else window.clearTimeout(handle)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const CJK_SEGMENT_RE: RegExp = (() => {
  try {
    return new RegExp('[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]+', 'gu')
  } catch {
    // Fallback for older JS engines: Han + Kana + Hangul blocks (not exhaustive).
    return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g
  }
})()

const WORD_SEGMENT_RE: RegExp = (() => {
  try {
    return new RegExp('[\\p{L}\\p{N}]+', 'gu')
  } catch {
    return /[A-Za-z0-9]+/g
  }
})()

function normalizeSearchText(input: string): string {
  const raw = (input ?? '').toString()
  if (typeof (raw as any).normalize === 'function') return raw.normalize('NFKC').toLowerCase()
  return raw.toLowerCase()
}

function encodeSearchText(input: string): string[] {
  const s = normalizeSearchText(input)
  const out: string[] = []

  const cjkSegments = s.match(CJK_SEGMENT_RE) ?? []
  for (const seg of cjkSegments) {
    for (const ch of seg) out.push(ch)
    for (let i = 0; i + 1 < seg.length; i++) out.push(seg.slice(i, i + 2))
  }

  const nonCjk = s.replace(CJK_SEGMENT_RE, ' ')
  const words = nonCjk.match(WORD_SEGMENT_RE)
  if (words) out.push(...words)

  return out
}

function buildNoteSearchText(payload: NotePayload): string {
  const title = payload.meta.title ?? ''
  const content = payload.content ?? ''
  const tags = payload.meta.tags?.join(' ') ?? ''
  return `${title}\n${title}\n${tags}\n${tags}\n${content}`
}

function pickSearchPreviewLine(markdown: string, query: string): string | null {
  if (!markdown) return null
  if (!query) return null

  let re: RegExp
  try {
    re = new RegExp(escapeRegExp(query), 'i')
  } catch {
    return null
  }

  const m = re.exec(markdown)
  if (!m) return null

  const matchIndex = m.index ?? 0
  const start = markdown.lastIndexOf('\n', matchIndex)
  const end = markdown.indexOf('\n', matchIndex + m[0].length)
  const line = markdown.slice(start === -1 ? 0 : start + 1, end === -1 ? markdown.length : end).replace(/\r/g, '').trim()
  if (!line) return null
  if (line.length > 400) return `${line.slice(0, 400)}…`
  return line
}

function firstNonEmptyLine(markdown: string): string | null {
  if (!markdown) return null
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) return trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed
  }
  return null
}

const NOTE_CONTENT_STORE_LIMIT = 20_000
const SEARCH_PAGE_SIZE = 200

function clampNoteContentForStore(content: string): string {
  if (content.length <= NOTE_CONTENT_STORE_LIMIT) return content
  return content.slice(0, NOTE_CONTENT_STORE_LIMIT)
}

const EMPTY_REFERENCED_ATTACHMENTS: Record<string, string> = {}

function pickReferencedAttachments(
  attachments: Record<string, string>,
  markdown: string,
): Record<string, string> {
  const total = Object.keys(attachments).length
  if (!total) return attachments

  const used = new Set<string>()
  const re = /attachment:([^\s)]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown))) {
    const raw = m[1]
    try {
      used.add(decodeURIComponent(raw))
    } catch {
      used.add(raw)
    }
    if (used.size >= total) return attachments
  }

  if (!used.size) return EMPTY_REFERENCED_ATTACHMENTS
  if (used.size >= total * 0.8) return attachments

  const out: Record<string, string> = {}
  for (const name of used) {
    const dataUrl = attachments[name]
    if (dataUrl) out[name] = dataUrl
  }
  return out
}

export function VaultView() {
  const masterKey = useInkryptStore((s) => s.masterKey)
  const credentialId = useInkryptStore((s) => s.credentialId)
  const deviceName = useInkryptStore((s) => s.deviceName)
  const setDeviceName = useInkryptStore((s) => s.setDeviceName)
  const brandName = useInkryptStore((s) => s.brandName)
  const setBrandName = useInkryptStore((s) => s.setBrandName)
  const theme = useInkryptStore((s) => s.theme)
  const setTheme = useInkryptStore((s) => s.setTheme)
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
  const [isPreview, setIsPreview] = useState(false)
  const [isEditorFullscreen, setIsEditorFullscreen] = useState(false)
  const [showOutline, setShowOutline] = useState(false)
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

  const [showHelp, setShowHelp] = useState(false)
  const [showRecoveryCode, setShowRecoveryCode] = useState(false)
  const [confirmShowRecoveryCode, setConfirmShowRecoveryCode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAttachments, setShowAttachments] = useState(false)
  const [attachmentsBusy, setAttachmentsBusy] = useState(false)
  const [attachmentsProgress, setAttachmentsProgress] = useState<{ done: number; total: number } | null>(null)
  const [confirmRemoveAttachment, setConfirmRemoveAttachment] = useState<{ name: string; refs: number } | null>(null)
  const [confirmDeleteNote, setConfirmDeleteNote] = useState(false)
  const [confirmLock, setConfirmLock] = useState(false)
  const [confirmCleanupUnusedAttachments, setConfirmCleanupUnusedAttachments] = useState<string[] | null>(null)
  // Default true if not set
  const [showInfo, setShowInfo] = useState(() => !localStorage.getItem('inkrypt_hide_info'))
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('inkrypt_sidebar_collapsed') === '1'
    } catch {
      return false
    }
  })

  const isNarrow = useMediaQuery('(max-width: 900px)')
  const [mobilePane, setMobilePane] = useState<'list' | 'editor'>(() => (selectedNoteId ? 'editor' : 'list'))
  const wasNarrowRef = useRef(isNarrow)

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

  useEffect(() => {
    if (isNarrow) {
      setIsSidebarCollapsed(false)
      return
    }

    try {
      setIsSidebarCollapsed(localStorage.getItem('inkrypt_sidebar_collapsed') === '1')
    } catch {
      // ignore
    }
  }, [isNarrow])

  useEffect(() => {
    if (isNarrow) return
    try {
      localStorage.setItem('inkrypt_sidebar_collapsed', isSidebarCollapsed ? '1' : '0')
    } catch {
      // ignore
    }
  }, [isNarrow, isSidebarCollapsed])

  useEffect(() => {
    if (!isEditorFullscreen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [isEditorFullscreen])

  useEffect(() => {
    if (!isEditorFullscreen) return
    if (isNarrow && mobilePane === 'list') setIsEditorFullscreen(false)
  }, [isEditorFullscreen, isNarrow, mobilePane])

  useEffect(() => {
    if (!isEditorFullscreen) return
    if (!selectedNoteId) setIsEditorFullscreen(false)
  }, [isEditorFullscreen, selectedNoteId])

  useEffect(() => {
    if (!isEditorFullscreen) return
    if (isPreview) setIsPreview(false)
    if (showOutline) setShowOutline(false)
    if (showAttachments) setShowAttachments(false)
  }, [isEditorFullscreen, isPreview, showAttachments, showOutline])

  useEffect(() => {
    if (!isEditorFullscreen) return
    const raf = requestAnimationFrame(() => contentTextareaRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [isEditorFullscreen, isPreview])

  const [noteListScale, setNoteListScale] = useState(1)
  useEffect(() => {
    const updateScale = () => {
      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
      const nextScale = Number.isFinite(rootFontSize) && rootFontSize > 0 ? rootFontSize / 16 : 1
      setNoteListScale((prev) => (Math.abs(prev - nextScale) > 0.01 ? nextScale : prev))
    }

    updateScale()
    window.addEventListener('resize', updateScale)
    return () => window.removeEventListener('resize', updateScale)
  }, [])

  const noteListItemHeight = Math.max(88, Math.round(88 * noteListScale))
  const noteListItemGap = Math.max(8, Math.round(8 * noteListScale))

  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const previewContainerRef = useRef<HTMLDivElement | null>(null)
  const splitPaneRef = useRef<HTMLDivElement | null>(null)
  const splitDraggingRef = useRef(false)
  const [splitRatio, setSplitRatio] = useState(() => {
    try {
      const raw = localStorage.getItem('inkrypt_split_ratio')
      const n = raw ? Number(raw) : NaN
      if (Number.isFinite(n)) return Math.max(0.25, Math.min(0.75, n))
    } catch {
      // ignore
    }
    return 0.46
  })

  useEffect(() => {
    try {
      localStorage.setItem('inkrypt_split_ratio', String(splitRatio))
    } catch {
      // ignore
    }
  }, [splitRatio])
  const [editorDragOver, setEditorDragOver] = useState(false)
  const editorScrollTopRef = useRef(0)
  const previewScrollTopRef = useRef(0)
  const recoveryCodeModalRef = useRef<HTMLDivElement | null>(null)
  const helpModalRef = useRef<HTMLDivElement | null>(null)
  const conflictModalRef = useRef<HTMLDivElement | null>(null)

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

  const conflictMineRunIdRef = useRef(0)
  const [conflictNoteId, setConflictNoteId] = useState<string | null>(null)
  const [conflictServer, setConflictServer] = useState<{ note: DecryptedNote; raw: EncryptedNoteRecord } | null>(null)
  const [conflictVersions, setConflictVersions] = useState<ConflictRecord[]>([])
  const [conflictSelectedId, setConflictSelectedId] = useState<string | null>(null)
  const [conflictMineLoading, setConflictMineLoading] = useState(false)
  const [conflictMergeTouched, setConflictMergeTouched] = useState(false)
  const [conflictMine, setConflictMine] = useState<{ note: DecryptedNote; raw: ConflictRecord } | null>(null)
  const conflictOpen = Boolean(conflictNoteId && conflictServer)

  useFocusTrap(conflictModalRef, conflictOpen)
  useBodyScrollLock(Boolean(pairing) || showRecoveryCode || showHelp || conflictOpen)

  useEffect(() => {
    if (!pairing && !showRecoveryCode && !showHelp && !conflictOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return

      if (conflictOpen) {
        conflictMineRunIdRef.current += 1
        setConflictNoteId(null)
        setConflictServer(null)
        setConflictMine(null)
        setConflictVersions([])
        setConflictSelectedId(null)
        setConflictMineLoading(false)
        setConflictMergeTouched(false)
        return
      }

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
  }, [cancelPairing, conflictNoteId, conflictServer, pairing, showHelp, showRecoveryCode])

  const selected = useMemo(
    () => (selectedNoteId ? notes.find((n) => n.id === selectedNoteId) ?? null : null),
    [notes, selectedNoteId],
  )

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

  const baseVersionMismatch = Boolean(selected && typeof editBaseVersion === 'number' && editBaseVersion !== selected.version)

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

  useEffect(() => {
    if (!masterKey || !selected || !selectedBaseline) return
    if (busy) return

    const noteId = selected.id

    if (localDraftSaveTimerRef.current) window.clearTimeout(localDraftSaveTimerRef.current)
    if (localDraftSaveIdleHandleRef.current) cancelIdle(localDraftSaveIdleHandleRef.current)
    localDraftSaveTimerRef.current = null
    localDraftSaveIdleHandleRef.current = null

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
      localDraftSaveTimerRef.current = null
      localDraftSaveIdleHandleRef.current = null
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

  const deferredPreviewContent = useDeferredValue(draftContent)
  const previewAttachments = useMemo(
    () => pickReferencedAttachments(draftAttachments, deferredPreviewContent),
    [draftAttachments, deferredPreviewContent],
  )

  const attachmentRefs = useMemo(() => {
    const out: Record<string, number> = {}
    const names = Object.keys(draftAttachments)
    if (!names.length) return out
    for (const name of names) out[name] = countAttachmentRefs(draftContent, name)
    return out
  }, [draftAttachments, draftContent])

  useEffect(() => {
    const wasNarrow = wasNarrowRef.current
    wasNarrowRef.current = isNarrow

    if (!isNarrow) return
    if (!selectedNoteId) {
      navigateToList()
      return
    }

    if (!wasNarrow) {
      navigateToNote(selectedNoteId)
      return
    }

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

    if (!masterKey) return

    void (async () => {
      try {
        const enc = await idbGetEncryptedNote(noteId)
        if (!enc) return
        if (selectedLoadRunIdRef.current !== runId) return

        const payload = await decryptNotePayload(masterKey, enc.encrypted_data, enc.data_iv, noteAad(noteId))
        if (selectedLoadRunIdRef.current !== runId) return

        setSelectedBaseline(payload)
        setDraftTitle(payload.meta.title)
        setDraftContent(payload.content)
        setDraftTags(payload.meta.tags.join(', '))
        setDraftFavorite(payload.meta.is_favorite)
        setDraftAttachments(payload.attachments ?? {})
        setEditBaseVersion(enc.version)

        try {
          const draft = await idbGetDraftNote(noteId)
          if (!draft) return
          if (selectedLoadRunIdRef.current !== runId) return

          const draftPayload = await decryptNotePayload(masterKey, draft.encrypted_data, draft.data_iv, noteAad(noteId))
          if (selectedLoadRunIdRef.current !== runId) return

          setDraftTitle(draftPayload.meta.title)
          setDraftContent(draftPayload.content)
          setDraftTags(draftPayload.meta.tags.join(', '))
          setDraftFavorite(draftPayload.meta.is_favorite)
          setDraftAttachments(draftPayload.attachments ?? {})
          setEditBaseVersion(draft.base_version)
          setLocalDraftInfo({ savedAt: draft.saved_at, baseVersion: draft.base_version })
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
    const raf = requestAnimationFrame(() => {
      const editor = contentTextareaRef.current
      if (editor) editor.scrollTop = editorScrollTopRef.current

      const preview = previewContainerRef.current
      if (preview) preview.scrollTop = previewScrollTopRef.current
    })
    return () => cancelAnimationFrame(raf)
  }, [isPreview, isNarrow])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!splitDraggingRef.current) return
      const el = splitPaneRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const ratio = rect.width > 0 ? x / rect.width : 0.5
      const next = Math.max(0.25, Math.min(0.75, ratio))
      setSplitRatio((prev) => (Math.abs(prev - next) > 0.002 ? next : prev))
    }

    const onUp = () => {
      splitDraggingRef.current = false
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

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

            if (selectedNoteId === n.id && !dirty && selectedBaseline) {
              setSelectedBaseline(payload)
              setDraftTitle(payload.meta.title)
              setDraftContent(payload.content)
              setDraftTags(payload.meta.tags.join(', '))
              setDraftFavorite(payload.meta.is_favorite)
              setDraftAttachments(payload.attachments ?? {})
              setEditBaseVersion(n.version)
            }
          } catch {
            // ignore corrupted note; keep encrypted in IDB for forensic
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
        setConflictNoteId(id)
        return
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
    setBusyText('正在上传…')
    setBusy(true)
    try {
      const baseVersion =
        typeof editBaseVersion === 'number' && Number.isFinite(editBaseVersion) ? editBaseVersion : selected.version
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
        content: draftContent,
        attachments: draftAttachments,
      }
      const payloadForStore: NotePayload = { ...payload, content: clampNoteContentForStore(payload.content), attachments: {} }

      const enc = await encryptNotePayload(masterKey, payload, noteAad(selected.id))
      let res: NotesPostResponse
      try {
        res = await postJSON<NotesPostResponse>('/api/notes', [
          {
            id: selected.id,
            encrypted_data: enc.encrypted_data,
            iv: enc.iv,
            base_version: baseVersion,
            is_deleted: false,
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
        setConflictNoteId(selected.id)
        return
      }

      const saved = res.saved.find((s) => s.id === selected.id)
      if (!saved) throw new Error('已上传，但未收到服务器确认。请稍后点“从云端同步”确认结果')

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
        setConflictNoteId(selected.id)
        return
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

  function buildAttachmentInsertText(added: Array<{ name: string; isImage: boolean }>): string {
    const lines = added
      .map((a) => {
        const ref = `attachment:${encodeURIComponent(a.name)}`
        return a.isImage ? `![${a.name}](${ref})` : `[${a.name}](${ref})`
      })
    if (!lines.length) return ''
    return lines.join('\n') + '\n'
  }

  function insertTextAtRange(insertText: string, range: { start: number; end: number }): void {
    setDraftContent((prev) => prev.slice(0, range.start) + insertText + prev.slice(range.end))
    requestAnimationFrame(() => {
      const el = contentTextareaRef.current
      if (!el) return
      const pos = range.start + insertText.length
      try {
        el.focus()
        el.setSelectionRange(pos, pos)
      } catch {
        // ignore
      }
    })
  }

  function applyEditorEdit(next: { value: string; selectionStart: number; selectionEnd: number }): void {
    setDraftContent(next.value)
    requestAnimationFrame(() => {
      const el = contentTextareaRef.current
      if (!el) return
      try {
        el.focus()
        el.setSelectionRange(next.selectionStart, next.selectionEnd)
      } catch {
        // ignore
      }
    })
  }

  function wrapSelection(prefix: string, suffix = prefix): void {
    const el = contentTextareaRef.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? start
    const selectedText = draftContent.slice(start, end)
    const nextValue = draftContent.slice(0, start) + prefix + selectedText + suffix + draftContent.slice(end)
    const nextStart = start + prefix.length
    const nextEnd = end + prefix.length
    applyEditorEdit({ value: nextValue, selectionStart: nextStart, selectionEnd: nextEnd })
  }

  function indentSelection(outdent: boolean): void {
    const el = contentTextareaRef.current
    if (!el) return

    const indent = '  '
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? start

    // No selection: insert spaces at cursor (Tab) / outdent current line (Shift+Tab)
    if (start === end && !outdent) {
      const nextValue = draftContent.slice(0, start) + indent + draftContent.slice(end)
      const pos = start + indent.length
      applyEditorEdit({ value: nextValue, selectionStart: pos, selectionEnd: pos })
      return
    }

    const lineStart = draftContent.lastIndexOf('\n', start - 1) + 1
    const lineEndRaw = draftContent.indexOf('\n', end)
    const lineEnd = lineEndRaw === -1 ? draftContent.length : lineEndRaw

    const segment = draftContent.slice(lineStart, lineEnd)
    const lines = segment.split('\n')

    if (!outdent) {
      const nextSegment = lines.map((l) => indent + l).join('\n')
      const nextValue = draftContent.slice(0, lineStart) + nextSegment + draftContent.slice(lineEnd)
      const nextStart = start + indent.length
      const nextEnd = end + indent.length * lines.length
      applyEditorEdit({ value: nextValue, selectionStart: nextStart, selectionEnd: nextEnd })
      return
    }

    let removedTotal = 0
    let removedFirst = 0
    const nextLines = lines.map((l, idx) => {
      let removed = 0
      if (l.startsWith(indent)) removed = indent.length
      else if (l.startsWith('\t')) removed = 1
      else if (l.startsWith(' ')) removed = 1

      if (idx === 0) removedFirst = removed
      removedTotal += removed
      return removed ? l.slice(removed) : l
    })

    const nextSegment = nextLines.join('\n')
    const nextValue = draftContent.slice(0, lineStart) + nextSegment + draftContent.slice(lineEnd)
    const nextStart = Math.max(lineStart, start - removedFirst)
    const nextEnd = Math.max(nextStart, end - removedTotal)
    applyEditorEdit({ value: nextValue, selectionStart: nextStart, selectionEnd: nextEnd })
  }

  function continueMarkdownList(): boolean {
    const el = contentTextareaRef.current
    if (!el) return false

    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? start
    if (start !== end) return false

    const lineStart = draftContent.lastIndexOf('\n', start - 1) + 1
    const lineEndRaw = draftContent.indexOf('\n', start)
    const lineEnd = lineEndRaw === -1 ? draftContent.length : lineEndRaw
    const line = draftContent.slice(lineStart, lineEnd)

    const bullet = /^(\s*)([-*+])\s+/.exec(line)
    const ordered = /^(\s*)(\d+)\.\s+/.exec(line)
    const quote = /^(\s*)>\s+/.exec(line)
    const m = bullet ?? ordered ?? quote
    if (!m) return false

    const markerLen = m[0].length
    const rest = line.slice(markerLen)

    // Empty item: remove marker and keep indentation
    if (rest.trim() === '' && start === lineEnd) {
      const indent = m[1] ?? ''
      const nextValue = draftContent.slice(0, lineStart) + indent + '\n' + draftContent.slice(lineEnd)
      const pos = lineStart + indent.length + 1
      applyEditorEdit({ value: nextValue, selectionStart: pos, selectionEnd: pos })
      return true
    }

    let marker = ''
    if (bullet) marker = `${bullet[1]}${bullet[2]} `
    else if (ordered) marker = `${ordered[1]}${Number(ordered[2]) + 1}. `
    else marker = `${quote![1]}> `

    const insert = `\n${marker}`
    const nextValue = draftContent.slice(0, start) + insert + draftContent.slice(end)
    const pos = start + insert.length
    applyEditorEdit({ value: nextValue, selectionStart: pos, selectionEnd: pos })
    return true
  }

  function handleEditorKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()

    if (e.key === 'Tab') {
      e.preventDefault()
      indentSelection(e.shiftKey)
      return
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      if (continueMarkdownList()) e.preventDefault()
      return
    }

    if (!mod || e.altKey) return

    if (key === 'b') {
      e.preventDefault()
      wrapSelection('**')
      return
    }

    if (key === 'i') {
      e.preventDefault()
      wrapSelection('_')
      return
    }

    if (key === 'k') {
      e.preventDefault()
      const el = contentTextareaRef.current
      if (!el) return
      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? start
      const selectedText = draftContent.slice(start, end) || '链接文字'
      const template = `[${selectedText}](https://)`
      const nextValue = draftContent.slice(0, start) + template + draftContent.slice(end)
      const urlStart = start + selectedText.length + 3
      const urlEnd = urlStart + 'https://'.length
      applyEditorEdit({ value: nextValue, selectionStart: urlStart, selectionEnd: urlEnd })
      return
    }

    if (key === 's') {
      if (!selected || busy || !dirty) return
      e.preventDefault()
      void saveSelected()
    }
  }

  async function addAttachmentsAndInsertIntoEditor(files: File[], range: { start: number; end: number }): Promise<void> {
    const added = await addAttachments(files)
    const insert = buildAttachmentInsertText(added)
    if (!insert) return
    insertTextAtRange(insert, range)
  }

  async function addAttachmentsAndInsertAtCursor(files: File[]): Promise<void> {
    const el = contentTextareaRef.current
    const start = el?.selectionStart ?? draftContent.length
    const end = el?.selectionEnd ?? start
    await addAttachmentsAndInsertIntoEditor(files, { start, end })
  }

  async function openConflict(noteId: string) {
    if (!masterKey) return
    setError(null)
    conflictMineRunIdRef.current += 1
    setConflictMineLoading(false)
    setConflictMergeTouched(false)
    setConflictVersions([])
    setConflictSelectedId(null)
    setBusyText('正在加载冲突…')
    setBusy(true)
    try {
      const res = await getJSON<ConflictsGetResponse>(`/api/notes/${noteId}/conflicts`)
      if (!res.note) throw new Error('云端未找到该笔记（可能已被删除）')
      if (!res.conflicts.length) throw new Error('未找到冲突记录（可能已解决）')

      const serverPayload = await decryptNotePayload(masterKey, res.note.encrypted_data, res.note.data_iv, noteAad(noteId))
      const serverNote: DecryptedNote = { ...res.note, payload: serverPayload }

      setConflictVersions(res.conflicts)
      const mineRaw = res.conflicts[0]
      setConflictSelectedId(mineRaw.id)
      const minePayload = await decryptNotePayload(masterKey, mineRaw.encrypted_data, mineRaw.data_iv, noteAad(noteId))
      const mineNote: DecryptedNote = {
        id: noteId,
        version: serverNote.version,
        updated_at: serverNote.updated_at,
        is_deleted: 0,
        payload: minePayload,
      }

      setConflictServer({ note: serverNote, raw: res.note })
      setConflictMine({
        note: mineNote,
        raw: mineRaw,
      })
      setDraftTitle(mineNote.payload.meta.title)
      setDraftContent(mineNote.payload.content)
      setDraftTags(mineNote.payload.meta.tags.join(', '))
      setDraftFavorite(mineNote.payload.meta.is_favorite)
      setDraftAttachments(mineNote.payload.attachments ?? {})
    } catch (err) {
      setError(formatErrorZh(err))
      setConflictNoteId(null)
      setConflictServer(null)
      setConflictMine(null)
      setConflictVersions([])
      setConflictSelectedId(null)
      setConflictMineLoading(false)
      setConflictMergeTouched(false)
    } finally {
      setBusy(false)
      setBusyText(null)
    }
  }

  function formatConflictOption(c: ConflictRecord): string {
    const device = c.device_name ?? '\u672a\u77e5\u8bbe\u5907'
    const createdAt = c.created_at ? new Date(c.created_at).toLocaleString() : '\u672a\u77e5\u65f6\u95f4'
    return `${device} · ${createdAt}`
  }

  async function selectConflictVersion(conflictId: string): Promise<void> {
    if (!masterKey || !conflictServer || !conflictNoteId) return
    const raw = conflictVersions.find((c) => c.id === conflictId)
    if (!raw) return
    if (conflictMine?.raw.id === raw.id) return

    setConflictSelectedId(conflictId)

    const runId = ++conflictMineRunIdRef.current
    setConflictMineLoading(true)
    try {
      const minePayload = await decryptNotePayload(masterKey, raw.encrypted_data, raw.data_iv, noteAad(conflictNoteId))
      if (conflictMineRunIdRef.current !== runId) return

      const mineNote: DecryptedNote = {
        id: conflictNoteId,
        version: conflictServer.note.version,
        updated_at: conflictServer.note.updated_at,
        is_deleted: 0,
        payload: minePayload,
      }

      setConflictMine({ note: mineNote, raw })

      if (!conflictMergeTouched) {
        setDraftTitle(mineNote.payload.meta.title)
        setDraftContent(mineNote.payload.content)
        setDraftTags(mineNote.payload.meta.tags.join(', '))
        setDraftFavorite(mineNote.payload.meta.is_favorite)
        setDraftAttachments(mineNote.payload.attachments ?? {})
      }
    } catch (err) {
      if (conflictMineRunIdRef.current !== runId) return
      setError(formatErrorZh(err))
    } finally {
      if (conflictMineRunIdRef.current !== runId) return
      setConflictMineLoading(false)
    }
  }

  useEffect(() => {
    if (!conflictNoteId) return
    void openConflict(conflictNoteId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictNoteId])

  async function resolveConflict(mergedContent: string, mergedTitle: string) {
    if (!masterKey || !conflictServer) return
    setError(null)
    setBusyText('正在上传合并…')
    setBusy(true)
    try {
      const baseVersion = conflictServer.raw.version
      const mergedTags = draftTagsNormalized
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const mergedAttachments = { ...(conflictServer.note.payload.attachments ?? {}), ...draftAttachments }
      const payload: NotePayload = {
        meta: {
          ...conflictServer.note.payload.meta,
          title: mergedTitle.trim() || '未命名',
          tags: mergedTags,
          is_favorite: draftFavorite,
        },
        content: mergedContent,
        attachments: mergedAttachments,
      }
      const payloadForStore: NotePayload = { ...payload, content: clampNoteContentForStore(payload.content), attachments: {} }

      const enc = await encryptNotePayload(masterKey, payload, noteAad(conflictServer.raw.id))
      let res: NotesPostResponse
      try {
        res = await postJSON<NotesPostResponse>('/api/notes', [
          {
            id: conflictServer.raw.id,
            encrypted_data: enc.encrypted_data,
            iv: enc.iv,
            base_version: baseVersion,
            is_deleted: false,
          },
        ])
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          res = err.payload as NotesPostResponse
        } else {
          throw err
        }
      }

      if (res.conflicts.includes(conflictServer.raw.id)) {
        throw new Error('仍存在冲突：请先点击“从云端同步”，再重试“上传合并”')
      }

      const saved = res.saved.find((s) => s.id === conflictServer.raw.id)
      if (!saved) throw new Error('合并已上传，但未收到服务器确认。请稍后点“从云端同步”确认结果')

      await idbUpsertEncryptedNotes([
        {
          id: conflictServer.raw.id,
          version: saved.version,
          updated_at: saved.updated_at,
          is_deleted: 0,
          encrypted_data: enc.encrypted_data,
          data_iv: enc.iv,
        },
      ])

      indexTextRef.current.set(conflictServer.raw.id, buildNoteSearchText(payload))
      await deleteJSON(`/api/notes/${conflictServer.raw.id}/conflicts`)
      upsertNote({ id: conflictServer.raw.id, version: saved.version, updated_at: saved.updated_at, is_deleted: 0, payload: payloadForStore })
      if (selectedNoteId === conflictServer.raw.id) setSelectedBaseline(payload)
      setEditBaseVersion(saved.version)
      setLocalDraftInfo(null)
      setLocalDraftError(null)
      setLocalDraftSaving(false)
      await idbDeleteDraftNote(conflictServer.raw.id)

      setConflictNoteId(null)
      setConflictServer(null)
      setConflictMine(null)
      setConflictVersions([])
      setConflictSelectedId(null)
      setConflictMineLoading(false)
      setConflictMergeTouched(false)
    } catch (err) {
      setError(formatErrorZh(err))
    } finally {
      setBusy(false)
      setBusyText(null)
    }
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

  function togglePreviewMode() {
    setIsPreview((p) => !p)
  }

  function openNote(noteId: string) {
    navigateToNote(noteId)
  }

  const sidebarCollapsed = !isNarrow && isSidebarCollapsed

  const mobileEditorOpen = isNarrow && mobilePane === 'editor'
  const mobileEditScrollLock = mobileEditorOpen && !isPreview
  const vaultClassName = [
    'vault',
    isEditorFullscreen ? 'editorFullscreen' : null,
    sidebarCollapsed ? 'sidebarCollapsed' : null,
    mobileEditorOpen ? 'mobileEditorOpen' : null,
    mobileEditScrollLock ? 'mobileEditScrollLock' : null,
  ]
    .filter((v): v is string => Boolean(v))
    .join(' ')

  return (
    <div className={vaultClassName}>
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

      <header className="topbar">
        <div className="brand">
          {isNarrow && mobilePane === 'editor' ? (
            <button className="iconBtn" data-label="返回" onClick={navigateToList} type="button" title="返回列表" aria-label="返回列表">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
            </button>
          ) : null}
          <strong>{brandName}</strong>
          {selected && (!isNarrow || mobilePane === 'editor') ? (
            <span className="topbarContext" title={selected.payload.meta.title || '未命名'}>
              · {selected.payload.meta.title || '未命名'}
            </span>
          ) : null}
        </div>
        <div className="actions">
          <button
            className="iconBtn"
            data-label="同步"
            onClick={() => void syncNow()}
            disabled={busy}
            type="button"
            title="同步云端数据"
            aria-label="同步"
            aria-busy={busy && busyText === '正在同步…' ? true : undefined}
          >
            {busy && busyText === '正在同步…' ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
              </svg>
            )}
          </button>
          <button className="iconBtn" data-label="设置" onClick={() => setShowSettings(true)} type="button" title="设置" aria-label="设置">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
              </svg>
          </button>
          <button className="btn danger" onClick={() => setConfirmLock(true)} disabled={busy} type="button" title="锁定并退出（清空本机解密密钥）">
            锁定
          </button>
        </div>
      </header>

      {showInfo ? (
        <div className="infoBox">
          <span>
            每一点灵感都值得被安全记录。所有内容均加密存储。
          </span>
          <button
            className="closeBtn"
            title="关闭提示"
            aria-label="关闭提示"
            onClick={() => {
              setShowInfo(false)
              localStorage.setItem('inkrypt_hide_info', '1')
            }}
          >
            关闭
          </button>
        </div>
      ) : null}

      <div className="layout">
        <aside
          className="sidebar"
          aria-hidden={isNarrow && mobilePane === 'editor' ? true : undefined}
          {...(isNarrow && mobilePane === 'editor' ? ({ inert: '' } as any) : {})}
        >
            <div className="sidebarHeader">
              <button className="btn primary" onClick={createNote} disabled={busy} type="button" title="创建一条新笔记">
                + 新建
              </button>
              {!isNarrow ? (
                <button
                  className="iconBtn sidebarCollapseBtn"
                  type="button"
                  onClick={() => setIsSidebarCollapsed((p) => !p)}
                  title={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
                  aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
                  aria-pressed={sidebarCollapsed}
                >
                  {sidebarCollapsed ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                    </svg>
                  )}
                </button>
              ) : null}
            </div>
            <label className="srOnly" htmlFor="vaultSearch">
              搜索笔记
            </label>
            <div className="searchRow">
              <input
                ref={searchInputRef}
                id="vaultSearch"
                className="search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索标题 / 内容 / 标签…"
                inputMode="search"
                aria-label="搜索笔记"
              />
              {search ? (
                <button
                  className="iconBtn searchClear"
                  type="button"
                  onClick={() => {
                    setSearch('')
                    requestAnimationFrame(() => searchInputRef.current?.focus())
                  }}
                  aria-label="清空搜索"
                  title="清空搜索"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              ) : null}
            </div>
            {searchQuery ? (
              <div className="searchStats" aria-label="搜索结果统计">
                <span className="searchStatsCount">{searchHasMore ? `${visibleNotes.length}+` : visibleNotes.length}</span>
                <span className="searchStatsSep">/</span>
                <span className="searchStatsTotal">{notes.length}</span>
                <span className="searchStatsLabel">条结果</span>
                {searchHasMore ? (
                  <button
                    className="searchMoreBtn"
                    type="button"
                    onClick={() => setSearchLimit((v) => v + SEARCH_PAGE_SIZE)}
                    disabled={Boolean(indexBuild) || fallbackSearchBusy}
                    aria-label="加载更多搜索结果"
                    title="加载更多搜索结果"
                  >
                    加载更多
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="noteCount muted small" aria-label="笔记数量">
                共 {notes.length} 条笔记
              </div>
            )}
            <VirtualList
              className="noteList"
              items={visibleNotes}
              itemHeight={noteListItemHeight}
              itemGap={noteListItemGap}
              getKey={(n) => n.id}
              role="listbox"
              aria-label="笔记列表"
              empty={
                !notesLoaded ? (
                  <div className="emptyState">
                    <div className="emptyStateIcon" aria-hidden="true">
                      <span className="spinner" />
                    </div>
                    <p className="muted small">正在加载…</p>
                  </div>
                ) : busy && busyText === '正在同步…' && notes.length === 0 ? (
                  <div className="emptyState">
                    <div className="emptyStateIcon" aria-hidden="true">
                      <span className="spinner" />
                    </div>
                    <p className="muted small">正在同步…</p>
                  </div>
                ) : searchQuery ? (
                  fallbackSearchBusy ? (
                    <div className="emptyState">
                      <div className="emptyStateIcon" aria-hidden="true">
                        <span className="spinner" />
                      </div>
                      <p className="muted small">正在搜索…</p>
                    </div>
                  ) : (
                    <div className="emptyState">
                      <div className="emptyStateIcon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                        </svg>
                      </div>
                      <p className="emptyStateTitle">未找到匹配结果</p>
                      <p className="muted small">尝试其他关键词，或清空搜索查看全部笔记</p>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          setSearch('')
                          requestAnimationFrame(() => searchInputRef.current?.focus())
                        }}
                      >
                        清空搜索
                      </button>
                    </div>
                  )
                ) : (
                  <div className="emptyState">
                    <div className="emptyStateIcon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                      </svg>
                    </div>
                    <p className="emptyStateTitle">空白</p>
                    <p className="muted small">开始记录你的第一条笔记</p>
                    <button className="btn primary" type="button" onClick={createNote} disabled={busy}>
                      新建
                    </button>
                  </div>
                )
              }
              renderItem={(n) => (
                (() => {
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
                  className={n.id === selectedNoteId ? 'noteItem active' : 'noteItem'}
                  onClick={() => openNote(n.id)}
                  type="button"
                  style={{ height: '100%' }}
                  role="option"
                  aria-selected={n.id === selectedNoteId}
                  aria-current={n.id === selectedNoteId ? 'true' : undefined}
                >
                  <div className="noteTitleRow">
                    <span className="noteTitle">{renderHighlighted(n.payload.meta.title || '未命名')}</span>
                    <span className="noteTitleMeta">
                      {hitLabel ? (
                        <span className="hitPill" title={`命中：${hitLabel}`} aria-label={`命中：${hitLabel}`}>
                          {hitLabel}
                        </span>
                      ) : null}
                      {n.payload.meta.is_favorite ? (
                        <span className="favoriteIcon" title="已收藏" aria-label="已收藏">
                          ★
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="noteMeta">
                    {searchQuery ? (
                      <span className="muted small">{previewLine ? renderHighlighted(previewLine) : null}</span>
                    ) : (
                      <>
                        <span className="muted small">{new Date(n.updated_at).toLocaleString()}</span>
                        <span className="muted small">{renderHighlighted(tagsText)}</span>
                      </>
                    )}
                  </div>
                </button>
                  )
                })()
              )}
            />
          </aside>

        <main
          className="editor"
          aria-hidden={isNarrow && mobilePane !== 'editor' ? true : undefined}
          {...(isNarrow && mobilePane !== 'editor' ? ({ inert: '' } as any) : {})}
          onKeyDownCapture={(e) => {
            if (!isEditorFullscreen) return
            if (isNarrow) return
            if (e.key !== 'Escape') return
            e.preventDefault()
            e.stopPropagation()
            setIsEditorFullscreen(false)
          }}
        >
            {selected ? (
              <>
                {isEditorFullscreen && !isNarrow ? (
                  <div className="fullscreenDesktopHeader">
                    <button
                      className="iconBtn fullscreenCloseBtn fullscreenCloseBtnDesktop"
                      type="button"
                      onClick={() => setIsEditorFullscreen(false)}
                      title="退出全屏"
                      aria-label="退出全屏"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    </button>
                  </div>
                ) : null}
                <div className="editorTitleBar">
                  {isEditorFullscreen && isNarrow ? (
                    <button
                      className="iconBtn fullscreenCloseBtn"
                      type="button"
                      onClick={() => setIsEditorFullscreen(false)}
                      title="退出全屏"
                      aria-label="退出全屏"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    </button>
                  ) : null}
                  <input
                    className="titleInput"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="未命名"
                    aria-label="标题"
                    disabled={busy || attachmentsBusy || !selectedBaseline}
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
                    <button
                      className={isPreview ? 'iconBtn active' : 'iconBtn'}
                      data-label={isPreview ? '返回编辑' : isNarrow ? '预览' : '分栏预览'}
                      onClick={togglePreviewMode}
                      type="button"
                      title={isPreview ? '返回编辑' : isNarrow ? '预览' : '分栏预览'}
                      aria-label={isPreview ? '返回编辑' : isNarrow ? '预览' : '分栏预览'}
                      aria-pressed={isPreview}
                      disabled={busy || attachmentsBusy || !selectedBaseline}
                    >
                      {isPreview ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
                        </svg>
                      )}
                    </button>
                    <button
                      className={showOutline ? 'iconBtn active' : 'iconBtn'}
                      data-label="目录"
                      onClick={() => {
                        if (!isPreview) {
                          setIsPreview(true)
                          setShowOutline(true)
                          return
                        }
                        setShowOutline(!showOutline)
                      }}
                      type="button"
                      title={showOutline ? '隐藏目录' : '显示目录'}
                      aria-label={showOutline ? '隐藏目录' : '显示目录'}
                      aria-pressed={showOutline}
                      disabled={busy || attachmentsBusy || !selectedBaseline}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z" />
                      </svg>
                    </button>
                    <button
                      className={showAttachments ? 'iconBtn active' : 'iconBtn'}
                      data-label="附件"
                      onClick={() => setShowAttachments(true)}
                      type="button"
                      title={`附件（${Object.keys(draftAttachments).length}）`}
                      aria-label={`附件（${Object.keys(draftAttachments).length}）`}
                      aria-haspopup="dialog"
                      aria-expanded={showAttachments}
                      disabled={busy || attachmentsBusy || !selectedBaseline}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M16.5 6.5v10.1c0 2.1-1.7 3.9-3.9 3.9s-3.9-1.7-3.9-3.9V6.2c0-1.3 1-2.3 2.3-2.3s2.3 1 2.3 2.3v9.8c0 .5-.4.9-.9.9s-.9-.4-.9-.9V6.5H11v9.5c0 1.4 1.1 2.5 2.5 2.5S16 17.4 16 16V6.2C16 4.4 14.6 3 12.8 3S9.5 4.4 9.5 6.2v10.4c0 2 1.6 3.6 3.6 3.6s3.6-1.6 3.6-3.6V6.5h-.2z" />
                      </svg>
                      {Object.keys(draftAttachments).length ? (
                        <span className="iconBadge" aria-hidden="true">
                          {Object.keys(draftAttachments).length}
                        </span>
                      ) : null}
                    </button>
                    {!isNarrow || !isEditorFullscreen ? (
                      <button
                        className={isEditorFullscreen ? 'iconBtn active' : 'iconBtn'}
                        onClick={() => setIsEditorFullscreen((p) => !p)}
                        type="button"
                        title={isEditorFullscreen ? '退出全屏' : '全屏编辑'}
                        aria-label={isEditorFullscreen ? '退出全屏' : '全屏编辑'}
                        aria-pressed={isEditorFullscreen}
                        disabled={busy || attachmentsBusy || !selectedBaseline}
                      >
                        {isEditorFullscreen ? (
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                          </svg>
                        )}
                      </button>
                    ) : null}
                  </div>
                </div>

                {!selectedBaseline ? <div className="editorHint muted small">正在解密笔记…</div> : null}

                <input
                  className="tagsInput"
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                  placeholder="标签（逗号分隔，例如：工作, 日记）"
                  aria-label="标签（逗号分隔）"
                  disabled={busy || attachmentsBusy || !selectedBaseline}
                />

                {isPreview ? (
                  isNarrow ? (
                    <div
                      className="previewContainer"
                      ref={previewContainerRef}
                      onScroll={(e) => {
                        previewScrollTopRef.current = e.currentTarget.scrollTop
                      }}
                    >
                      <MarkdownPreview content={draftContent} attachments={previewAttachments} showOutline={showOutline} />
                    </div>
                  ) : (
                    <div
                      className="splitPane"
                      ref={splitPaneRef}
                      style={{
                        gridTemplateColumns: `${Math.round(splitRatio * 1000) / 10}% 16px ${Math.round((1 - splitRatio) * 1000) / 10}%`,
                      }}
                    >
                      <div className="splitCol">
                        <textarea
                          className={editorDragOver ? 'contentInput dragOver' : 'contentInput'}
                          ref={contentTextareaRef}
                          value={draftContent}
                          onChange={(e) => setDraftContent(e.target.value)}
                          onKeyDown={handleEditorKeyDown}
                          onScroll={(e) => {
                            editorScrollTopRef.current = e.currentTarget.scrollTop
                          }}
                          placeholder="内容（支持 Markdown 纯文本）…"
                          aria-label="内容"
                          disabled={busy || attachmentsBusy || !selectedBaseline}
                          onDragEnter={(e) => {
                            if (e.dataTransfer.types.includes('Files')) {
                              e.preventDefault()
                              setEditorDragOver(true)
                            }
                          }}
                          onDragOver={(e) => {
                            if (e.dataTransfer.types.includes('Files')) {
                              e.preventDefault()
                              setEditorDragOver(true)
                            }
                          }}
                          onDragLeave={() => setEditorDragOver(false)}
                          onDrop={(e) => {
                            const files = Array.from(e.dataTransfer.files ?? [])
                            if (!files.length) return
                            e.preventDefault()
                            setEditorDragOver(false)
                            const start = e.currentTarget.selectionStart ?? draftContent.length
                            const end = e.currentTarget.selectionEnd ?? start
                            void addAttachmentsAndInsertIntoEditor(files, { start, end })
                          }}
                          onPaste={(e) => {
                            const files = Array.from(e.clipboardData.files ?? [])
                            if (!files.length) return
                            e.preventDefault()
                            const start = e.currentTarget.selectionStart ?? draftContent.length
                            const end = e.currentTarget.selectionEnd ?? start
                            void addAttachmentsAndInsertIntoEditor(files, { start, end })
                          }}
                        />
                      </div>
                      <div
                        className="splitDivider"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="调整编辑与预览宽度"
                        tabIndex={0}
                        onPointerDown={(e) => {
                          splitDraggingRef.current = true
                          const el = splitPaneRef.current
                          if (el) {
                            const rect = el.getBoundingClientRect()
                            const x = e.clientX - rect.left
                            const ratio = rect.width > 0 ? x / rect.width : splitRatio
                            setSplitRatio(Math.max(0.25, Math.min(0.75, ratio)))
                          }
                          try {
                            e.currentTarget.setPointerCapture(e.pointerId)
                          } catch {
                            // ignore
                          }
                          e.preventDefault()
                        }}
                        onPointerUp={() => {
                          splitDraggingRef.current = false
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowLeft') {
                            e.preventDefault()
                            setSplitRatio((r) => Math.max(0.25, Math.min(0.75, r - 0.05)))
                          } else if (e.key === 'ArrowRight') {
                            e.preventDefault()
                            setSplitRatio((r) => Math.max(0.25, Math.min(0.75, r + 0.05)))
                          }
                        }}
                      />
                      <div
                        className="previewContainer splitCol"
                        ref={previewContainerRef}
                        onScroll={(e) => {
                          previewScrollTopRef.current = e.currentTarget.scrollTop
                        }}
                      >
                        <MarkdownPreview content={draftContent} attachments={previewAttachments} showOutline={showOutline} />
                      </div>
                    </div>
                  )
                ) : (
                  <textarea
                    className={editorDragOver ? 'contentInput dragOver' : 'contentInput'}
                    ref={contentTextareaRef}
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    onKeyDown={handleEditorKeyDown}
                    onScroll={(e) => {
                      editorScrollTopRef.current = e.currentTarget.scrollTop
                    }}
                    placeholder="内容（支持 Markdown 纯文本）…"
                    aria-label="内容"
                    disabled={busy || attachmentsBusy || !selectedBaseline}
                    onDragEnter={(e) => {
                      if (e.dataTransfer.types.includes('Files')) {
                        e.preventDefault()
                        setEditorDragOver(true)
                      }
                    }}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes('Files')) {
                        e.preventDefault()
                        setEditorDragOver(true)
                      }
                    }}
                    onDragLeave={() => setEditorDragOver(false)}
                    onDrop={(e) => {
                      const files = Array.from(e.dataTransfer.files ?? [])
                      if (!files.length) return
                      e.preventDefault()
                      setEditorDragOver(false)
                      const start = e.currentTarget.selectionStart ?? draftContent.length
                      const end = e.currentTarget.selectionEnd ?? start
                      void addAttachmentsAndInsertIntoEditor(files, { start, end })
                    }}
                    onPaste={(e) => {
                      const files = Array.from(e.clipboardData.files ?? [])
                      if (!files.length) return
                      e.preventDefault()
                      const start = e.currentTarget.selectionStart ?? draftContent.length
                      const end = e.currentTarget.selectionEnd ?? start
                      void addAttachmentsAndInsertIntoEditor(files, { start, end })
                    }}
                  />
                )}

                <div className="row editorFooter">
                  <div className="rowGroup">
                    <button
                      className="btn primary"
                      onClick={saveSelected}
                      disabled={busy || !dirty}
                      type="button"
                      title="保存并同步到云端"
                    >
                      {busy && busyText === '正在上传…' ? (
                        <>
                          <span className="spinner" aria-hidden="true" /> 保存中…
                        </>
                      ) : (
                        '保存'
                      )}
                    </button>
                    <button
                      className="btn dangerOutline"
                      onClick={() => setConfirmDeleteNote(true)}
                      disabled={busy || !selectedBaseline}
                      type="button"
                      title="删除后会同步到云端"
                    >
                      删除
                    </button>
                  </div>
                  <div className="rowGroup editorStatus">
                    {dirty ? (
                      <>
                        <span className="statusDot unsaved" aria-hidden="true" />
                        <span className="statusText">
                          待同步
                          {localDraftError ? (
                            <span className="statusHint warn" title={localDraftError}>（保存失败）</span>
                          ) : localDraftSaving ? (
                            <span className="statusHint">（保存中…）</span>
                          ) : localDraftInfo ? (
                            <span className="statusHint" title={`基于版本 ${localDraftInfo.baseVersion}，${new Date(localDraftInfo.savedAt).toLocaleTimeString()}`}>（已自动保存）</span>
                          ) : null}
                        </span>
                        {baseVersionMismatch ? (
                          <span className="badge" title={`云端当前 v${selected.version}，草稿基于 v${editBaseVersion}`}>
                            可能有冲突
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="statusDot saved" aria-hidden="true" />
                        <span className="statusText muted">已同步</span>
                      </>
                    )}
                    <span className="statusMeta muted" title={`更新于 ${new Date(selected.updated_at).toLocaleString()}`}>
                      {new Date(selected.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <p className="muted">从左侧选择一条笔记，或点击“+ 新建”创建。</p>
            )}
          </main>
      </div>

      {isNarrow && mobilePane === 'list' ? (
        <button className="fab" onClick={() => void createNote()} disabled={busy} type="button" title="新建笔记" aria-label="新建笔记">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </svg>
        </button>
      ) : null}

      {pairing ? (
        <div className="modalOverlay" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pairingTitle">
            <div className="row">
              <strong id="pairingTitle">添加新设备</strong>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  if (pairing.stage === 'sent') setPairing(null)
                  else void cancelPairing()
                }}
              >
                关闭
              </button>
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
          </div>
        </div>
      ) : null}

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

      {showRecoveryCode ? (
        <div className="modalOverlay" role="presentation">
          <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="recoveryCodeTitle" ref={recoveryCodeModalRef} tabIndex={-1}>
            <div className="row">
              <strong id="recoveryCodeTitle">恢复码（主密钥）</strong>
              <button className="btn" type="button" onClick={() => setShowRecoveryCode(false)}>
                关闭
              </button>
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
          </div>
        </div>
      ) : null}

      {showHelp ? (
        <div className="modalOverlay" role="presentation">
          <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="helpTitle" ref={helpModalRef} tabIndex={-1}>
            <div className="row">
              <strong id="helpTitle">使用帮助</strong>
              <button className="btn" type="button" onClick={() => setShowHelp(false)}>
                关闭
              </button>
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

              <h3 className="helpTitle">冲突处理</h3>
              <ul className="helpList">
                <li>冲突通常发生在多台设备同时编辑同一条笔记并上传时。</li>
                <li>建议流程：先点「从云端同步」→ 选择一个版本作为基线 → 手动合并 → 点击“上传合并”。</li>
                <li>不确定差异在哪里？展开“差异对比”定位改动行。</li>
                <li>若仍提示冲突，请先同步后再重试上传。</li>
              </ul>

              <p className="muted small">
                安全提示：恢复码等同于主密钥，务必离线保存；任何人获取恢复码都能解密你的所有笔记。
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {conflictNoteId && conflictServer ? (
        <div className="modalOverlay" role="presentation">
          <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="conflictTitle" ref={conflictModalRef} tabIndex={-1}>
            <div className="row">
              <strong id="conflictTitle">发生冲突</strong>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  conflictMineRunIdRef.current += 1
                  setConflictNoteId(null)
                  setConflictServer(null)
                  setConflictMine(null)
                  setConflictVersions([])
                  setConflictSelectedId(null)
                  setConflictMineLoading(false)
                  setConflictMergeTouched(false)
                }}
              >
                关闭
              </button>
            </div>

            <p className="muted small">
              {conflictMine
                ? `检测到冲突：云端版本 v${conflictServer.raw.version} vs 我的版本（设备：${conflictMine.raw.device_name ?? '未知'}）。请合并后上传。`
                : `云端版本 v${conflictServer.raw.version} · 正在解密我的版本…`}
              {conflictVersions.length > 1 ? `（共 ${conflictVersions.length} 个冲突版本）` : null}
            </p>
            <p className="muted small">
              建议做法：先用下方按钮选择一个版本作为基线，再在“合并后的内容”里修改；需要对比差异可展开“差异对比”，最后点击“上传合并”。
            </p>

            {conflictVersions.length > 1 ? (
              <label className="field">
                <span>选择冲突版本</span>
                <select
                  value={conflictSelectedId ?? conflictVersions[0]?.id ?? ''}
                  onChange={(e) => void selectConflictVersion(e.target.value)}
                  disabled={busy || conflictMineLoading}
                >
                  {conflictVersions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {formatConflictOption(c)}
                    </option>
                  ))}
                </select>
                <span className="muted small">切换不会自动覆盖合并区。</span>
              </label>
            ) : null}

            <div className="conflictGrid">
              <div className="conflictCol">
                <div className="conflictColHeader">
                  <strong className="small">云端版本</strong>
                  <button
                    className="iconBtn"
                    type="button"
                    title="复制云端版本"
                    aria-label="复制云端版本"
                    onClick={() =>
                      void navigator.clipboard.writeText(conflictServer.note.payload.content).catch(() => null)
                    }
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                    </svg>
                  </button>
                </div>
                <textarea value={conflictServer.note.payload.content} readOnly className="conflictText" />
              </div>
              <div className="conflictCol">
                <div className="conflictColHeader">
                  <strong className="small">我的版本</strong>
                  <button
                    className="iconBtn"
                    type="button"
                    title="复制我的版本"
                    aria-label="复制我的版本"
                    disabled={!conflictMine}
                    onClick={() =>
                      conflictMine
                        ? void navigator.clipboard.writeText(conflictMine.note.payload.content).catch(() => null)
                        : undefined
                    }
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                    </svg>
                  </button>
                </div>
                <textarea
                  value={conflictMine ? conflictMine.note.payload.content : ''}
                  placeholder={conflictMineLoading ? '正在解密我的版本…' : '未能加载我的版本'}
                  readOnly
                  className="conflictText"
                />
              </div>
            </div>

            {conflictMine ? (
              <details open>
                <summary className="muted small">差异对比（云端 vs 我的版本）</summary>
                <div style={{ marginTop: 10 }}>
                  <DiffView a={conflictServer.note.payload.content} b={conflictMine.note.payload.content} />
                </div>
              </details>
            ) : null}

            <label className="field">
              <span>合并后的标题</span>
              <input
                value={draftTitle}
                onChange={(e) => {
                  setConflictMergeTouched(true)
                  setDraftTitle(e.target.value)
                }}
                placeholder="标题"
              />
            </label>
            <label className="field">
              <span>合并后的内容</span>
              <textarea
                value={draftContent}
                onChange={(e) => {
                  setConflictMergeTouched(true)
                  setDraftContent(e.target.value)
                }}
                rows={8}
              />
            </label>

            <div className="row">
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setConflictMergeTouched(true)
                  setDraftTitle(conflictServer.note.payload.meta.title)
                  setDraftContent(conflictServer.note.payload.content)
                  setDraftTags(conflictServer.note.payload.meta.tags.join(', '))
                  setDraftFavorite(conflictServer.note.payload.meta.is_favorite)
                  setDraftAttachments(conflictServer.note.payload.attachments ?? {})
                }}
              >
                使用云端版本
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  if (!conflictMine) return
                  setConflictMergeTouched(true)
                  setDraftTitle(conflictMine.note.payload.meta.title)
                  setDraftContent(conflictMine.note.payload.content)
                  setDraftTags(conflictMine.note.payload.meta.tags.join(', '))
                  setDraftFavorite(conflictMine.note.payload.meta.is_favorite)
                  setDraftAttachments(conflictMine.note.payload.attachments ?? {})
                }}
                disabled={busy || conflictMineLoading || !conflictMine}
              >
                使用我的版本
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={() => resolveConflict(draftContent, draftTitle)}
                disabled={busy || conflictMineLoading}
              >
                上传合并
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <AttachmentsPanel
        isOpen={showAttachments}
        onClose={() => setShowAttachments(false)}
        attachments={draftAttachments}
        refs={attachmentRefs}
        busy={busy || attachmentsBusy}
        progress={attachmentsBusy ? attachmentsProgress : null}
        onAddFiles={(files) => void addAttachmentsAndInsertAtCursor(files)}
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
        credentialId={credentialId}
        deviceName={deviceName}
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
    </div>
  )
}
