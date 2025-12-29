import * as Y from 'yjs'
import type { BlockNoteEditor, Block, PartialBlock } from '@blocknote/core'
import { blocksToYXmlFragment, yXmlFragmentToBlocks } from '@blocknote/core/yjs'

/**
 * BlockNote 与 Y.Doc 的绑定层
 * 使用 BlockNote 官方的 Yjs 工具函数
 */
export class YjsBlockNoteBinding {
  private fragment: Y.XmlFragment
  private readonly fragmentName: string

  constructor(
    private doc: Y.Doc,
    private editor: BlockNoteEditor,
    fragmentName: string = 'document-store'
  ) {
    this.fragmentName = fragmentName
    // BlockNote 使用 'document-store' 作为共享类型名称
    this.fragment = doc.getXmlFragment(fragmentName)
  }

  /**
   * 获取用于 BlockNote collaboration 配置的 fragment
   */
  getFragment(): Y.XmlFragment {
    return this.fragment
  }

  /**
   * 从 BlockNote blocks 初始化 Y.Doc（用于迁移）
   */
  initializeFromBlocks(blocks: PartialBlock[]): void {
    // 创建一个临时 Y.Doc 来生成 XML 结构
    const tempDoc = new Y.Doc()
    // blocksToYXmlFragment 接受 Block[] 类型，但实际上可以处理 PartialBlock[]
    // 使用类型断言来绕过 TypeScript 的严格检查
    const tempFragment = blocksToYXmlFragment(this.editor, blocks as any, tempDoc.getXmlFragment(this.fragmentName))
    
    // 获取临时文档的状态更新
    const update = Y.encodeStateAsUpdate(tempDoc)
    
    // 清空现有内容并应用新状态
    this.doc.transact(() => {
      // 删除所有现有内容
      while (this.fragment.length > 0) {
        this.fragment.delete(0, 1)
      }
    })
    
    // 应用临时文档的更新到目标文档
    Y.applyUpdate(this.doc, update)
  }

  /**
   * 从 Y.Doc 导出 BlockNote blocks（用于调试/导出）
   */
  exportToBlocks(): Block[] {
    return yXmlFragmentToBlocks(this.editor, this.fragment)
  }

  /**
   * 获取 fragment 名称
   */
  getFragmentName(): string {
    return this.fragmentName
  }
}
