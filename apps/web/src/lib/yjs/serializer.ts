import * as Y from 'yjs'

/**
 * 将字节数组转换为 base64 字符串
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * 将 base64 字符串转换为字节数组
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * 比较两个字节数组是否相等
 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * 将 Y.Doc 编码为 base64 字符串
 */
export function encodeYDoc(doc: Y.Doc): string {
  const update = Y.encodeStateAsUpdate(doc)
  return bytesToBase64(update)
}

/**
 * 从 base64 字符串解码为 Y.Doc
 */
export function decodeYDoc(base64: string): Y.Doc {
  const update = base64ToBytes(base64)
  const doc = new Y.Doc()
  Y.applyUpdate(doc, update)
  return doc
}

/**
 * 合并两个 Y.Doc，将 remoteDoc 的更新应用到 localDoc
 */
export function mergeYDocs(localDoc: Y.Doc, remoteDoc: Y.Doc): void {
  const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc)
  Y.applyUpdate(localDoc, remoteUpdate)
}

/**
 * 比较两个 Y.Doc 是否等价
 */
export function areYDocsEqual(doc1: Y.Doc, doc2: Y.Doc): boolean {
  const state1 = Y.encodeStateAsUpdate(doc1)
  const state2 = Y.encodeStateAsUpdate(doc2)
  return bytesEqual(state1, state2)
}
