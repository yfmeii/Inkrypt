import { describe, expect, test, vi } from 'vitest'
import type { MutableRefObject } from 'react'
import type { NotePayload } from '../../lib/crypto'
import type { DecryptedNote } from '../../state/store'
import {
  applySelectedBaselineState,
  cancelPendingDraftPersistence,
  seedSelectedDraftState,
  scheduleDraftPersistence,
  type DraftPersistenceEffects,
  type DraftPersistenceRefs,
} from './drafts'

function makeSelected(): DecryptedNote {
  return {
    id: 'note-1',
    version: 4,
    updated_at: 100,
    is_deleted: 0,
    payload: {
      meta: {
        title: 'Baseline title',
        created_at: 123,
        tags: ['alpha'],
        is_favorite: false,
      },
      content: 'Baseline body',
      attachments: {},
    },
  }
}

function makeBaseline(): NotePayload {
  return {
    meta: {
      title: 'Baseline title',
      created_at: 123,
      tags: ['alpha'],
      is_favorite: false,
    },
    content: 'Baseline body',
    attachments: {},
  }
}

function makeRefs(): DraftPersistenceRefs {
  return {
    localDraftSaveRunIdRef: { current: 0 } as MutableRefObject<number>,
    localDraftSaveTimerRef: { current: null } as MutableRefObject<number | null>,
    localDraftSaveIdleHandleRef: { current: null } as MutableRefObject<number | null>,
  }
}

function makeEffects(overrides: Partial<DraftPersistenceEffects> = {}): DraftPersistenceEffects {
  let nextHandle = 1
  return {
    deleteDraft: vi.fn(async () => undefined),
    encryptPayload: vi.fn(async () => ({ encrypted_data: 'cipher', iv: 'iv-1' })),
    setDraft: vi.fn(async () => undefined),
    schedule: vi.fn((callback: () => void) => {
      callback()
      return nextHandle++
    }),
    clearScheduled: vi.fn(),
    scheduleIdle: vi.fn((callback: () => void) => {
      callback()
      return nextHandle++
    }),
    cancelIdle: vi.fn(),
    formatError: vi.fn(() => 'formatted-error'),
    now: vi.fn(() => 999),
    ...overrides,
  }
}

function makeSelectedBaselineSetters() {
  return {
    setSelectedBaseline: vi.fn(),
    setEditBaseVersion: vi.fn(),
    setDraftTitle: vi.fn(),
    setDraftContent: vi.fn(),
    setDraftTags: vi.fn(),
    setDraftFavorite: vi.fn(),
    setDraftAttachments: vi.fn(),
    setLocalDraftInfo: vi.fn(),
    setLocalDraftError: vi.fn(),
    setBlockNoteKey: vi.fn(),
  }
}

describe('draft persistence helpers', () => {
  test('applies baseline state from an already selected note payload', () => {
    const setters = makeSelectedBaselineSetters()
    const baseline = makeBaseline()

    applySelectedBaselineState({ baseline, baselineVersion: 4, setters })

    expect(setters.setSelectedBaseline).toHaveBeenCalledWith(baseline)
    expect(setters.setDraftTitle).toHaveBeenCalledWith('Baseline title')
    expect(setters.setDraftContent).toHaveBeenCalledWith('Baseline body')
    expect(setters.setDraftTags).toHaveBeenCalledWith('alpha')
    expect(setters.setDraftFavorite).toHaveBeenCalledWith(false)
    expect(setters.setDraftAttachments).toHaveBeenCalledWith({})
    expect(setters.setEditBaseVersion).toHaveBeenCalledWith(4)
  })

  test('seeds selected draft state from the in-memory note immediately', () => {
    const setters = makeSelectedBaselineSetters()
    const selected = makeSelected()

    seedSelectedDraftState({ noteId: 'note-1', selected, setters })

    expect(setters.setSelectedBaseline).toHaveBeenCalledWith(selected.payload)
    expect(setters.setEditBaseVersion).toHaveBeenCalledWith(4)
    expect(setters.setDraftTitle).toHaveBeenCalledWith('Baseline title')
    expect(setters.setDraftContent).toHaveBeenCalledWith('Baseline body')
    expect(setters.setDraftTags).toHaveBeenCalledWith('alpha')
    expect(setters.setDraftFavorite).toHaveBeenCalledWith(false)
    expect(setters.setDraftAttachments).toHaveBeenCalledWith({})
  })

  test('clears pending timers and idle callbacks', () => {
    const refs = makeRefs()
    refs.localDraftSaveTimerRef.current = 11
    refs.localDraftSaveIdleHandleRef.current = 22
    const effects = makeEffects()

    cancelPendingDraftPersistence({ refs, effects })

    expect(effects.clearScheduled).toHaveBeenCalledWith(11)
    expect(effects.cancelIdle).toHaveBeenCalledWith(22)
    expect(refs.localDraftSaveTimerRef.current).toBeNull()
    expect(refs.localDraftSaveIdleHandleRef.current).toBeNull()
  })

  test('deletes the local draft immediately when the editor is clean', async () => {
    const refs = makeRefs()
    const effects = makeEffects()
    const setLocalDraftInfo = vi.fn()
    const setLocalDraftSaving = vi.fn()
    const setLocalDraftError = vi.fn()

    scheduleDraftPersistence({
      state: {
        masterKey: new Uint8Array([1, 2, 3]),
        selected: makeSelected(),
        selectedBaseline: makeBaseline(),
        editBaseVersion: 4,
        busy: false,
        dirty: false,
        draftTitle: 'Baseline title',
        draftContent: 'Baseline body',
        draftTags: 'alpha',
        draftFavorite: false,
        draftAttachments: {},
      },
      setters: {
        setLocalDraftInfo,
        setLocalDraftSaving,
        setLocalDraftError,
      },
      refs,
      effects,
    })

    expect(setLocalDraftSaving).toHaveBeenCalledWith(false)
    expect(setLocalDraftError).toHaveBeenCalledWith(null)
    expect(setLocalDraftInfo).toHaveBeenCalledWith(null)
    expect(effects.deleteDraft).toHaveBeenCalledWith('note-1')
    expect(effects.setDraft).not.toHaveBeenCalled()
  })

  test('persists encrypted drafts for the latest save run', async () => {
    const refs = makeRefs()
    const effects = makeEffects()
    const setLocalDraftInfo = vi.fn()
    const setLocalDraftSaving = vi.fn()
    const setLocalDraftError = vi.fn()

    scheduleDraftPersistence({
      state: {
        masterKey: new Uint8Array([1, 2, 3]),
        selected: makeSelected(),
        selectedBaseline: makeBaseline(),
        editBaseVersion: 7,
        busy: false,
        dirty: true,
        draftTitle: '  Draft title  ',
        draftContent: 'Draft body',
        draftTags: 'alpha, beta',
        draftFavorite: true,
        draftAttachments: { 'a.txt': 'data:text/plain;base64,QQ==' },
      },
      setters: {
        setLocalDraftInfo,
        setLocalDraftSaving,
        setLocalDraftError,
      },
      refs,
      effects,
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(setLocalDraftSaving).toHaveBeenCalledWith(true)
    expect(effects.encryptPayload).toHaveBeenCalledWith(
      'note-1',
      {
        meta: {
          title: 'Draft title',
          created_at: 123,
          tags: ['alpha', 'beta'],
          is_favorite: true,
        },
        content: 'Draft body',
        attachments: { 'a.txt': 'data:text/plain;base64,QQ==' },
      },
      expect.any(Uint8Array),
    )
    expect(effects.setDraft).toHaveBeenCalledWith({
      v: 1,
      note_id: 'note-1',
      base_version: 7,
      encrypted_data: 'cipher',
      data_iv: 'iv-1',
      saved_at: 999,
    })
    expect(setLocalDraftInfo).toHaveBeenCalledWith({ savedAt: 999, baseVersion: 7 })
    expect(setLocalDraftError).toHaveBeenCalledWith(null)
    expect(setLocalDraftSaving).toHaveBeenLastCalledWith(false)
  })

  test('skips scheduling local draft persistence while busy', () => {
    const refs = makeRefs()
    const effects = makeEffects()

    scheduleDraftPersistence({
      state: {
        masterKey: new Uint8Array([1, 2, 3]),
        selected: makeSelected(),
        selectedBaseline: makeBaseline(),
        editBaseVersion: 4,
        busy: true,
        dirty: true,
        draftTitle: 'Draft title',
        draftContent: 'Draft body',
        draftTags: 'alpha',
        draftFavorite: false,
        draftAttachments: {},
      },
      setters: {
        setLocalDraftInfo: vi.fn(),
        setLocalDraftSaving: vi.fn(),
        setLocalDraftError: vi.fn(),
      },
      refs,
      effects,
    })

    expect(effects.schedule).not.toHaveBeenCalled()
    expect(effects.encryptPayload).not.toHaveBeenCalled()
    expect(effects.setDraft).not.toHaveBeenCalled()
  })

  test('falls back to selected version when edit base version is missing', async () => {
    const refs = makeRefs()
    const effects = makeEffects()

    scheduleDraftPersistence({
      state: {
        masterKey: new Uint8Array([1, 2, 3]),
        selected: makeSelected(),
        selectedBaseline: makeBaseline(),
        editBaseVersion: null,
        busy: false,
        dirty: true,
        draftTitle: 'Draft title',
        draftContent: 'Draft body',
        draftTags: 'alpha',
        draftFavorite: false,
        draftAttachments: {},
      },
      setters: {
        setLocalDraftInfo: vi.fn(),
        setLocalDraftSaving: vi.fn(),
        setLocalDraftError: vi.fn(),
      },
      refs,
      effects,
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(effects.setDraft).toHaveBeenCalledWith(
      expect.objectContaining({ base_version: 4 }),
    )
  })

  test('does not clear unrelated scheduled handles when cancelling pending draft persistence', () => {
    const refs = makeRefs()
    refs.localDraftSaveTimerRef.current = 11
    refs.localDraftSaveIdleHandleRef.current = 22
    const effects = makeEffects()

    cancelPendingDraftPersistence({ refs, effects })

    expect(effects.clearScheduled).toHaveBeenCalledTimes(1)
    expect(effects.cancelIdle).toHaveBeenCalledTimes(1)
  })

  test('ignores stale save runs when a newer run supersedes them', async () => {
    const refs = makeRefs()
    const queued: Array<() => void> = []
    const effects = makeEffects({
      schedule: vi.fn((callback: () => void) => {
        queued.push(callback)
        return queued.length
      }),
      scheduleIdle: vi.fn((callback: () => void) => {
        callback()
        return 99
      }),
    })
    const setLocalDraftInfo = vi.fn()

    scheduleDraftPersistence({
      state: {
        masterKey: new Uint8Array([1]),
        selected: makeSelected(),
        selectedBaseline: makeBaseline(),
        editBaseVersion: 4,
        busy: false,
        dirty: true,
        draftTitle: 'First',
        draftContent: 'First body',
        draftTags: 'alpha',
        draftFavorite: false,
        draftAttachments: {},
      },
      setters: {
        setLocalDraftInfo,
        setLocalDraftSaving: vi.fn(),
        setLocalDraftError: vi.fn(),
      },
      refs,
      effects,
    })

    scheduleDraftPersistence({
      state: {
        masterKey: new Uint8Array([1]),
        selected: makeSelected(),
        selectedBaseline: makeBaseline(),
        editBaseVersion: 5,
        busy: false,
        dirty: true,
        draftTitle: 'Second',
        draftContent: 'Second body',
        draftTags: 'beta',
        draftFavorite: true,
        draftAttachments: {},
      },
      setters: {
        setLocalDraftInfo,
        setLocalDraftSaving: vi.fn(),
        setLocalDraftError: vi.fn(),
      },
      refs,
      effects,
    })

    expect(queued).toHaveLength(2)
    queued[1]?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(effects.setDraft).toHaveBeenCalledTimes(1)
    expect(effects.setDraft).toHaveBeenCalledWith(
      expect.objectContaining({ base_version: 5 }),
    )
    expect(setLocalDraftInfo).toHaveBeenCalledWith({ savedAt: 999, baseVersion: 5 })
  })

  test('formats save failures without crashing the latest run', async () => {
    const refs = makeRefs()
    const effects = makeEffects({
      encryptPayload: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const setLocalDraftError = vi.fn()
    const setLocalDraftSaving = vi.fn()

    scheduleDraftPersistence({
      state: {
        masterKey: new Uint8Array([1]),
        selected: makeSelected(),
        selectedBaseline: makeBaseline(),
        editBaseVersion: 4,
        busy: false,
        dirty: true,
        draftTitle: 'Draft',
        draftContent: 'Body',
        draftTags: 'alpha',
        draftFavorite: false,
        draftAttachments: {},
      },
      setters: {
        setLocalDraftInfo: vi.fn(),
        setLocalDraftSaving,
        setLocalDraftError,
      },
      refs,
      effects,
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(setLocalDraftError).toHaveBeenCalledWith('formatted-error')
    expect(setLocalDraftSaving).toHaveBeenLastCalledWith(false)
  })
})
