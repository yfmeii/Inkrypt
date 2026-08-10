/**
 * Yjs 模块统一导出入口
 * 
 * 整合以下模块的导出：
 * - syncController: 同步控制器
 * - docManager: 文档管理器
 * - serializer: 序列化工具
 * - blockNoteBinding: BlockNote 绑定层
 * - localPersistence: 本地持久化
 * - migration: 迁移工具
 */

// SyncController
export { SyncController } from './syncController'
export type { SavedNoteReceipt, SyncStatus, SyncResult, NotePayloadWithYjs } from './syncController'

// DocManager
export { YjsDocManager } from './docManager'
export type { YjsDocState } from './docManager'

// Serializer
export {
  encodeYDoc,
  decodeYDoc,
  mergeYDocs,
  areYDocsEqual,
  hasYDocUpdatesBeyond,
} from './serializer'

// BlockNoteBinding
export { YjsBlockNoteBinding, BLOCKNOTE_YJS_INIT_ORIGIN } from './blockNoteBinding'

// Body initialization state
export { isYjsBodyInitialized, markYjsBodyInitialized } from './bodyState'

// LocalPersistence
export { LocalPersistence } from './localPersistence'

// Migration
export { migrateToYjs, detectNoteFormat } from './migration'
export type { YjsNotePayload, MigrationResult, NoteFormat } from './migration'
