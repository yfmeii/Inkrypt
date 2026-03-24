import { Blob as NodeBlob } from 'node:buffer'
import { describe, expect, test } from 'vitest'
import {
  aesGcmEncrypt,
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  decryptNotePayload,
  encryptNotePayload,
  noteAad,
  parseNoteCiphertext,
  unwrapMasterKey,
  wrapMasterKey,
  type Bytes,
  type NotePayload,
} from './crypto'

const encoder = new TextEncoder()

globalThis.Blob = NodeBlob as typeof Blob

function textBytes(value: string): Bytes {
  return encoder.encode(value) as Bytes
}

function samplePayload(): NotePayload {
  return {
    meta: {
      title: 'Regression-prone note',
      created_at: 1712345678,
      tags: ['crypto', 'tests'],
      is_favorite: true,
      updatedAtClient: 1712345699,
      updatedBy: 'tester',
    },
    content: 'Hello encrypted world',
    attachments: {
      'doc.txt': 'data:text/plain;base64,SGVsbG8=',
    },
    format: 'blocknote+yjs-v1',
    yjsSnapshotB64: 'c25hcHNob3Q=',
    syncNonce: 'sync-123',
  }
}

describe('crypto', () => {
  test('round-trips base64 and base64url bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 62, 63, 64, 127, 128, 250, 251, 252, 253, 254, 255]) as Bytes

    const base64 = bytesToBase64(bytes)
    const base64url = bytesToBase64Url(bytes)

    expect(Array.from(base64ToBytes(base64))).toEqual(Array.from(bytes))
    expect(Array.from(base64UrlToBytes(base64url))).toEqual(Array.from(bytes))
    expect(base64url).not.toContain('=')
    expect(base64url).not.toContain('+')
    expect(base64url).not.toContain('/')
  })

  test('builds stable note AAD from note id', () => {
    expect(new TextDecoder().decode(noteAad('note-123'))).toBe('Inkrypt.Note.v1:note-123')
    expect(Array.from(noteAad('note-123'))).toEqual(Array.from(noteAad('note-123')))
    expect(Array.from(noteAad('note-123'))).not.toEqual(Array.from(noteAad('note-456')))
  })

  test('parses note ciphertext versions', () => {
    expect(parseNoteCiphertext('v1:abc')).toEqual({ v: 'v1', ciphertextB64: 'abc' })
    expect(parseNoteCiphertext('v0:def')).toEqual({ v: 'v0', ciphertextB64: 'def' })
    expect(parseNoteCiphertext('ghi')).toEqual({ v: 'legacy', ciphertextB64: 'ghi' })
  })

  test('encrypts and decrypts a v1 note payload round trip', async () => {
    const masterKey = crypto.getRandomValues(new Uint8Array(32)) as Bytes
    const payload = samplePayload()
    const aad = noteAad('note-v1')

    const encrypted = await encryptNotePayload(masterKey, payload, aad)
    const decrypted = await decryptNotePayload(masterKey, encrypted.encrypted_data, encrypted.iv, aad)

    expect(encrypted.encrypted_data.startsWith('v1:')).toBe(true)
    expect(decrypted).toEqual(payload)
  })

  test('decrypts legacy ciphertext that was originally encrypted as v1', async () => {
    const masterKey = crypto.getRandomValues(new Uint8Array(32)) as Bytes
    const payload = samplePayload()
    const aad = noteAad('legacy-v1')

    const encrypted = await encryptNotePayload(masterKey, payload, aad)
    const legacyCiphertext = encrypted.encrypted_data.slice(3)

    const decrypted = await decryptNotePayload(masterKey, legacyCiphertext, encrypted.iv, aad)

    expect(decrypted).toEqual(payload)
  })

  test('decrypts legacy ciphertext that falls back to v0 without AAD', async () => {
    const masterKey = crypto.getRandomValues(new Uint8Array(32)) as Bytes
    const payload = samplePayload()

    const encrypted = await encryptNotePayload(masterKey, payload)
    const legacyCiphertext = encrypted.encrypted_data.slice(3)

    const decrypted = await decryptNotePayload(masterKey, legacyCiphertext, encrypted.iv, noteAad('wrong-note'))

    expect(encrypted.encrypted_data.startsWith('v0:')).toBe(true)
    expect(decrypted).toEqual(payload)
  })

  test('rejects v1 note decryption when AAD is missing', async () => {
    const masterKey = crypto.getRandomValues(new Uint8Array(32)) as Bytes
    const payload = samplePayload()
    const aad = noteAad('note-missing-aad')
    const encrypted = await encryptNotePayload(masterKey, payload, aad)

    await expect(decryptNotePayload(masterKey, encrypted.encrypted_data, encrypted.iv)).rejects.toThrow(
      '缺少 AAD，无法解密 v1 笔记密文',
    )
  })

  test('wraps and unwraps a master key round trip', async () => {
    const masterKey = crypto.getRandomValues(new Uint8Array(32)) as Bytes
    const kek = crypto.getRandomValues(new Uint8Array(32)) as Bytes

    const wrapped = await wrapMasterKey(masterKey, kek)
    const unwrapped = await unwrapMasterKey(wrapped.wrappedKey, wrapped.iv, kek)

    expect(Array.from(unwrapped)).toEqual(Array.from(masterKey))
  })

  test('rejects wrapping a master key with the wrong length', async () => {
    const shortMasterKey = crypto.getRandomValues(new Uint8Array(16)) as Bytes
    const kek = crypto.getRandomValues(new Uint8Array(32)) as Bytes

    await expect(wrapMasterKey(shortMasterKey, kek)).rejects.toThrow('主密钥长度错误：需要 32 字节')
  })

  test('rejects unwrapping when the decrypted master key length is invalid', async () => {
    const kek = crypto.getRandomValues(new Uint8Array(32)) as Bytes
    const { ciphertext, iv } = await aesGcmEncrypt(kek, textBytes('too short'))

    await expect(unwrapMasterKey(bytesToBase64(ciphertext), bytesToBase64(iv), kek)).rejects.toThrow(
      '解包后的主密钥长度错误',
    )
  })

  test('rejects unwrapping with the wrong KEK', async () => {
    const masterKey = crypto.getRandomValues(new Uint8Array(32)) as Bytes
    const kek = crypto.getRandomValues(new Uint8Array(32)) as Bytes
    const wrongKek = crypto.getRandomValues(new Uint8Array(32)) as Bytes
    const wrapped = await wrapMasterKey(masterKey, kek)

    await expect(unwrapMasterKey(wrapped.wrappedKey, wrapped.iv, wrongKek)).rejects.toThrow()
  })
})
