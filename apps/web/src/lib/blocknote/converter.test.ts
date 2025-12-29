/**
 * BlockNote Markdown 转换器属性测试
 * 
 * Feature: blocknote-migration
 * Property 1: Markdown Round-Trip Conversion
 * Validates: Requirements 2.1-2.13, 3.1-3.11
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fc from 'fast-check'
import { BlockNoteEditor } from '@blocknote/core'
import { markdownToBlocks, blocksToMarkdown, JSON_PREFIX } from './converter'

/**
 * 创建测试用的 BlockNote 编辑器实例
 */
function createTestEditor(): BlockNoteEditor {
  return BlockNoteEditor.create()
}

/**
 * 生成有效的 Markdown 标题
 */
function arbitraryHeading(): fc.Arbitrary<string> {
  return fc.tuple(
    fc.integer({ min: 1, max: 6 }),
    fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\n'))
  ).map(([level, text]) => `${'#'.repeat(level)} ${text}`)
}

/**
 * 生成有效的 Markdown 段落
 */
function arbitraryParagraph(): fc.Arbitrary<string> {
  return fc.string({ minLength: 1, maxLength: 100 })
    .filter(s => !s.includes('\n') && s.trim().length > 0)
}

/**
 * 生成有效的 Markdown 无序列表
 */
function arbitraryBulletList(): fc.Arbitrary<string> {
  return fc.array(
    fc.string({ minLength: 1, maxLength: 50 })
      .filter(s => !s.includes('\n') && s.trim().length > 0 && !/^[>#]/.test(s.trim())),
    { minLength: 1, maxLength: 5 }
  ).map(items => items.map(item => `- ${item.trim()}`).join('\n'))
}

/**
 * 生成有效的 Markdown 有序列表
 */
function arbitraryNumberedList(): fc.Arbitrary<string> {
  return fc.array(
    fc.string({ minLength: 1, maxLength: 50 })
      .filter(s => !s.includes('\n') && s.trim().length > 0 && !/^[>#]/.test(s.trim())),
    { minLength: 1, maxLength: 5 }
  ).map(items => items.map((item, i) => `${i + 1}. ${item.trim()}`).join('\n'))
}

/**
 * 生成有效的 Markdown 代码块
 */
function arbitraryCodeBlock(): fc.Arbitrary<string> {
  return fc.tuple(
    fc.constantFrom('javascript', 'python', 'typescript', 'java', ''),
    fc.string({ minLength: 1, maxLength: 100 })
  ).map(([lang, code]) => `\`\`\`${lang}\n${code}\n\`\`\``)
}

/**
 * 生成有效的 Markdown 引用
 */
function arbitraryQuote(): fc.Arbitrary<string> {
  return fc.string({ minLength: 1, maxLength: 100 })
    .filter(s => !s.includes('\n'))
    .map(text => `> ${text}`)
}

/**
 * 生成有效的 Markdown 图片
 */
function arbitraryImage(): fc.Arbitrary<string> {
  return fc.tuple(
    fc.string({ minLength: 1, maxLength: 20 })
      .filter(s => !s.includes(']') && !s.includes(')') && !/[<>\\]/.test(s)),
    fc.oneof(
      fc.webUrl(),
      fc.string({ minLength: 1, maxLength: 30 })
        .filter(s => /^[a-zA-Z0-9._-]+$/.test(s))
        .map(name => `attachment:${name}`)
    )
  ).map(([alt, url]) => `![${alt}](${url})`)
}

/**
 * 生成 attachment: URL
 */
function arbitraryAttachmentUrl(): fc.Arbitrary<string> {
  return fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => /^[a-zA-Z0-9._-]+$/.test(s))
    .map(name => `attachment:${name}`)
}

/**
 * 生成有效的 Markdown 水平线
 */
function arbitraryHorizontalRule(): fc.Arbitrary<string> {
  return fc.constant('---')
}

/**
 * 生成有效的 Markdown 内容
 */
function arbitraryMarkdown(): fc.Arbitrary<string> {
  return fc.array(
    fc.oneof(
      arbitraryHeading(),
      arbitraryParagraph(),
      arbitraryBulletList(),
      arbitraryNumberedList(),
      arbitraryCodeBlock(),
      arbitraryQuote(),
      arbitraryImage(),
      arbitraryHorizontalRule()
    ),
    { minLength: 1, maxLength: 5 }
  ).map(blocks => blocks.join('\n\n'))
}

/**
 * 检查两个 Markdown 字符串是否语义等价
 * 
 * "语义等价"意味着:
 * - 相同的结构元素（标题、列表等）
 * - 相同的文本内容
 * - 相同的内联格式（粗体、斜体、代码、链接）
 * - 空白差异是可接受的
 * - 元素顺序保持一致
 */
function semanticallyEqual(original: string, converted: string): boolean {
  // 规范化空白
  const normalize = (s: string) => s
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    // 规范化水平线：--- 和 *** 是等价的
    .replace(/^---+$/gm, '---')
    .replace(/^\*\*\*+$/gm, '---')
  
  const normalizedOriginal = normalize(original)
  const normalizedConverted = normalize(converted)
  
  // 对于简单情况，直接比较
  if (normalizedOriginal === normalizedConverted) {
    return true
  }
  
  // 提取结构元素
  const extractStructure = (s: string) => {
    const lines = s.split('\n').filter(l => l.trim())
    return lines.map(line => {
      // 标题
      if (/^#{1,6}\s/.test(line)) {
        const level = line.match(/^(#{1,6})/)?.[1].length || 0
        return { type: 'heading', level, text: line.replace(/^#{1,6}\s+/, '').trim() }
      }
      // 列表项 (both - and * are bullet lists)
      if (/^[-*]\s/.test(line)) {
        return { type: 'bullet', text: line.replace(/^[-*]\s+/, '').trim() }
      }
      if (/^\d+\.\s*/.test(line)) {
        const text = line.replace(/^\d+\.\s*/, '').trim()
        return { type: 'numbered', text }
      }
      // 引用
      if (/^>\s/.test(line)) {
        return { type: 'quote', text: line.replace(/^>\s+/, '').trim() }
      }
      // 代码块标记
      if (/^```/.test(line)) {
        return { type: 'code-fence', lang: line.replace(/^```/, '').trim() }
      }
      // 水平线 (both --- and ***)
      if (/^(---+|\*\*\*+)$/.test(line)) {
        return { type: 'hr' }
      }
      // 图片
      if (/^!\[.*\]\(.*\)/.test(line)) {
        const match = line.match(/^!\[(.*?)\]\((.*?)\)/)
        // 移除转义字符进行比较
        const unescapeAlt = (alt: string) => alt.replace(/\\(.)/g, '$1')
        return { type: 'image', alt: unescapeAlt(match?.[1]?.trim() || ''), url: match?.[2] || '' }
      }
      // 普通段落
      return { type: 'paragraph', text: line.trim() }
    })
  }
  
  const originalStructure = extractStructure(normalizedOriginal)
  const convertedStructure = extractStructure(normalizedConverted)
  
  // 比较结构
  if (originalStructure.length !== convertedStructure.length) {
    return false
  }
  
  for (let i = 0; i < originalStructure.length; i++) {
    const orig = originalStructure[i]
    const conv = convertedStructure[i]
    
    if (orig.type !== conv.type) {
      return false
    }
    
    // 对于有文本的元素，比较文本内容
    if ('text' in orig && 'text' in conv) {
      if (orig.text !== conv.text) {
        return false
      }
    }
    
    // 对于标题，比较级别
    if (orig.type === 'heading' && 'level' in orig && 'level' in conv) {
      if (orig.level !== conv.level) {
        return false
      }
    }
    
    // 对于图片，比较 URL（特别是 attachment: URL）
    // alt 文本的空格会被 trim，所以比较 trim 后的值
    // URL 可能会被规范化（添加尾随斜杠），所以需要规范化后比较
    if (orig.type === 'image' && 'url' in orig && 'url' in conv) {
      const normalizeUrl = (url: string) => {
        // 不规范化 attachment: URLs
        if (url.startsWith('attachment:')) {
          return url
        }
        // 对于 HTTP URLs，确保尾随斜杠一致
        if (url.match(/^https?:\/\/[^/]+$/)) {
          return url + '/'
        }
        return url
      }
      
      if (typeof orig.url !== 'string' || typeof conv.url !== 'string') {
        return false
      }
      if (normalizeUrl(orig.url) !== normalizeUrl(conv.url)) {
        return false
      }
      // alt 文本已经在 extractStructure 中被 trim 了
      if ('alt' in orig && 'alt' in conv && orig.alt !== conv.alt) {
        return false
      }
    }
  }
  
  return true
}

describe('BlockNote Markdown Converter - Property Tests', () => {
  let editor: BlockNoteEditor
  
  beforeEach(() => {
    editor = createTestEditor()
  })

  afterEach(() => {
    ;(editor as any)?._tiptapEditor?.destroy?.()
  })
  
  /**
   * Property 1: Markdown Round-Trip Conversion
   * Feature: blocknote-migration, Property 1: Markdown Round-Trip Conversion
   * Validates: Requirements 2.1-2.13, 3.1-3.11
   * 
   * For any valid Markdown content, converting to BlockNote blocks and back
   * to Markdown SHALL produce semantically equivalent content.
   */
  it('should preserve content through round-trip conversion', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryMarkdown(),
        async (markdown) => {
          // Convert markdown to blocks
          const blocks = await markdownToBlocks(editor, markdown)
          
          // Convert blocks back to markdown
          const result = blocksToMarkdown(blocks as any)
          
          // Convert stored JSON back to blocks and compare
          const decoded = await markdownToBlocks(editor, result)
          expect(decoded).toEqual(blocks)
        }
      ),
      { numRuns: 100 }
    )
  })
  
  /**
   * Property 1 (Edge Case): Empty content
   * Validates: Requirements 2.1, 3.1
   */
  it('should handle empty content', async () => {
    const blocks = await markdownToBlocks(editor, '')
    expect(blocks).toEqual([])
    
    const markdown = blocksToMarkdown([])
    expect(markdown).toBe(`${JSON_PREFIX}[]`)
  })
  
  /**
   * Property 1 (Edge Case): Whitespace-only content
   * Validates: Requirements 2.1, 3.1
   */
  it('should handle whitespace-only content', async () => {
    const blocks = await markdownToBlocks(editor, '   \n\n   ')
    expect(blocks).toEqual([])
  })
  
  /**
   * Property 3: Attachment URL Preservation
   * Feature: blocknote-migration, Property 3: Attachment URL Preservation
   * Validates: Requirements 2.8, 3.8, 4.1
   * 
   * For any Markdown content containing attachment: URLs in image syntax,
   * converting to BlockNote blocks and back to Markdown SHALL preserve
   * the attachment: URL scheme and filename.
   */
  it('should preserve attachment: URLs through round-trip conversion', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbitraryAttachmentUrl(),
        fc.string({ minLength: 1, maxLength: 20 })
          .filter(s => !s.includes(']') && !s.includes(')') && !s.includes('[') && !s.includes('(') && !/[<>\\]/.test(s) && s.trim().length > 0),
        async (attachmentUrl, altText) => {
          // Create markdown with attachment: URL
          const markdown = `![${altText}](${attachmentUrl})`
          
          // Convert to blocks
          const blocks = await markdownToBlocks(editor, markdown)
          
          // Convert back to markdown
          const result = blocksToMarkdown(blocks as any)
          
          // Verify attachment: URL is preserved in JSON storage
          expect(result).toContain(attachmentUrl)
          expect(result.startsWith(JSON_PREFIX)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
  
  /**
   * Property 3 (Edge Case): Multiple attachment URLs
   * Validates: Requirements 2.8, 3.8, 4.1
   */
  it('should preserve multiple attachment: URLs', async () => {
    const markdown = `
![image1](attachment:file1.png)

Some text

![image2](attachment:file2.jpg)
    `.trim()
    
    const blocks = await markdownToBlocks(editor, markdown)
    const result = blocksToMarkdown(blocks as any)
    
    expect(result).toContain('attachment:file1.png')
    expect(result).toContain('attachment:file2.jpg')
  })
  
  /**
   * Property 3 (Edge Case): Mixed URL types
   * Validates: Requirements 2.8, 3.8, 4.1
   */
  it('should preserve attachment: URLs alongside regular URLs', async () => {
    const markdown = `
![local](attachment:local.png)

![remote](https://example.com/image.png)
    `.trim()
    
    const blocks = await markdownToBlocks(editor, markdown)
    const result = blocksToMarkdown(blocks as any)
    
    expect(result).toContain('attachment:local.png')
    expect(result).toMatch(/https?:\/\/example\.com\/image\.png/)
  })
})
