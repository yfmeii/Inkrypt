import { createStore } from 'zustand/vanilla'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getJSON } from '../lib/api'
import {
  clearRememberedUnlockedSession,
  loadRememberedUnlockedSession,
} from '../lib/remember'
import { createApiSessionSlice } from './apiSession'
import { createKeyringSessionSlice } from './keyringSession'
import { createSessionCommandsSlice } from './session'
import type { InkryptState } from './types'

vi.mock('../lib/remember', () => ({
  clearRememberedUnlockedSession: vi.fn(async () => undefined),
  loadRememberedUnlockedSession: vi.fn(async () => null),
  rememberUnlockedSession: vi.fn(async () => undefined),
}))

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    getJSON: vi.fn(),
  }
})

const mockedGetJSON = vi.mocked(getJSON)
const mockedLoadRememberedSession = vi.mocked(loadRememberedUnlockedSession)
const mockedClearRememberedSession = vi.mocked(clearRememberedUnlockedSession)

function createSessionStore() {
  return createStore<InkryptState>()((...args) => ({
    ...createKeyringSessionSlice(...args),
    ...createApiSessionSlice(...args),
    ...createSessionCommandsSlice(...args),
    brandName: 'Inkrypt',
    theme: 'graphite',
    mode: 'system',
    setBrandName: vi.fn(),
    setTheme: vi.fn(),
    setMode: vi.fn(),
    notes: [],
    noteVersionWatermarks: {},
    selectedNoteId: null,
    setNotes: (notes) => args[0]({ notes }),
    upsertNote: vi.fn(),
    removeNote: vi.fn(),
    selectNote: (selectedNoteId) => args[0]({ selectedNoteId }),
  }))
}

const note = {
  id: 'note-1',
  version: 1,
  updated_at: 100,
  is_deleted: 0,
  payload: {
    meta: {
      title: 'Note',
      created_at: 100,
      tags: [],
      is_favorite: false,
    },
    content: 'content',
    attachments: {},
  },
}

describe('split KeyringSession and ApiSession slices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the keyring and local notes when only the API session expires', () => {
    const store = createSessionStore()
    const masterKey = new Uint8Array(32).fill(7)
    store.setState({
      masterKey,
      credentialId: 'credential-1',
      deviceName: 'Mac',
      apiSessionStatus: 'authenticated',
      notes: [note],
      selectedNoteId: note.id,
    })

    store.getState().markApiSessionAnonymous()

    expect(store.getState()).toMatchObject({
      masterKey,
      credentialId: null,
      deviceName: null,
      apiSessionStatus: 'anonymous',
      notes: [note],
      selectedNoteId: note.id,
    })
  })

  it('hydrates only the keyring without inventing an API session', async () => {
    const store = createSessionStore()
    const masterKey = new Uint8Array(32).fill(8)
    mockedLoadRememberedSession.mockResolvedValueOnce({ masterKey })

    await store.getState().hydrateRememberedSession()

    expect(store.getState()).toMatchObject({
      masterKey,
      apiSessionStatus: 'checking',
      credentialId: null,
      deviceName: null,
    })
  })

  it('refreshes API identity without replacing an unlocked keyring', async () => {
    const store = createSessionStore()
    const masterKey = new Uint8Array(32).fill(9)
    store.setState({ masterKey })
    mockedGetJSON.mockResolvedValueOnce({
      authenticated: true,
      vaultId: '11111111-1111-4111-8111-111111111111',
      credentialId: 'credential-1',
      deviceName: 'Mac',
      expiresAt: 500,
    })

    await store.getState().refreshApiSession()

    expect(store.getState()).toMatchObject({
      masterKey,
      apiSessionStatus: 'authenticated',
      apiSessionExpiresAt: 500,
      credentialId: 'credential-1',
      deviceName: 'Mac',
    })
  })

  it('revokes both sessions and clears decrypted note state', async () => {
    const store = createSessionStore()
    store.setState({
      masterKey: new Uint8Array(32).fill(10),
      credentialId: 'credential-1',
      apiSessionStatus: 'authenticated',
      notes: [note],
      selectedNoteId: note.id,
    })
    mockedGetJSON.mockRejectedValueOnce(new ApiError(
      'revoked',
      401,
      { error: 'DEVICE_REVOKED' },
    ))

    await store.getState().refreshApiSession()

    expect(store.getState()).toMatchObject({
      masterKey: null,
      credentialId: null,
      apiSessionStatus: 'revoked',
      notes: [],
      selectedNoteId: null,
    })
    expect(mockedClearRememberedSession).toHaveBeenCalledTimes(1)
  })
})
