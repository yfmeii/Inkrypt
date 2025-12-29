/**
 * Yjs CRDT 迁移逻辑
 * 
 * 负责检测笔记格式并将旧格式迁移到 Yjs CRDT 格式
 */

import * as Y from 'yjs'
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core'
import type { NotePayload } from '../crypto'
import { YjsBlockNoteBinding } from './blockNoteBinding'
import { encodeYDoc } from './serializer'
import { markdownToBlocks } from '../blocknote/converter'

/**
 * 笔记格式类型
 */
export type NoteFormat = 'legacy' | 'yjs'

/**
 * 扩展的 NotePayload 类型，包含 Yjs 字段
 */
export interface YjsNotePayload extends NotePayload {
  format?: 'blocknote+yjs-v1'
  yjsSnapshotB64?: string
  syncNonce?: string
  meta: NotePayload['meta'] & {
    updatedAtClient?: number
    updatedBy?: string
  }
}

/**
 * 迁移结果
 */
export interface MigrationResult {
  doc: Y.Doc
  snapshot: string
  blocks: PartialBlock[]
}

/**
 * 检测笔记格式
 * 
 * @param payload - 笔记数据
 * @returns 'yjs' 如果是新格式，'legacy' 如果是旧格式
 */
export function detectNoteFormat(payload: NotePayload | YjsNotePayload): NoteFormat {
  const yjsPayload = payload as YjsNotePayload
  
  // 检查是否有 Yjs 格式标识和快照数据
  if (yjsPayload.format === 'blocknote+yjs-v1' && yjsPayload.yjsSnapshotB64) {
    return 'yjs'
  }
  
  return 'legacy'
}

/**
 * 将旧格式笔记迁移到 Yjs CRDT 格式
 * 
 * @param payload - 旧格式的笔记数据
 * @param editor - BlockNote 编辑器实例
 * @returns 迁移结果，包含 Y.Doc、快照和 blocks
 */
export async function migrateToYjs(
  payload: NotePayload,
  editor: BlockNoteEditor
): Promise<MigrationResult> {
  // 创建新的 Y.Doc
  const doc = new Y.Doc()
  
  // 解析旧内容为 blocks
  const blocks = await markdownToBlocks(editor, payload.content)
  
  // 创建绑定层并初始化 Y.Doc
  const binding = new YjsBlockNoteBinding(doc, editor)
  binding.initializeFromBlocks(blocks)
  
  // 编码为快照
  const snapshot = encodeYDoc(doc)
  
  return {
    doc,
    snapshot,
    blocks
  }
}
