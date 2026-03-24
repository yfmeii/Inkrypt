import { decryptNotePayload, noteAad, type Bytes, type NotePayload } from '../../lib/crypto'
import { idbGetAllEncryptedNotes } from '../../lib/idb'
import type { DecryptedNote } from '../../state/store'
import { toStoredPayload } from './lifecycle.shared'

export async function loadNotesFromIdb(args: {
  masterKey: Bytes | null
  resetSearchState: () => void
  rememberNoteSearchText: (noteId: string, payload: NotePayload) => void
  setNotes: (notes: DecryptedNote[]) => void
}): Promise<void> {
  if (!args.masterKey) return

  args.resetSearchState()
  const encryptedNotes = await idbGetAllEncryptedNotes()
  const decrypted: DecryptedNote[] = []

  for (const note of encryptedNotes) {
    if (note.is_deleted) continue

    try {
      const payload = await decryptNotePayload(args.masterKey, note.encrypted_data, note.data_iv, noteAad(note.id))
      args.rememberNoteSearchText(note.id, payload)
      decrypted.push({ ...note, payload: toStoredPayload(payload) })
    } catch {
      // Keep corrupted ciphertext in IDB for later inspection.
    }
  }

  decrypted.sort((a, b) => b.updated_at - a.updated_at)
  args.setNotes(decrypted)
}
