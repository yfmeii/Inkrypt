import type { SavedNoteReceipt } from '../../lib/yjs/syncController'

export type SaveResult =
  | {
      status: 'saved'
      receipt: SavedNoteReceipt
      mergedRemote: boolean
    }
  | {
      status: 'skipped'
      reason: 'locked' | 'no-selection' | 'not-ready'
    }
  | {
      status: 'failed'
      error: string
      canRetry: boolean
    }
