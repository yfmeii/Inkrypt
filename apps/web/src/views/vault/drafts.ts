import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { cancelIdle, scheduleIdle } from '../../lib/idle'
import { decryptNotePayload, encryptNotePayload, noteAad, type Bytes, type NotePayload } from '../../lib/crypto'
import { formatErrorZh } from '../../lib/errors'
import {
  idbDeleteDraftNote,
  idbGetDraftNote,
  idbGetEncryptedNote,
  idbSetDraftNote,
} from '../../lib/idb'
import {
  detectNoteFormat,
  type YjsNotePayload,
} from '../../lib/yjs'
import type { DecryptedNote } from '../../state/store'
import { buildDraftSyncState, isDraftDirty, normalizeDraftTags, parseDraftTags, type DraftSyncState } from './draft-state'

export {
  buildDraftSyncState,
  isDraftDirty,
  normalizeDraftTags,
  parseDraftTags,
  type DraftSyncState,
} from './draft-state'

export type LocalDraftInfo = { savedAt: number; baseVersion: number }

type SetState<T> = Dispatch<SetStateAction<T>>

export type LoadedDraftSnapshot = {
  baseline: NotePayload
  baselineVersion: number
  format: ReturnType<typeof detectNoteFormat>
  draft: { payload: NotePayload; baseVersion: number; savedAt: number } | null
}

type SelectedDraftStateSetters = {
  setSelectedBaseline: SetState<NotePayload | null>
  setEditBaseVersion: SetState<number | null>
  setDraftTitle: SetState<string>
  setDraftContent: SetState<string>
  setDraftTags: SetState<string>
  setDraftFavorite: SetState<boolean>
  setDraftAttachments: SetState<Record<string, string>>
  setLocalDraftInfo: SetState<LocalDraftInfo | null>
  setLocalDraftError: SetState<string | null>
  setBlockNoteKey: SetState<number>
}

export type SelectedDraftController = {
  selectedBaseline: NotePayload | null
  setSelectedBaseline: SetState<NotePayload | null>
  editBaseVersion: number | null
  setEditBaseVersion: SetState<number | null>
  draftTitle: string
  setDraftTitle: SetState<string>
  draftContent: string
  setDraftContent: SetState<string>
  draftTags: string
  setDraftTags: SetState<string>
  draftFavorite: boolean
  setDraftFavorite: SetState<boolean>
  draftAttachments: Record<string, string>
  setDraftAttachments: SetState<Record<string, string>>
  blockNoteKey: number
  setBlockNoteKey: SetState<number>
  draftContentRef: MutableRefObject<string>
  draftStateRef: MutableRefObject<DraftSyncState>
  draftTagsNormalized: string
  dirty: boolean
  stateSetters: SelectedDraftStateSetters
}

export function useSelectedDraftController(args: {
  selected: DecryptedNote | null
  setLocalDraftInfo: SetState<LocalDraftInfo | null>
  setLocalDraftError: SetState<string | null>
}): SelectedDraftController {
  const [selectedBaseline, setSelectedBaseline] = useState<NotePayload | null>(null)
  const [editBaseVersion, setEditBaseVersion] = useState<number | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftTags, setDraftTags] = useState('')
  const [draftFavorite, setDraftFavorite] = useState(false)
  const [draftAttachments, setDraftAttachments] = useState<Record<string, string>>({})
  const [blockNoteKey, setBlockNoteKey] = useState(0)

  const draftContentRef = useRef(draftContent)
  const draftStateRef = useRef<DraftSyncState>({
    title: '',
    tags: [],
    is_favorite: false,
    attachments: {},
    content: '',
    createdAt: Date.now(),
  })
  const selectedDraftStateSetters = useMemo<SelectedDraftStateSetters>(
    () => ({
      setSelectedBaseline,
      setEditBaseVersion,
      setDraftTitle,
      setDraftContent,
      setDraftTags,
      setDraftFavorite,
      setDraftAttachments,
      setLocalDraftInfo: args.setLocalDraftInfo,
      setLocalDraftError: args.setLocalDraftError,
      setBlockNoteKey,
    }),
    [args.setLocalDraftError, args.setLocalDraftInfo],
  )

  useEffect(() => {
    draftContentRef.current = draftContent
  }, [draftContent])

  useEffect(() => {
    const createdAt = args.selected?.payload.meta.created_at ?? selectedBaseline?.meta.created_at ?? Date.now()
    draftStateRef.current = buildDraftSyncState({
      draftTitle,
      draftTags,
      draftFavorite,
      draftAttachments,
      draftContent: draftContentRef.current,
      createdAt,
    })
  }, [args.selected, draftAttachments, draftContent, draftFavorite, draftTags, draftTitle, selectedBaseline])

  const draftTagsNormalized = useMemo(() => normalizeDraftTags(draftTags), [draftTags])

  const dirty = useMemo(
    () =>
      isDraftDirty({
        selectedBaseline,
        draftTitle,
        draftContent,
        draftFavorite,
        draftTags: draftTagsNormalized,
        draftAttachments,
      }),
    [draftAttachments, draftContent, draftFavorite, draftTagsNormalized, draftTitle, selectedBaseline],
  )

  return {
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
    draftTagsNormalized,
    dirty,
    stateSetters: selectedDraftStateSetters,
  }
}

export async function loadSelectedDraftSnapshot(args: {
  masterKey: Bytes
  noteId: string
}): Promise<LoadedDraftSnapshot | null> {
  const encryptedNote = await idbGetEncryptedNote(args.noteId)
  if (!encryptedNote) return null

  const baseline = await decryptNotePayload(
    args.masterKey,
    encryptedNote.encrypted_data,
    encryptedNote.data_iv,
    noteAad(args.noteId),
  )
  const format = detectNoteFormat(baseline as YjsNotePayload)

  try {
    const draft = await idbGetDraftNote(args.noteId)
    if (!draft) {
      return {
        baseline,
        baselineVersion: encryptedNote.version,
        format,
        draft: null,
      }
    }

    const draftPayload = await decryptNotePayload(
      args.masterKey,
      draft.encrypted_data,
      draft.data_iv,
      noteAad(args.noteId),
    )

    return {
      baseline,
      baselineVersion: encryptedNote.version,
      format,
      draft: {
        payload: draftPayload,
        baseVersion: draft.base_version,
        savedAt: draft.saved_at,
      },
    }
  } catch {
    await idbDeleteDraftNote(args.noteId).catch(() => null)
    return {
      baseline,
      baselineVersion: encryptedNote.version,
      format,
      draft: null,
    }
  }
}

export function resetSelectedDraftState(setters: SelectedDraftStateSetters): void {
  setters.setSelectedBaseline(null)
  setters.setEditBaseVersion(null)
  setters.setDraftTitle('')
  setters.setDraftContent('')
  setters.setDraftTags('')
  setters.setDraftFavorite(false)
  setters.setDraftAttachments({})
  setters.setLocalDraftInfo(null)
  setters.setLocalDraftError(null)
  setters.setBlockNoteKey((key) => key + 1)
}

export function seedSelectedDraftState(args: {
  noteId: string
  selected: DecryptedNote | null
  setters: SelectedDraftStateSetters
}): void {
  const { noteId, selected, setters } = args
  const selectedMatches = Boolean(selected && selected.id === noteId)
  setters.setSelectedBaseline(selectedMatches && selected ? selected.payload : null)
  setters.setEditBaseVersion(selectedMatches && selected ? selected.version : null)
  setters.setDraftAttachments(selectedMatches && selected ? (selected.payload.attachments ?? {}) : {})
  setters.setLocalDraftInfo(null)
  setters.setLocalDraftError(null)

  if (selectedMatches && selected) {
    setters.setDraftTitle(selected.payload.meta.title)
    setters.setDraftContent(selected.payload.content)
    setters.setDraftTags(selected.payload.meta.tags.join(', '))
    setters.setDraftFavorite(selected.payload.meta.is_favorite)
  } else {
    setters.setDraftTitle('')
    setters.setDraftContent('')
    setters.setDraftTags('')
    setters.setDraftFavorite(false)
  }

  setters.setBlockNoteKey((key) => key + 1)
}

export function applySelectedBaselineState(args: {
  baseline: NotePayload
  baselineVersion: number
  setters: SelectedDraftStateSetters
}): void {
  const { baseline, baselineVersion, setters } = args
  setters.setSelectedBaseline(baseline)
  setters.setDraftTitle(baseline.meta.title)
  setters.setDraftContent(baseline.content)
  setters.setDraftTags(baseline.meta.tags.join(', '))
  setters.setDraftFavorite(baseline.meta.is_favorite)
  setters.setDraftAttachments(baseline.attachments ?? {})
  setters.setEditBaseVersion(baselineVersion)
}

export function applySelectedDraftOverlay(args: {
  payload: NotePayload
  baseVersion: number
  savedAt: number
  includeContent: boolean
  setters: SelectedDraftStateSetters
}): void {
  const { payload, baseVersion, savedAt, includeContent, setters } = args
  setters.setDraftTitle(payload.meta.title)
  if (includeContent) setters.setDraftContent(payload.content)
  setters.setDraftTags(payload.meta.tags.join(', '))
  setters.setDraftFavorite(payload.meta.is_favorite)
  setters.setDraftAttachments(payload.attachments ?? {})
  setters.setEditBaseVersion(baseVersion)
  setters.setLocalDraftInfo({ savedAt, baseVersion })
  setters.setBlockNoteKey((key) => key + 1)
}

export type DraftPersistenceState = {
  masterKey: Bytes | null
  selected: DecryptedNote | null
  selectedBaseline: NotePayload | null
  editBaseVersion: number | null
  busy: boolean
  dirty: boolean
  draftTitle: string
  draftContent: string
  draftTags: string
  draftFavorite: boolean
  draftAttachments: Record<string, string>
}

export type DraftPersistenceEffects = {
  deleteDraft: (noteId: string) => Promise<void>
  encryptPayload: (noteId: string, payload: NotePayload, masterKey: Bytes) => Promise<{ encrypted_data: string; iv: string }>
  setDraft: (draft: {
    v: 1
    note_id: string
    base_version: number
    encrypted_data: string
    data_iv: string
    saved_at: number
  }) => Promise<void>
  schedule: (callback: () => void, delayMs: number) => number
  clearScheduled: (handle: number) => void
  scheduleIdle: (callback: () => void) => number
  cancelIdle: (handle: number) => void
  formatError: (error: unknown) => string
  now: () => number
}

export type DraftPersistenceRefs = {
  localDraftSaveRunIdRef: MutableRefObject<number>
  localDraftSaveTimerRef: MutableRefObject<number | null>
  localDraftSaveIdleHandleRef: MutableRefObject<number | null>
}

export type DraftPersistenceSetters = {
  setLocalDraftInfo: SetState<LocalDraftInfo | null>
  setLocalDraftSaving: SetState<boolean>
  setLocalDraftError: SetState<string | null>
}

export function cancelPendingDraftPersistence(args: {
  refs: DraftPersistenceRefs
  effects: Pick<DraftPersistenceEffects, 'clearScheduled' | 'cancelIdle'>
}): void {
  const { refs, effects } = args
  if (refs.localDraftSaveTimerRef.current) effects.clearScheduled(refs.localDraftSaveTimerRef.current)
  if (refs.localDraftSaveIdleHandleRef.current) effects.cancelIdle(refs.localDraftSaveIdleHandleRef.current)
  refs.localDraftSaveTimerRef.current = null
  refs.localDraftSaveIdleHandleRef.current = null
}

export function scheduleDraftPersistence(args: {
  state: DraftPersistenceState
  setters: DraftPersistenceSetters
  refs: DraftPersistenceRefs
  effects: DraftPersistenceEffects
}): void {
  const { state, setters, refs, effects } = args
  if (!state.masterKey || !state.selected || !state.selectedBaseline) return
  if (state.busy) return

  const masterKey = state.masterKey
  const noteId = state.selected.id
  cancelPendingDraftPersistence({ refs, effects })

  if (!state.dirty) {
    setters.setLocalDraftSaving(false)
    setters.setLocalDraftError(null)
    setters.setLocalDraftInfo(null)
    void effects.deleteDraft(noteId).catch(() => null)
    return
  }

  const baseVersion =
    typeof state.editBaseVersion === 'number' && Number.isFinite(state.editBaseVersion)
      ? state.editBaseVersion
      : state.selected.version

  const runId = ++refs.localDraftSaveRunIdRef.current
  refs.localDraftSaveTimerRef.current = effects.schedule(() => {
    if (refs.localDraftSaveRunIdRef.current !== runId) return
    setters.setLocalDraftSaving(true)

    refs.localDraftSaveIdleHandleRef.current = effects.scheduleIdle(() => {
      void (async () => {
        try {
          const payload: NotePayload = {
            meta: {
              title: state.draftTitle.trim(),
              created_at: state.selectedBaseline?.meta.created_at ?? effects.now(),
              tags: parseDraftTags(state.draftTags),
              is_favorite: state.draftFavorite,
            },
            content: state.draftContent,
            attachments: state.draftAttachments,
          }

          const encrypted = await effects.encryptPayload(noteId, payload, masterKey)
          const savedAt = effects.now()
          await effects.setDraft({
            v: 1,
            note_id: noteId,
            base_version: baseVersion,
            encrypted_data: encrypted.encrypted_data,
            data_iv: encrypted.iv,
            saved_at: savedAt,
          })

          if (refs.localDraftSaveRunIdRef.current !== runId) return
          setters.setLocalDraftInfo({ savedAt, baseVersion })
          setters.setLocalDraftError(null)
        } catch (error) {
          if (refs.localDraftSaveRunIdRef.current !== runId) return
          setters.setLocalDraftError(effects.formatError(error))
        } finally {
          if (refs.localDraftSaveRunIdRef.current !== runId) return
          setters.setLocalDraftSaving(false)
        }
      })()
    })
  }, 800)
}

export function useLocalDraftPersistence(args: {
  masterKey: Bytes | null
  selected: DecryptedNote | null
  selectedBaseline: NotePayload | null
  editBaseVersion: number | null
  busy: boolean
  dirty: boolean
  draftTitle: string
  draftContent: string
  draftTags: string
  draftFavorite: boolean
  draftAttachments: Record<string, string>
  setLocalDraftInfo: SetState<LocalDraftInfo | null>
  setLocalDraftSaving: SetState<boolean>
  setLocalDraftError: SetState<string | null>
}) {
  const localDraftSaveRunIdRef = useRef(0)
  const localDraftSaveTimerRef = useRef<number | null>(null)
  const localDraftSaveIdleHandleRef = useRef<number | null>(null)

  const refs = useMemo<DraftPersistenceRefs>(
    () => ({
      localDraftSaveRunIdRef,
      localDraftSaveTimerRef,
      localDraftSaveIdleHandleRef,
    }),
    [],
  )

  const effects = useMemo<DraftPersistenceEffects>(
    () => ({
      deleteDraft: (noteId) => idbDeleteDraftNote(noteId),
      encryptPayload: (noteId, payload, masterKey) => encryptNotePayload(masterKey, payload, noteAad(noteId)),
      setDraft: (draft) => idbSetDraftNote(draft),
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearScheduled: (handle) => window.clearTimeout(handle),
      scheduleIdle: (callback) => scheduleIdle(() => callback()),
      cancelIdle: (handle) => cancelIdle(handle),
      formatError: (error) => formatErrorZh(error),
      now: () => Date.now(),
    }),
    [],
  )

  const cancelPendingSave = useCallback((): void => {
    cancelPendingDraftPersistence({ refs, effects })
  }, [effects, refs])

  useEffect(() => {
    scheduleDraftPersistence({
      state: {
        masterKey: args.masterKey,
        selected: args.selected,
        selectedBaseline: args.selectedBaseline,
        editBaseVersion: args.editBaseVersion,
        busy: args.busy,
        dirty: args.dirty,
        draftTitle: args.draftTitle,
        draftContent: args.draftContent,
        draftTags: args.draftTags,
      draftFavorite: args.draftFavorite,
      draftAttachments: args.draftAttachments,
    },
      setters: {
        setLocalDraftInfo: args.setLocalDraftInfo,
        setLocalDraftSaving: args.setLocalDraftSaving,
        setLocalDraftError: args.setLocalDraftError,
      },
      refs,
      effects,
    })

    return () => {
      cancelPendingSave()
    }
  }, [
    args.busy,
    args.dirty,
    args.draftAttachments,
    args.draftContent,
    args.draftFavorite,
    args.draftTags,
    args.draftTitle,
    args.editBaseVersion,
    args.masterKey,
    args.selected,
    args.selectedBaseline,
    args.setLocalDraftError,
    args.setLocalDraftInfo,
    args.setLocalDraftSaving,
  ])

  useEffect(() => () => cancelPendingSave(), [])

  return {
    cancelPendingSave,
  }
}
