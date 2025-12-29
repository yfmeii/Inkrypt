import { type DBSchema, openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'inkrypt-yjs'
const DB_VERSION = 1
const STORE_NAME = 'yjs-snapshots'

interface YjsSnapshot {
  noteId: string
  yjsSnapshotB64: string
  updatedAt: number
}

interface YjsDB extends DBSchema {
  'yjs-snapshots': {
    key: string
    value: YjsSnapshot
  }
}

/**
 * IndexedDB 本地持久化层
 * 用于保存和恢复 Yjs CRDT 文档快照
 */
export class LocalPersistence {
  private dbPromise: Promise<IDBPDatabase<YjsDB>>

  constructor() {
    this.dbPromise = openDB<YjsDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'noteId' })
        }
      },
    })
  }

  /**
   * 保存 Y.Doc 快照到 IndexedDB
   */
  async saveSnapshot(noteId: string, yjsSnapshotB64: string): Promise<void> {
    const db = await this.dbPromise
    await db.put(STORE_NAME, {
      noteId,
      yjsSnapshotB64,
      updatedAt: Date.now(),
    })
  }

  /**
   * 从 IndexedDB 加载 Y.Doc 快照
   */
  async loadSnapshot(noteId: string): Promise<string | null> {
    const db = await this.dbPromise
    const record = await db.get(STORE_NAME, noteId)
    return record?.yjsSnapshotB64 ?? null
  }

  /**
   * 删除快照
   */
  async deleteSnapshot(noteId: string): Promise<void> {
    const db = await this.dbPromise
    await db.delete(STORE_NAME, noteId)
  }
}
