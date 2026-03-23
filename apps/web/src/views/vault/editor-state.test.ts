import { describe, expect, test, vi } from 'vitest'
import { buildDraftPayload, buildPayloadForStore, buildSyncButtonState, prepareSelectedSave, SYNC_BUSY_TEXT, syncBlockNoteMarkdown } from './editor-state'

describe('vault editor state helpers', () => {
  test('builds sync button state for dirty drafts and sync outcomes', () => {
    vi.spyOn(Date.prototype, 'toLocaleTimeString').mockReturnValue('09:30:00')

    expect(
      buildSyncButtonState({
        isSyncing: false,
        busy: false,
        busyText: null,
        syncStatus: { type: 'idle' },
        yjsDirty: true,
        localDraftSaving: false,
        localDraftInfo: { savedAt: 123 },
        selectedUpdatedAt: 456,
        localDraftError: null,
      }),
    ).toEqual({
      isSyncing: false,
      title: '已自动保存 · 09:30:00',
      statusDotColor: 'bg-amber-500',
    })

    expect(
      buildSyncButtonState({
        isSyncing: false,
        busy: true,
        busyText: SYNC_BUSY_TEXT,
        syncStatus: { type: 'success', mergedRemote: true },
        yjsDirty: false,
        localDraftSaving: false,
        localDraftInfo: null,
        selectedUpdatedAt: null,
        localDraftError: null,
      }),
    ).toEqual({
      isSyncing: true,
      title: '同步中…',
      statusDotColor: 'bg-emerald-500',
    })

    expect(
      buildSyncButtonState({
        isSyncing: false,
        busy: false,
        busyText: null,
        syncStatus: { type: 'error', message: 'boom', canRetry: true },
        yjsDirty: true,
        localDraftSaving: true,
        localDraftInfo: { savedAt: 123 },
        selectedUpdatedAt: 456,
        localDraftError: null,
      }),
    ).toEqual({
      isSyncing: false,
      title: '同步失败，请稍后重试',
      statusDotColor: 'bg-rose-500',
    })

    expect(
      buildSyncButtonState({
        isSyncing: false,
        busy: false,
        busyText: null,
        syncStatus: { type: 'idle' },
        yjsDirty: true,
        localDraftSaving: true,
        localDraftInfo: null,
        selectedUpdatedAt: null,
        localDraftError: null,
      }),
    ).toEqual({
      isSyncing: false,
      title: '正在保存草稿…',
      statusDotColor: 'bg-amber-500',
    })

    expect(
      buildSyncButtonState({
        isSyncing: false,
        busy: false,
        busyText: null,
        syncStatus: { type: 'success', mergedRemote: false },
        yjsDirty: false,
        localDraftSaving: false,
        localDraftInfo: null,
        selectedUpdatedAt: 456,
        localDraftError: null,
      }),
    ).toEqual({
      isSyncing: false,
      title: '已同步',
      statusDotColor: 'bg-emerald-500',
    })

    expect(
      buildSyncButtonState({
        isSyncing: false,
        busy: false,
        busyText: null,
        syncStatus: { type: 'idle' },
        yjsDirty: false,
        localDraftSaving: false,
        localDraftInfo: null,
        selectedUpdatedAt: 456,
        localDraftError: 'draft failed',
      }),
    ).toEqual({
      isSyncing: false,
      title: '同步失败，请稍后重试',
      statusDotColor: 'bg-rose-500',
    })
  })

  test('builds normalized payloads and store payloads', () => {
    const payload = buildDraftPayload({
      draftTitle: '  ',
      createdAt: 123,
      draftTags: ' alpha, beta ,, gamma ',
      draftFavorite: true,
      content: 'Body',
      draftAttachments: { 'a.txt': 'data:text/plain;base64,QQ==' },
    })

    expect(payload).toEqual({
      meta: {
        title: '未命名',
        created_at: 123,
        tags: ['alpha', 'beta', 'gamma'],
        is_favorite: true,
      },
      content: 'Body',
      attachments: { 'a.txt': 'data:text/plain;base64,QQ==' },
    })

    expect(buildPayloadForStore(payload)).toEqual({
      ...payload,
      content: 'Body',
      attachments: {},
    })
  })

  test('syncs markdown only when the editor content changes', () => {
    const updateDraftContent = vi.fn()

    expect(
      syncBlockNoteMarkdown({
        markdown: 'Updated body',
        currentContent: 'Previous body',
        updateDraftContent,
      }),
    ).toBe('Updated body')
    expect(updateDraftContent).toHaveBeenCalledWith('Updated body')

    updateDraftContent.mockClear()
    expect(
      syncBlockNoteMarkdown({
        markdown: 'Updated body',
        currentContent: 'Updated body',
        updateDraftContent,
      }),
    ).toBe('Updated body')
    expect(updateDraftContent).not.toHaveBeenCalled()
  })

  test('prepares selected saves from editor content and draft fields', () => {
    const updateDraftContent = vi.fn()

    expect(
      prepareSelectedSave({
        markdown: 'Updated body',
        currentContent: 'Previous body',
        updateDraftContent,
        draftTitle: '  Draft title  ',
        createdAt: 123,
        draftTags: ' alpha, beta ',
        draftFavorite: true,
        draftAttachments: { 'a.txt': 'data:text/plain;base64,QQ==' },
      }),
    ).toEqual({
      content: 'Updated body',
      payload: {
        meta: {
          title: 'Draft title',
          created_at: 123,
          tags: ['alpha', 'beta'],
          is_favorite: true,
        },
        content: 'Updated body',
        attachments: { 'a.txt': 'data:text/plain;base64,QQ==' },
      },
      payloadForStore: {
        meta: {
          title: 'Draft title',
          created_at: 123,
          tags: ['alpha', 'beta'],
          is_favorite: true,
        },
        content: 'Updated body',
        attachments: {},
      },
    })

    expect(updateDraftContent).toHaveBeenCalledWith('Updated body')
  })
})
