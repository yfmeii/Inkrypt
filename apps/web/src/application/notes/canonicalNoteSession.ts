import type * as Y from 'yjs'
import type { DecryptedNote } from '../../state/store'

export type CanonicalNoteDraft = {
  title: string
  tags: string[]
  is_favorite: boolean
  attachments: Record<string, string>
  content: string
  createdAt: number
}

export type CanonicalNoteSaveContext = {
  noteId: string
  baseVersion: number
  draft: CanonicalNoteDraft
  document: Y.Doc
}

export class CanonicalNoteSession {
  private note: DecryptedNote | null = null
  private draft: CanonicalNoteDraft | null = null
  private document: Y.Doc | null = null
  private remoteVersion: number | null = null

  activate(note: DecryptedNote | null): void {
    const previousNoteId = this.note?.id ?? null
    const nextNoteId = note?.id ?? null

    if (previousNoteId !== nextNoteId) {
      this.draft = null
      this.document = null
      this.remoteVersion = null
    }

    this.note = note
  }

  updateDraft(noteId: string, draft: CanonicalNoteDraft): boolean {
    if (this.note?.id !== noteId) return false
    this.draft = draft
    return true
  }

  attachDocument(noteId: string, document: Y.Doc | null): boolean {
    if (this.note?.id !== noteId) return false
    this.document = document
    return true
  }

  recordRemoteVersion(noteId: string, version: number): boolean {
    if (this.note?.id !== noteId) return false
    this.remoteVersion = version
    return true
  }

  getActiveNote(): DecryptedNote | null {
    return this.note
  }

  getSaveContext(noteId: string): CanonicalNoteSaveContext | null {
    if (this.note?.id !== noteId || !this.draft || !this.document) return null

    return {
      noteId,
      baseVersion: this.remoteVersion ?? this.note.version,
      draft: this.draft,
      document: this.document,
    }
  }
}
