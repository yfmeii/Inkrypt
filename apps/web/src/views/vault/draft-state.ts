import type { NotePayload } from '../../lib/crypto'

export type DraftSyncState = {
  title: string
  tags: string[]
  is_favorite: boolean
  attachments: Record<string, string>
  content: string
  createdAt: number
}

export function normalizeDraftTags(tags: string): string {
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(', ')
}

export function parseDraftTags(tags: string): string[] {
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export function buildDraftSyncState(args: {
  draftTitle: string
  draftTags: string
  draftFavorite: boolean
  draftAttachments: Record<string, string>
  draftContent: string
  createdAt: number
}): DraftSyncState {
  return {
    title: args.draftTitle.trim() || '未命名',
    tags: parseDraftTags(args.draftTags),
    is_favorite: args.draftFavorite,
    attachments: args.draftAttachments,
    content: args.draftContent,
    createdAt: args.createdAt,
  }
}

export function isDraftDirty(args: {
  selectedBaseline: NotePayload | null
  draftTitle: string
  draftContent: string
  draftFavorite: boolean
  draftTags: string
  draftAttachments: Record<string, string>
}): boolean {
  const { selectedBaseline, draftTitle, draftContent, draftFavorite, draftTags, draftAttachments } = args
  if (!selectedBaseline) return false

  const canonicalAttachments = (value: Record<string, string>) =>
    JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))

  return (
    draftTitle !== selectedBaseline.meta.title ||
    draftContent !== selectedBaseline.content ||
    draftFavorite !== selectedBaseline.meta.is_favorite ||
    normalizeDraftTags(draftTags) !== selectedBaseline.meta.tags.join(', ') ||
    canonicalAttachments(draftAttachments) !== canonicalAttachments(selectedBaseline.attachments ?? {})
  )
}
