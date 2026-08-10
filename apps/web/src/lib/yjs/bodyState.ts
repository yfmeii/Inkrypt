import * as Y from 'yjs'
import {
  BLOCKNOTE_YJS_BODY_INITIALIZED_KEY,
  BLOCKNOTE_YJS_BODY_STATE_MAP_NAME,
  BLOCKNOTE_YJS_INIT_ORIGIN,
} from './blockNoteBinding'

export function isYjsBodyInitialized(document: Y.Doc): boolean {
  return document
    .getMap(BLOCKNOTE_YJS_BODY_STATE_MAP_NAME)
    .get(BLOCKNOTE_YJS_BODY_INITIALIZED_KEY) === true
}

export function markYjsBodyInitialized(
  document: Y.Doc,
  origin: unknown = BLOCKNOTE_YJS_INIT_ORIGIN,
): void {
  if (isYjsBodyInitialized(document)) return

  document.transact(() => {
    document
      .getMap(BLOCKNOTE_YJS_BODY_STATE_MAP_NAME)
      .set(BLOCKNOTE_YJS_BODY_INITIALIZED_KEY, true)
  }, origin)
}
