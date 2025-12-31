/**
 * BlockNote 内容转换工具
 * 
 * 保存格式：JSON（保留所有格式信息，如对齐方式）
 * 读取格式：兼容 JSON 和 Markdown（向后兼容旧内容）
 */

import type { BlockNoteEditor, Block, PartialBlock } from '@blocknote/core'

/**
 * 内容格式前缀，用于区分 JSON 和 Markdown
 */
export const JSON_PREFIX = '<!--blocknote-json-->\n'

/**
 * 检测内容是否为 BlockNote JSON 格式
 */
export function isBlockNoteJSON(content: string): boolean {
  return content.startsWith(JSON_PREFIX)
}

/**
 * 将内容转换为 BlockNote blocks
 * 自动检测格式：JSON 或 Markdown
 * 
 * @param editor - BlockNote 编辑器实例
 * @param content - 内容字符串（JSON 或 Markdown）
 * @returns BlockNote blocks 数组
 */
export async function markdownToBlocks(
  editor: BlockNoteEditor,
  content: string
): Promise<PartialBlock[]> {
  // 处理空内容
  if (!content || content.trim() === '') {
    return []
  }
  
  try {
    // 检测是否为 JSON 格式
    if (isBlockNoteJSON(content)) {
      const jsonStr = content.slice(JSON_PREFIX.length)
      const blocks = JSON.parse(jsonStr) as PartialBlock[]
      return blocks
    }
    
    // 否则按 Markdown 解析（向后兼容）
    const blocks = await editor.tryParseMarkdownToBlocks(content)
    return blocks
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    throw new Error(`内容解析失败: ${err.message}`)
  }
}

/**
 * 将 BlockNote blocks 转换为存储格式（JSON）
 * 
 * @param blocks - BlockNote blocks 数组
 * @returns 带前缀的 JSON 字符串
 */
export function blocksToMarkdown(blocks: Block[]): string {
  return JSON_PREFIX + JSON.stringify(blocks)
}
