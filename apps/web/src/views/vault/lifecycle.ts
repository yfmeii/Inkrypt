export { loadNotesFromIdb } from './lifecycle.local'
export {
  clampNoteContentForStore,
  toStoredPayload,
  type NotesGetResponse,
  type NotesPostResponse,
  type SyncSavedRecord,
} from './lifecycle.shared'
export { migrateLegacyNotesInBackground } from './lifecycle.migration'
export { createNotePersistence, deleteNotePersistence, syncNotesFromRemote } from './lifecycle.remote'
export { createVaultSyncApi } from './lifecycle.sync-api'
