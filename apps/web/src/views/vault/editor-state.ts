import type { NotePayload } from '../../lib/crypto'
import type { SyncStatus } from '../../lib/yjs'
import { clampNoteContentForStore } from './lifecycle.shared'

export const SYNC_BUSY_TEXT = '正在同步…'

type SyncVisualPhase = 'syncing' | 'error' | 'dirty' | 'synced'

export type PreparedSelectedSave = {
  content: string
  payload: NotePayload
  payloadForStore: NotePayload
}

function resolveSyncVisualPhase(args: {
  isSyncing: boolean
  busy: boolean
  busyText: string | null
  syncStatus: SyncStatus
  yjsDirty: boolean
  localDraftError: string | null
}): SyncVisualPhase {
  if (args.isSyncing || (args.busy && args.busyText === SYNC_BUSY_TEXT) || args.syncStatus.type === 'syncing') {
    return 'syncing'
  }

  if (args.syncStatus.type === 'error' || args.localDraftError) return 'error'
  if (args.yjsDirty) return 'dirty'
  return 'synced'
}

function buildSyncTitle(args: {
  phase: SyncVisualPhase
  syncStatus: SyncStatus
  localDraftSaving: boolean
  localDraftInfo: { savedAt: number } | null
  selectedUpdatedAt: number | null
}): string {
  if (args.phase === 'syncing') return '同步中…'
  if (args.phase === 'error') return '同步失败，请稍后重试'

  if (args.phase === 'dirty') {
    if (args.localDraftSaving) return '正在保存草稿…'
    if (args.localDraftInfo) return `已自动保存 · ${new Date(args.localDraftInfo.savedAt).toLocaleTimeString()}`
    return '未同步更改'
  }

  if (args.syncStatus.type === 'success') {
    return args.syncStatus.mergedRemote ? '已合并远端更改' : '已同步'
  }

  return args.selectedUpdatedAt ? `已同步 · ${new Date(args.selectedUpdatedAt).toLocaleTimeString()}` : '点击同步'
}

export function buildSyncButtonState(args: {
    isSyncing: boolean
    busy: boolean
    busyText: string | null
    syncStatus: SyncStatus
  yjsDirty: boolean
  localDraftSaving: boolean
  localDraftInfo: { savedAt: number } | null
  selectedUpdatedAt: number | null
  localDraftError: string | null
}) {
  const phase = resolveSyncVisualPhase(args)
  const title = buildSyncTitle({
    phase,
    syncStatus: args.syncStatus,
    localDraftSaving: args.localDraftSaving,
    localDraftInfo: args.localDraftInfo,
    selectedUpdatedAt: args.selectedUpdatedAt,
  })
  const statusDotColor = phase === 'error' ? 'bg-rose-500' : phase === 'dirty' ? 'bg-amber-500' : 'bg-emerald-500'

  return {
    isSyncing: phase === 'syncing',
    title,
    statusDotColor,
  }
}

export function buildDraftPayload(args: {
  draftTitle: string
  createdAt: number
  draftTags: string
  draftFavorite: boolean
  content: string
  draftAttachments: Record<string, string>
}): NotePayload {
  return {
    meta: {
      title: args.draftTitle.trim() || '未命名',
      created_at: args.createdAt,
      tags: args.draftTags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      is_favorite: args.draftFavorite,
    },
    content: args.content,
    attachments: args.draftAttachments,
  }
}

export function buildPayloadForStore(payload: NotePayload): NotePayload {
  return {
    ...payload,
    content: clampNoteContentForStore(payload.content),
    attachments: {},
  }
}

export function syncBlockNoteMarkdown(args: {
  markdown: string | undefined
  currentContent: string
  updateDraftContent: (content: string) => void
}): string {
  if (typeof args.markdown === 'string' && args.markdown !== args.currentContent) {
    args.updateDraftContent(args.markdown)
    return args.markdown
  }

  return args.currentContent
}

export function prepareSelectedSave(args: {
  markdown: string | undefined
  currentContent: string
  updateDraftContent: (content: string) => void
  draftTitle: string
  createdAt: number
  draftTags: string
  draftFavorite: boolean
  draftAttachments: Record<string, string>
}): PreparedSelectedSave {
  const content = syncBlockNoteMarkdown({
    markdown: args.markdown,
    currentContent: args.currentContent,
    updateDraftContent: args.updateDraftContent,
  })
  const payload = buildDraftPayload({
    draftTitle: args.draftTitle,
    createdAt: args.createdAt,
    draftTags: args.draftTags,
    draftFavorite: args.draftFavorite,
    content,
    draftAttachments: args.draftAttachments,
  })

  return {
    content,
    payload,
    payloadForStore: buildPayloadForStore(payload),
  }
}
