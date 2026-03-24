import type React from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { VaultView } from './VaultView'

const { yjsSyncSpy, setDraftContentSpy, note } = vi.hoisted(() => ({
  yjsSyncSpy: vi.fn(async () => ({ success: true, mergedRemote: false })),
  setDraftContentSpy: vi.fn(),
  note: {
    id: 'note-1',
    version: 3,
    updated_at: 100,
    is_deleted: 0,
    payload: {
      meta: {
        title: 'Test note',
        created_at: 123,
        tags: [],
        is_favorite: false,
      },
      content: 'Hello',
      attachments: {},
    },
  },
}))

vi.mock('../state/store', () => {
  const state = {
    masterKey: new Uint8Array(32).fill(1),
    credentialId: 'cred-1',
    setDeviceName: vi.fn(),
    brandName: 'Inkrypt',
    setBrandName: vi.fn(),
    theme: 'default',
    setTheme: vi.fn(),
    mode: 'light',
    setMode: vi.fn(),
    notes: [note],
    selectedNoteId: 'note-1',
    lock: vi.fn(),
    setNotes: vi.fn(),
    upsertNote: vi.fn(),
    removeNote: vi.fn(),
    selectNote: vi.fn(),
  }

  return {
    useInkryptStore: vi.fn((selector: (value: typeof state) => unknown) => selector(state)),
  }
})

vi.mock('../hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => false),
}))

vi.mock('../lib/focusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

vi.mock('../lib/scrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  postJSON: vi.fn(async () => ({})),
}))

vi.mock('../lib/idb', () => ({
  idbDeleteDraftNote: vi.fn(async () => undefined),
  idbUpsertEncryptedNotes: vi.fn(async () => undefined),
}))

vi.mock('../components/AttachmentsPanel', () => ({
  AttachmentsPanel: () => null,
}))

vi.mock('../components/Toast', () => ({
  Toast: () => null,
  ToastStack: () => null,
}))

vi.mock('../components/SettingsPanel', () => ({
  SettingsPanel: () => null,
}))

vi.mock('../components/SearchDialog', () => ({
  SearchDialog: () => null,
}))

vi.mock('../components/DrawingEditor', () => ({
  DrawingEditor: () => null,
}))

vi.mock('./vault/VaultDialogs', () => ({
  VaultDialogs: () => null,
}))

vi.mock('./vault/VaultEditorHeader', () => ({
  VaultEditorHeader: () => null,
}))

vi.mock('./vault/VaultSidebar', () => ({
  VaultSidebar: () => null,
}))

vi.mock('../components/ui/sidebar', () => ({
  SidebarInset: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SidebarProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

vi.mock('./vault/navigation', () => ({
  useVaultNavigation: vi.fn(() => ({
    mobilePane: 'editor',
    navigateToNote: vi.fn(),
    navigateToList: vi.fn(),
  })),
}))

vi.mock('./vault/pairing', () => ({
  useVaultPairing: vi.fn(() => ({
    pairing: null,
    setPairing: vi.fn(),
    pairingBusy: false,
    pairingError: null,
    setPairingError: vi.fn(),
    startPairing: vi.fn(),
    cancelPairing: vi.fn(),
    confirmPairing: vi.fn(),
  })),
}))

vi.mock('./vault/attachments', () => ({
  useVaultAttachments: vi.fn(() => ({
    showAttachments: false,
    setShowAttachments: vi.fn(),
    attachmentsBusy: false,
    attachmentsProgress: null,
    confirmRemoveAttachment: null,
    setConfirmRemoveAttachment: vi.fn(),
    confirmCleanupUnusedAttachments: null,
    setConfirmCleanupUnusedAttachments: vi.fn(),
    attachmentRefs: { current: {} },
    resetAttachmentUi: vi.fn(),
    addAttachments: vi.fn(),
    actuallyRemoveAttachment: vi.fn(),
    removeAttachment: vi.fn(),
    downloadAttachment: vi.fn(),
    handleBlockNoteAddAttachment: vi.fn(),
    handleBlockNoteFiles: vi.fn(),
  })),
}))

vi.mock('../hooks/useYjsSync', () => ({
  useYjsSync: vi.fn(() => ({
    doc: {},
    sync: yjsSyncSpy,
    isSyncing: false,
    dirty: false,
    lastSyncStatus: { type: 'idle' },
    saveToLocal: vi.fn(),
    loadFromLocal: vi.fn(),
  })),
}))

vi.mock('./vault/search', () => ({
  SEARCH_PAGE_SIZE: 20,
  buildSearchDialogResults: vi.fn(() => []),
  createSearchQueryState: vi.fn((value: string) => value),
  useVaultSearchIndex: vi.fn(() => ({
    indexBuild: null,
    indexError: null,
    clearIndexError: vi.fn(),
    resetSearchState: vi.fn(),
    rememberNoteSearchText: vi.fn(),
    forgetNoteSearchText: vi.fn(),
    searchIndex: null,
    searchIndexTick: 0,
  })),
  useVaultSearchResults: vi.fn(() => ({
    fallbackSearchBusy: false,
    searchHasMore: false,
    visibleNotes: [note],
  })),
}))

vi.mock('./vault/lifecycle', () => ({
  createNotePersistence: vi.fn(),
  createVaultSyncApi: vi.fn(() => ({ getNote: vi.fn(), putNote: vi.fn() })),
  deleteNotePersistence: vi.fn(),
  loadNotesFromIdb: vi.fn(async () => undefined),
  migrateLegacyNotesInBackground: vi.fn(async () => undefined),
  syncNotesFromRemote: vi.fn(async () => undefined),
}))

vi.mock('./vault/drafts', () => ({
  applySelectedBaselineState: vi.fn(),
  applySelectedDraftOverlay: vi.fn(),
  loadSelectedDraftSnapshot: vi.fn(async () => null),
  resetSelectedDraftState: vi.fn(),
  seedSelectedDraftState: vi.fn(),
  useSelectedDraftController: vi.fn(() => ({
    selectedBaseline: note.payload,
    setSelectedBaseline: vi.fn(),
    editBaseVersion: note.version,
    setEditBaseVersion: vi.fn(),
    draftTitle: note.payload.meta.title,
    setDraftTitle: vi.fn(),
    draftContent: note.payload.content,
    setDraftContent: setDraftContentSpy,
    draftTags: '',
    setDraftTags: vi.fn(),
    draftFavorite: false,
    setDraftFavorite: vi.fn(),
    draftAttachments: {},
    setDraftAttachments: vi.fn(),
    blockNoteKey: 0,
    setBlockNoteKey: vi.fn(),
    draftContentRef: { current: note.payload.content },
    draftStateRef: {
      current: {
        title: note.payload.meta.title,
        tags: [],
        is_favorite: false,
        attachments: {},
        content: note.payload.content,
        createdAt: note.payload.meta.created_at,
      },
    },
    dirty: false,
    stateSetters: {
      setSelectedBaseline: vi.fn(),
      setEditBaseVersion: vi.fn(),
      setDraftTitle: vi.fn(),
      setDraftContent: setDraftContentSpy,
      setDraftTags: vi.fn(),
      setDraftFavorite: vi.fn(),
      setDraftAttachments: vi.fn(),
      setLocalDraftInfo: vi.fn(),
      setLocalDraftError: vi.fn(),
      setBlockNoteKey: vi.fn(),
    },
  })),
  useLocalDraftPersistence: vi.fn(() => ({
    cancelPendingSave: vi.fn(),
  })),
}))

vi.mock('../components/BlockNote', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    BlockNoteComponent: React.forwardRef(function MockBlockNote(
      { onYjsDocChange }: { onYjsDocChange?: (event: { suppressDraftUpdate: boolean }) => void },
      _ref,
    ) {
      if (onYjsDocChange) {
        Promise.resolve().then(() => onYjsDocChange({ suppressDraftUpdate: true }))
      }
      return <div data-testid="blocknote" />
    }),
  }
})

describe('VaultView autosave regression', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    yjsSyncSpy.mockClear()
    setDraftContentSpy.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('does not trigger silent autosave for initialization-only Yjs normalization', async () => {
    render(<VaultView />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      vi.advanceTimersByTime(1500)
      await Promise.resolve()
    })

    expect(setDraftContentSpy).not.toHaveBeenCalled()
    expect(yjsSyncSpy).not.toHaveBeenCalled()
  })
})
