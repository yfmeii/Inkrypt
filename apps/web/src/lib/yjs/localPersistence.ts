import { type DBSchema, openDB, type IDBPDatabase } from 'idb'
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToBytes,
  bytesToBase64,
  type Bytes,
} from '../crypto'

const DB_NAME = 'inkrypt-yjs'
const DB_VERSION = 1
const STORE_NAME = 'yjs-snapshots'

interface LegacyYjsSnapshot {
  noteId: string
  yjsSnapshotB64: string
  updatedAt: number
}

interface EncryptedYjsSnapshot {
  version: 1
  noteId: string
  encryptedSnapshotB64: string
  ivB64: string
  updatedAt: number
}

type StoredYjsSnapshot = LegacyYjsSnapshot | EncryptedYjsSnapshot

interface YjsDB extends DBSchema {
  'yjs-snapshots': {
    key: string
    value: StoredYjsSnapshot
  }
}

function createSnapshotAad(noteId: string): Bytes {
  return new TextEncoder().encode(`Inkrypt.LocalYjs.v1:${noteId}`) as Bytes
}

function isLegacySnapshot(snapshot: StoredYjsSnapshot): snapshot is LegacyYjsSnapshot {
  return 'yjsSnapshotB64' in snapshot
}

/**
 * IndexedDB 本地持久化层。
 * Yjs CRDT 文档快照始终使用保险库主密钥加密后落盘。
 */
export class LocalPersistence {
  private dbPromise: Promise<IDBPDatabase<YjsDB>>
  private operationQueues = new Map<string, Promise<void>>()

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
   * 加密并保存 Y.Doc 快照到 IndexedDB
   */
  async saveSnapshot(noteId: string, yjsSnapshotB64: string, masterKey: Bytes): Promise<void> {
    await this.enqueue(noteId, async () => {
      await this.writeEncryptedSnapshot(noteId, yjsSnapshotB64, masterKey)
    })
  }

  private async writeEncryptedSnapshot(
    noteId: string,
    yjsSnapshotB64: string,
    masterKey: Bytes,
  ): Promise<void> {
    const plaintext = new TextEncoder().encode(yjsSnapshotB64) as Bytes
    const encrypted = await aesGcmEncrypt(masterKey, plaintext, createSnapshotAad(noteId))
    const db = await this.dbPromise
    await db.put(STORE_NAME, {
      version: 1,
      noteId,
      encryptedSnapshotB64: bytesToBase64(encrypted.ciphertext),
      ivB64: bytesToBase64(encrypted.iv),
      updatedAt: Date.now(),
    })
  }

  /**
   * 从 IndexedDB 解密 Y.Doc 快照，并就地迁移旧明文记录
   */
  async loadSnapshot(noteId: string, masterKey: Bytes): Promise<string | null> {
    await this.waitForPendingOperations(noteId)
    const db = await this.dbPromise
    const record = await db.get(STORE_NAME, noteId)
    if (!record) return null

    if (isLegacySnapshot(record)) {
      await this.writeEncryptedSnapshot(noteId, record.yjsSnapshotB64, masterKey)
      return record.yjsSnapshotB64
    }

    const plaintext = await aesGcmDecrypt(
      masterKey,
      base64ToBytes(record.encryptedSnapshotB64),
      base64ToBytes(record.ivB64),
      createSnapshotAad(noteId),
    )
    return new TextDecoder().decode(plaintext)
  }

  /**
   * 删除快照
   */
  async deleteSnapshot(noteId: string): Promise<void> {
    await this.enqueue(noteId, async () => {
      const db = await this.dbPromise
      await db.delete(STORE_NAME, noteId)
    })
  }

  private async waitForPendingOperations(noteId: string): Promise<void> {
    await this.operationQueues.get(noteId)
  }

  private async enqueue(noteId: string, operation: () => Promise<void>): Promise<void> {
    const previousOperation = this.operationQueues.get(noteId) ?? Promise.resolve()
    const currentOperation = previousOperation
      .catch(() => undefined)
      .then(operation)
    const settledOperation = currentOperation.then(
      () => undefined,
      () => undefined,
    )

    this.operationQueues.set(noteId, settledOperation)

    try {
      await currentOperation
    } finally {
      if (this.operationQueues.get(noteId) === settledOperation) {
        this.operationQueues.delete(noteId)
      }
    }
  }
}
