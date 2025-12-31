/**
 * 搜索相关工具函数
 */

/** CJK 字符分词正则 */
const CJK_SEGMENT_RE: RegExp = (() => {
  try {
    return new RegExp('[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]+', 'gu')
  } catch {
    // Fallback for older JS engines: Han + Kana + Hangul blocks (not exhaustive).
    return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g
  }
})()

/** 单词分词正则 */
const WORD_SEGMENT_RE: RegExp = (() => {
  try {
    return new RegExp('[\\p{L}\\p{N}]+', 'gu')
  } catch {
    return /[A-Za-z0-9]+/g
  }
})()

/** 正则表达式特殊字符转义 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 标准化搜索文本（NFKC 正规化 + 小写） */
export function normalizeSearchText(input: string): string {
  const raw = (input ?? '').toString()
  if (typeof (raw as any).normalize === 'function') return raw.normalize('NFKC').toLowerCase()
  return raw.toLowerCase()
}

/** 将文本编码为搜索索引的 token 数组 */
export function encodeSearchText(input: string): string[] {
  const s = normalizeSearchText(input)
  const out: string[] = []

  const cjkSegments = s.match(CJK_SEGMENT_RE) ?? []
  for (const seg of cjkSegments) {
    for (const ch of seg) out.push(ch)
    for (let i = 0; i + 1 < seg.length; i++) out.push(seg.slice(i, i + 2))
  }

  const nonCjk = s.replace(CJK_SEGMENT_RE, ' ')
  const words = nonCjk.match(WORD_SEGMENT_RE)
  if (words) out.push(...words)

  return out
}

const JSON_PREFIX = '<!--blocknote-json-->\n'

/**
 * 从内容中提取纯文本（支持 JSON 和 Markdown 格式）
 */
export function extractPlainText(content: string): string {
  if (!content) return ''
  
  // 检测是否为 BlockNote JSON 格式（带前缀）
  if (content.startsWith(JSON_PREFIX)) {
    try {
      const jsonStr = content.slice(JSON_PREFIX.length)
      const blocks = JSON.parse(jsonStr) as any[]
      return extractTextFromBlocks(blocks)
    } catch {
      // JSON 解析失败，使用正则提取 text 字段内容
      return extractTextFieldsFromJSON(content)
    }
  }
  
  // 检测是否为纯 JSON 数组格式（旧数据或无前缀的情况）
  const trimmed = content.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const blocks = JSON.parse(trimmed) as any[]
      if (Array.isArray(blocks) && blocks.length > 0 && typeof blocks[0] === 'object' && blocks[0].type) {
        return extractTextFromBlocks(blocks)
      }
    } catch {
      // JSON 解析失败，如果内容包含 blur 则返回空（避免泄露模糊内容）
      if (content.includes('"blur"')) return ''
    }
  }
  
  // 检测是否为其他 JSON 格式（包含 "text": 字段的内容）
  if (content.includes('"text"') && content.includes('"type"')) {
    const extracted = extractTextFieldsFromJSON(content)
    if (extracted) return extracted
  }
  
  // Markdown 格式，简单清理
  return content
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/^>\s*/gm, '')
    .replace(/^[-*+]\s*/gm, '')
    .replace(/^\d+\.\s*/gm, '')
}

/** 从 JSON 字符串中提取所有 text 字段的值（排除 blur 样式的内容） */
function extractTextFieldsFromJSON(content: string): string {
  const textMatches: string[] = []
  const regex = /"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g
  let match
  while ((match = regex.exec(content)) !== null) {
    if (!match[1]) continue
    
    // 检查当前 text 所在的对象是否带有 blur 样式
    // 向前查找最近的 { 来获取对象上下文
    const ctxStart = content.lastIndexOf('{', regex.lastIndex - match[0].length)
    const ctx = ctxStart >= 0 ? content.slice(ctxStart, regex.lastIndex) : ''
    // 如果上下文中包含 "blur": 样式（注意冒号），跳过这个文本
    // blur 的值可能是 true 或 UUID 字符串
    if (/"blur"\s*:/.test(ctx)) continue
    
    try {
      const decoded = JSON.parse(`"${match[1]}"`)
      textMatches.push(decoded)
    } catch {
      textMatches.push(match[1])
    }
  }
  return textMatches.join(' ')
}

/** 从 BlockNote blocks 中提取纯文本 */
function extractTextFromBlocks(blocks: any[]): string {
  const lines: string[] = []
  for (const block of blocks) {
    const text = extractTextFromBlock(block)
    if (text) lines.push(text)
  }
  return lines.join('\n')
}

/** 从单个 block 中提取文本（排除 blur 样式的内容） */
function extractTextFromBlock(block: any): string {
  if (!block) return ''
  
  let text = ''
  if (Array.isArray(block.content)) {
    text = block.content
      .map((item: any) => {
        if (typeof item === 'string') return item
        if (item.type === 'text') {
          // 排除带有 blur 样式的文本
          if (item.styles?.blur) return ''
          return item.text || ''
        }
        if (item.type === 'link') {
          return item.content
            ?.map((c: any) => {
              // 排除带有 blur 样式的文本
              if (c.styles?.blur) return ''
              return c.text || ''
            })
            .join('') || ''
        }
        return ''
      })
      .join('')
  }
  
  if (Array.isArray(block.children) && block.children.length > 0) {
    const childText = extractTextFromBlocks(block.children)
    if (childText) text = text ? `${text}\n${childText}` : childText
  }
  
  return text
}

/** 获取搜索预览行（匹配位置前后的上下文） */
export function pickSearchPreviewLine(content: string, query: string): string | null {
  if (!content) return null
  if (!query) return null

  const plainText = extractPlainText(content)
  
  let re: RegExp
  try {
    re = new RegExp(escapeRegExp(query), 'i')
  } catch {
    return null
  }

  const m = re.exec(plainText)
  if (!m) return null

  const matchIndex = m.index ?? 0
  const contextStart = Math.max(0, matchIndex - 30)
  const contextEnd = Math.min(plainText.length, matchIndex + m[0].length + 60)
  
  let preview = plainText.slice(contextStart, contextEnd).replace(/\r?\n/g, ' ').trim()
  
  if (contextStart > 0) preview = '…' + preview
  if (contextEnd < plainText.length) preview = preview + '…'
  
  if (!preview) return null
  if (preview.length > 120) return `${preview.slice(0, 120)}…`
  return preview
}

/** 获取内容的第一个非空行 */
export function firstNonEmptyLine(content: string): string | null {
  if (!content) return null
  
  const plainText = extractPlainText(content)
  
  for (const line of plainText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed
  }
  return null
}
