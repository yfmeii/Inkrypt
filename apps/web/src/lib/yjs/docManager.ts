import * as Y from 'yjs'
import { decodeYDoc } from './serializer'

export interface YjsDocState {
  doc: Y.Doc
  noteId: string
  dirty: boolean
  lastSyncedSnapshot: string | null
}

/**
 * 管理单个笔记的 Y.Doc 生命周期
 */
export class YjsDocManager {
  private state: YjsDocState | null = null
  private onChangeCallbacks: Set<() => void> = new Set()
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null

  /**
   * 初始化或加载笔记的 Y.Doc
   */
  async initialize(noteId: string, yjsSnapshotB64?: string): Promise<Y.Doc> {
    // 清理旧的监听器
    if (this.state?.doc && this.updateHandler) {
      this.state.doc.off('update', this.updateHandler)
    }

    const doc = yjsSnapshotB64 
      ? decodeYDoc(yjsSnapshotB64)
      : new Y.Doc()
    
    this.state = {
      doc,
      noteId,
      dirty: false,
      lastSyncedSnapshot: yjsSnapshotB64 ?? null
    }

    // 监听文档变化
    this.updateHandler = () => {
      if (this.state) {
        this.state.dirty = true
        this.notifyChange()
      }
    }
    doc.on('update', this.updateHandler)

    return doc
  }

  /**
   * 获取当前 Y.Doc
   */
  getDoc(): Y.Doc | null {
    return this.state?.doc ?? null
  }

  /**
   * 获取当前状态
   */
  getState(): YjsDocState | null {
    return this.state
  }

  /**
   * 检查是否有未同步的更改
   */
  isDirty(): boolean {
    return this.state?.dirty ?? false
  }

  /**
   * 标记为已同步
   */
  markSynced(snapshot: string): void {
    if (this.state) {
      this.state.dirty = false
      this.state.lastSyncedSnapshot = snapshot
      this.notifyChange()
    }
  }

  /**
   * 订阅状态变化
   */
  onChange(callback: () => void): () => void {
    this.onChangeCallbacks.add(callback)
    return () => this.onChangeCallbacks.delete(callback)
  }

  /**
   * 销毁文档管理器，清理资源
   */
  destroy(): void {
    if (this.state?.doc && this.updateHandler) {
      this.state.doc.off('update', this.updateHandler)
    }
    this.state = null
    this.onChangeCallbacks.clear()
    this.updateHandler = null
  }

  private notifyChange(): void {
    this.onChangeCallbacks.forEach(cb => cb())
  }
}
