import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError, getJSON, postJSON } from '../../lib/api'
import { decryptNotePayload, encryptNotePayload } from '../../lib/crypto'
import { createVaultSyncApi } from './lifecycle.sync-api'

function expectByteArray(value: unknown): void {
  expect(ArrayBuffer.isView(value)).toBe(true)
}

vi.mock('../../lib/api', () => ({
  ApiError: class MockApiError extends Error {
    status: number
    payload: unknown

    constructor(message: string, status: number, payload: unknown) {
      super(message)
      this.status = status
      this.payload = payload
    }
  },
  getJSON: vi.fn(),
  postJSON: vi.fn(),
}))

vi.mock('../../lib/crypto', async () => {
  const actual = await vi.importActual<typeof import('../../lib/crypto')>('../../lib/crypto')
  return {
    ...actual,
    decryptNotePayload: vi.fn(),
    encryptNotePayload: vi.fn(),
  }
})

const mockedGetJSON = vi.mocked(getJSON)
const mockedPostJSON = vi.mocked(postJSON)
const mockedDecryptNotePayload = vi.mocked(decryptNotePayload)
const mockedEncryptNotePayload = vi.mocked(encryptNotePayload)

function makeSyncApi() {
  const masterKey = new Uint8Array(32).fill(7)
  const draftStateRef = {
    current: {
      title: 'Draft title',
      tags: ['alpha', 'beta'],
      is_favorite: true,
      attachments: { 'a.txt': 'data:text/plain;base64,QQ==' },
      content: 'Draft body',
      createdAt: 123,
    },
  }
  const selectedRef = {
    current: {
      id: 'note-1',
      version: 9,
      updated_at: 100,
      is_deleted: 0 as const,
      payload: {
        meta: {
          title: 'Selected title',
          created_at: 123,
          tags: ['selected'],
          is_favorite: false,
        },
        content: 'Selected body',
        attachments: {},
      },
    },
  }
  const syncRemoteVersionRef = { current: 0 }
  const syncSavedRef = { current: null as null | { version: number; updated_at: number } }

  return {
    api: createVaultSyncApi({
      masterKey,
      draftStateRef,
      selectedRef,
      syncRemoteVersionRef,
      syncSavedRef,
    }),
    refs: { draftStateRef, selectedRef, syncRemoteVersionRef, syncSavedRef },
  }
}

describe('vault sync api helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('loads a remote note and tracks the remote version', async () => {
    const { api, refs } = makeSyncApi()
    const remotePayload = {
      meta: {
        title: 'Remote title',
        created_at: 123,
        tags: ['remote'],
        is_favorite: false,
      },
      content: 'Remote body',
      attachments: {},
      format: 'blocknote+yjs-v1' as const,
      yjsSnapshotB64: 'snapshot',
    }
    mockedGetJSON.mockResolvedValueOnce({
      notes: [
        {
          id: 'note-1',
          version: 12,
          updated_at: 555,
          is_deleted: 0,
          encrypted_data: 'cipher',
          data_iv: 'iv-1',
        },
      ],
    })
    mockedDecryptNotePayload.mockResolvedValueOnce(remotePayload)

    await expect(api.getNote('note-1')).resolves.toEqual(remotePayload)

    expect(mockedGetJSON).toHaveBeenCalledWith('/api/notes?since=0')
    expect(mockedDecryptNotePayload).toHaveBeenCalledTimes(1)
    expectByteArray(mockedDecryptNotePayload.mock.calls[0]?.[0])
    expect(mockedDecryptNotePayload.mock.calls[0]?.[1]).toBe('cipher')
    expect(mockedDecryptNotePayload.mock.calls[0]?.[2]).toBe('iv-1')
    expectByteArray(mockedDecryptNotePayload.mock.calls[0]?.[3])
    expect(refs.syncRemoteVersionRef.current).toBe(12)
  })

  test('returns null and resets remote version when the note is missing', async () => {
    const { api, refs } = makeSyncApi()
    refs.syncRemoteVersionRef.current = 8
    mockedGetJSON.mockResolvedValueOnce({ notes: [] })

    await expect(api.getNote('note-1')).resolves.toBeNull()

    expect(refs.syncRemoteVersionRef.current).toBe(0)
    expect(mockedDecryptNotePayload).not.toHaveBeenCalled()
  })

  test('puts merged draft content and stores saved metadata', async () => {
    const { api, refs } = makeSyncApi()
    mockedEncryptNotePayload.mockResolvedValueOnce({ encrypted_data: 'cipher', iv: 'iv-2' })
    mockedPostJSON.mockResolvedValueOnce({
      saved: [{ id: 'note-1', version: 13, updated_at: 777 }],
      conflicts: [],
    })

    await api.putNote('note-1', {
      meta: {
        title: 'Remote title',
        created_at: 1,
        tags: ['remote'],
        is_favorite: false,
      },
      content: 'Remote body',
      attachments: {},
      format: 'blocknote+yjs-v1',
      yjsSnapshotB64: 'snapshot',
    })

    expect(mockedEncryptNotePayload).toHaveBeenCalledTimes(1)
    expectByteArray(mockedEncryptNotePayload.mock.calls[0]?.[0])
    expect(mockedEncryptNotePayload.mock.calls[0]?.[1]).toEqual({
      meta: {
        title: 'Draft title',
        created_at: 123,
        tags: ['alpha', 'beta'],
        is_favorite: true,
      },
      content: 'Draft body',
      attachments: { 'a.txt': 'data:text/plain;base64,QQ==' },
      format: 'blocknote+yjs-v1',
      yjsSnapshotB64: 'snapshot',
    })
    expectByteArray(mockedEncryptNotePayload.mock.calls[0]?.[2])
    expect(mockedPostJSON).toHaveBeenCalledWith('/api/notes', [
      {
        id: 'note-1',
        encrypted_data: 'cipher',
        iv: 'iv-2',
        base_version: 9,
        is_deleted: false,
      },
    ])
    expect(refs.syncSavedRef.current).toEqual({ id: 'note-1', version: 13, updated_at: 777 })
  })

  test('prefers tracked remote version as the sync base', async () => {
    const { api, refs } = makeSyncApi()
    refs.syncRemoteVersionRef.current = 21
    mockedEncryptNotePayload.mockResolvedValueOnce({ encrypted_data: 'cipher', iv: 'iv-2' })
    mockedPostJSON.mockResolvedValueOnce({ saved: [], conflicts: [] })

    await api.putNote('note-1', {
      meta: {
        title: 'Remote title',
        created_at: 1,
        tags: [],
        is_favorite: false,
      },
      content: 'Remote body',
      attachments: {},
    })

    expect(mockedPostJSON).toHaveBeenCalledWith('/api/notes', [
      expect.objectContaining({ base_version: 21 }),
    ])
  })

  test('maps 409 responses and conflict payloads to a sync busy error', async () => {
    const { api } = makeSyncApi()
    mockedEncryptNotePayload.mockResolvedValue({ encrypted_data: 'cipher', iv: 'iv-2' })

    mockedPostJSON.mockRejectedValueOnce(new ApiError('POST failed', 409, { conflicts: ['note-1'] }))
    await expect(
      api.putNote('note-1', {
        meta: { title: 'x', created_at: 1, tags: [], is_favorite: false },
        content: 'body',
        attachments: {},
      }),
    ).rejects.toThrow('同步繁忙，请稍后再试')

    mockedPostJSON.mockResolvedValueOnce({ saved: [], conflicts: ['note-1'] })
    await expect(
      api.putNote('note-1', {
        meta: { title: 'x', created_at: 1, tags: [], is_favorite: false },
        content: 'body',
        attachments: {},
      }),
    ).rejects.toThrow('同步繁忙，请稍后再试')
  })
})
