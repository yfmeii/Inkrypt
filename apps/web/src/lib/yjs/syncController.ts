import * as Y from 'yjs'
import { encodeYDoc, decodeYDoc, mergeYDocs } from './serializer'
import { YjsDocManager } from './docManager'
import { randomBytes, bytesToHex } from '../crypto'

export type SyncStatus = 
  | { type: 'idle' }
  | { type: 'syncing' }
  | { type: 'success'; mergedRemote: boolean }
  | { type: 'error'; message: string; canRetry: boolean }

export interface SyncResult {
  success: boolean
  mergedRemote: boolean
  error?: string
}

export interface NotePayloadWithYjs {
  meta: {
    title: string
    created_at: number
    tags: string[]
    is_favorite: boolean
    updatedAtClient?: number
    updatedBy?: string
  }
  content: string
  attachments?: Record<string, string>
  format?: 'blocknote+yjs-v1'
  yjsSnapshotB64?: string
  syncNonce?: string
}

const MAX_RETRIES = 3

/**
 * 生成同步随机数
 */
function generateNonce(): string {
  return bytesToHex(randomBytes(16))
}

/**
 * 获取设备ID（从 localStorage 或生成新的）
 */
function getDeviceId(): string {
  const key = 'inkrypt_device_id'
  let deviceId = localStorage.getItem(key)
  if (!deviceId) {
    deviceId = bytesToHex(randomBytes(16))
    localStorage.setItem(key, deviceId)
  }
  return deviceId
}

/**
 * 同步控制器 - 执行 GET → 合并 → PUT → 校验重试 流程
 */
export class SyncController {
  private status: SyncStatus = { type: 'idle' }
  private onStatusChange: ((status: SyncStatus) => void) | null = null

  constructor(
    private docManager: YjsDocManager,
    private api: {
      getNote: (noteId: string) => Promise<NotePayloadWithYjs | null>
      putNote: (noteId: string, payload: NotePayloadWithYjs) => Promise<void>
    }
  ) {}

  /**
   * 执行同步流程
   */
  async sync(noteId: string): Promise<SyncResult> {
    const localDoc = this.docManager.getDoc()
    if (!localDoc) {
      return { success: false, mergedRemote: false, error: '本地文档不存在' }
    }

    this.setStatus({ type: 'syncing' })

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.attemptSync(noteId, localDoc)
        if (result.success) {
          this.setStatus({ type: 'success', mergedRemote: result.mergedRemote })
          return result
        }
        // 验证失败，继续重试
      } catch (error) {
        if (attempt === MAX_RETRIES - 1) {
          const message = error instanceof Error ? error.message : '同步失败'
          this.setStatus({ type: 'error', message, canRetry: true })
          return { success: false, mergedRemote: false, error: message }
        }
      }
    }

    this.setStatus({ 
      type: 'error', 
      message: '同步繁忙，请稍后再试', 
      canRetry: true 
    })
    return { success: false, mergedRemote: false, error: '同步繁忙，请稍后再试' }
  }

  private async attemptSync(noteId: string, localDoc: Y.Doc): Promise<SyncResult> {
    // Step 1: GET remote
    const remote = await this.api.getNote(noteId)
    
    let mergedRemote = false
    
    // Step 2: Decode & Merge
    if (remote?.yjsSnapshotB64) {
      const remoteDoc = decodeYDoc(remote.yjsSnapshotB64)
      mergeYDocs(localDoc, remoteDoc)
      mergedRemote = true
    }

    // Step 3: Encode merged state
    const mergedSnapshot = encodeYDoc(localDoc)
    const syncNonce = generateNonce()

    // Step 4: PUT to remote
    const payload: NotePayloadWithYjs = {
      ...remote,
      format: 'blocknote+yjs-v1',
      yjsSnapshotB64: mergedSnapshot,
      syncNonce,
      content: remote?.content ?? '', // Ensure content is always a string
      meta: {
        ...remote?.meta,
        title: remote?.meta?.title ?? '',
        created_at: remote?.meta?.created_at ?? Date.now(),
        tags: remote?.meta?.tags ?? [],
        is_favorite: remote?.meta?.is_favorite ?? false,
        updatedAtClient: Date.now(),
        updatedBy: getDeviceId()
      }
    }
    await this.api.putNote(noteId, payload)

    // Step 5: Verify
    const verified = await this.api.getNote(noteId)
    if (verified?.yjsSnapshotB64 !== mergedSnapshot) {
      // 验证失败，有人同时写入
      return { success: false, mergedRemote }
    }

    // 成功
    this.docManager.markSynced(mergedSnapshot)
    return { success: true, mergedRemote }
  }

  private setStatus(status: SyncStatus): void {
    this.status = status
    this.onStatusChange?.(status)
  }

  getStatus(): SyncStatus {
    return this.status
  }

  onStatus(callback: (status: SyncStatus) => void): void {
    this.onStatusChange = callback
  }
}
