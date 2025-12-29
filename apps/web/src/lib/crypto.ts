export type Bytes = Uint8Array<ArrayBuffer>

export function randomBytes(length: number): Bytes {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes as Bytes
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Bytes {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes as Bytes
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlToBytes(base64url: string): Bytes {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) base64 += '='
  return base64ToBytes(base64)
}

export async function gzip(data: Bytes): Promise<Bytes> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持 gzip 压缩（CompressionStream）。请更新或更换浏览器后重试')
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf) as Bytes
}

export async function gunzip(data: Bytes): Promise<Bytes> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持 gzip 解压（DecompressionStream）。请更新或更换浏览器后重试')
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf) as Bytes
}

async function importAesKey(raw: Bytes, usage: KeyUsage[]): Promise<CryptoKey> {
  if (raw.byteLength !== 32) throw new Error('密钥长度错误：需要 32 字节')
  return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, usage)
}

export async function aesGcmEncrypt(
  keyBytes: Bytes,
  plaintext: Bytes,
  additionalData?: Bytes,
): Promise<{ ciphertext: Bytes; iv: Bytes }> {
  const key = await importAesKey(keyBytes, ['encrypt'])
  const iv = randomBytes(12)
  const params: AesGcmParams = additionalData ? { name: 'AES-GCM', iv, additionalData } : { name: 'AES-GCM', iv }
  const ciphertext = await crypto.subtle.encrypt(params, key, plaintext)
  return { ciphertext: new Uint8Array(ciphertext) as Bytes, iv }
}

export async function aesGcmDecrypt(
  keyBytes: Bytes,
  ciphertext: Bytes,
  iv: Bytes,
  additionalData?: Bytes,
): Promise<Bytes> {
  const key = await importAesKey(keyBytes, ['decrypt'])
  const params: AesGcmParams = additionalData ? { name: 'AES-GCM', iv, additionalData } : { name: 'AES-GCM', iv }
  const plaintext = await crypto.subtle.decrypt(params, key, ciphertext)
  return new Uint8Array(plaintext) as Bytes
}

export type NotePayload = {
  meta: {
    title: string
    created_at: number
    tags: string[]
    is_favorite: boolean
    updatedAtClient?: number
    updatedBy?: string
  }
  content: string
  attachments: Record<string, string>
  format?: 'blocknote+yjs-v1'
  yjsSnapshotB64?: string
  syncNonce?: string
}

export function noteAad(noteId: string): Bytes {
  return new TextEncoder().encode(`Inkrypt.Note.v1:${noteId}`) as Bytes
}

export type NoteCipherVersion = 'v0' | 'v1' | 'legacy'

export function parseNoteCiphertext(encrypted_data: string): { v: NoteCipherVersion; ciphertextB64: string } {
  if (encrypted_data.startsWith('v1:')) return { v: 'v1', ciphertextB64: encrypted_data.slice(3) }
  if (encrypted_data.startsWith('v0:')) return { v: 'v0', ciphertextB64: encrypted_data.slice(3) }
  return { v: 'legacy', ciphertextB64: encrypted_data }
}

export function isLegacyNoteCiphertext(encrypted_data: string): boolean {
  const v = parseNoteCiphertext(encrypted_data).v
  return v === 'legacy' || v === 'v0'
}

export async function encryptNotePayload(
  masterKey: Bytes,
  payload: NotePayload,
  additionalData?: Bytes,
): Promise<{ encrypted_data: string; iv: string }> {
  const json = JSON.stringify(payload)
  const compressed = await gzip(new TextEncoder().encode(json) as Bytes)
  const { ciphertext, iv } = await aesGcmEncrypt(masterKey, compressed, additionalData)
  const ct = bytesToBase64(ciphertext)
  const v = additionalData ? 'v1:' : 'v0:'
  return { encrypted_data: `${v}${ct}`, iv: bytesToBase64(iv) }
}

export async function decryptNotePayload(
  masterKey: Bytes,
  encrypted_data: string,
  iv: string,
  additionalData?: Bytes,
): Promise<NotePayload> {
  const parsed = parseNoteCiphertext(encrypted_data)
  const ciphertext = base64ToBytes(parsed.ciphertextB64)
  const ivBytes = base64ToBytes(iv)
  let compressed: Bytes
  if (parsed.v === 'v1') {
    if (!additionalData) throw new Error('缺少 AAD，无法解密 v1 笔记密文')
    compressed = await aesGcmDecrypt(masterKey, ciphertext, ivBytes, additionalData)
  } else if (parsed.v === 'v0') {
    compressed = await aesGcmDecrypt(masterKey, ciphertext, ivBytes)
  } else {
    // Legacy (no explicit version). For compatibility with historical data, try v1(AAD) first,
    // then fall back to v0(no AAD). Callers should migrate successful decrypts to v1 ASAP.
    if (additionalData) {
      try {
        compressed = await aesGcmDecrypt(masterKey, ciphertext, ivBytes, additionalData)
      } catch {
        compressed = await aesGcmDecrypt(masterKey, ciphertext, ivBytes)
      }
    } else {
      compressed = await aesGcmDecrypt(masterKey, ciphertext, ivBytes)
    }
  }
  const jsonBytes = await gunzip(compressed)
  const json = new TextDecoder().decode(jsonBytes)
  return JSON.parse(json) as NotePayload
}

export async function wrapMasterKey(
  masterKey: Bytes,
  kekBytes: Bytes,
): Promise<{ wrappedKey: string; iv: string }> {
  if (masterKey.byteLength !== 32) throw new Error('主密钥长度错误：需要 32 字节')
  const { ciphertext, iv } = await aesGcmEncrypt(kekBytes, masterKey)
  return { wrappedKey: bytesToBase64(ciphertext), iv: bytesToBase64(iv) }
}

export async function unwrapMasterKey(
  wrappedKey: string,
  iv: string,
  kekBytes: Bytes,
): Promise<Bytes> {
  const ciphertext = base64ToBytes(wrappedKey)
  const ivBytes = base64ToBytes(iv)
  const mk = await aesGcmDecrypt(kekBytes, ciphertext, ivBytes)
  if (mk.byteLength !== 32) throw new Error('解包后的主密钥长度错误')
  return mk
}
