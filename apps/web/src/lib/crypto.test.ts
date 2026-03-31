import { Blob as NodeBlob } from 'node:buffer'
import { describe, expect, test, it, vi, beforeEach, afterEach } from 'vitest'
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
  decryptNotePayload,
  encryptNotePayload,
  isLegacyNoteCiphertext,
  noteAad,
  parseNoteCiphertext,
  randomBytes,
  unwrapMasterKey,
  wrapMasterKey,
  type Bytes,
  type NotePayload,
} from './crypto'

globalThis.Blob = NodeBlob as typeof Blob
const encoder = new TextEncoder()
const decoder = new TextDecoder()

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

  describe('randomBytes', () => {
    it('generates random bytes with correct length', () => {
      const bytes = randomBytes(32)
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.byteLength).toBe(32)
    })

    it('generates different bytes each call', () => {
      const bytes1 = randomBytes(16)
      const bytes2 = randomBytes(16)
      expect(bytes1).not.toEqual(bytes2)
    })

    it('handles zero length', () => {
      const bytes = randomBytes(0)
      expect(bytes.byteLength).toBe(0)
    })
  })

  describe('bytesToHex', () => {
    it('converts bytes to hex string', () => {
      const bytes = new Uint8Array([0x01, 0xab, 0xff])
      expect(bytesToHex(bytes)).toBe('01abff')
    })

    it('handles empty input', () => {
      expect(bytesToHex(new Uint8Array(0))).toBe('')
    })
  })

  describe('bytesToBase64 / base64ToBytes', () => {
    it('converts bytes to base64', () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]) // "Hello"
      expect(bytesToBase64(bytes)).toBe('SGVsbG8=')
    })

    it('converts base64 to bytes', () => {
      const base64 = 'SGVsbG8='
      const bytes = base64ToBytes(base64)
      expect(bytes).toEqual(new Uint8Array([72, 101, 108, 108, 111]))
    })

    it('round-trips correctly', () => {
      const original = new Uint8Array([0, 1, 2, 127, 128, 255])
      const b64 = bytesToBase64(original)
      const restored = base64ToBytes(b64)
      expect(restored).toEqual(original)
    })

    it('handles empty input', () => {
      expect(bytesToBase64(new Uint8Array(0))).toBe('')
      expect(base64ToBytes('').byteLength).toBe(0)
    })
  })

  describe('isLegacyNoteCiphertext', () => {
    it('returns false for v1', () => {
      expect(isLegacyNoteCiphertext('v1:abc')).toBe(false)
    })

    it('returns true for v0', () => {
      expect(isLegacyNoteCiphertext('v0:abc')).toBe(true)
    })

    it('returns true for legacy format', () => {
      expect(isLegacyNoteCiphertext('legacyData')).toBe(true)
    })
  })

  describe('AES-GCM encryption', () => {
    it('encrypts and decrypts without additional data', async () => {
      const key = randomBytes(32)
      const plaintext = encoder.encode('Secret message')
      const { ciphertext, iv } = await aesGcmEncrypt(key, plaintext)

      expect(ciphertext).toBeInstanceOf(Uint8Array)
      expect(iv).toBeInstanceOf(Uint8Array)
      expect(ciphertext.byteLength).toBeGreaterThan(0)

      const decrypted = await aesGcmDecrypt(key, ciphertext, iv)
      expect(decoder.decode(decrypted)).toBe('Secret message')
    })

    it('encrypts and decrypts with additional data', async () => {
      const key = randomBytes(32)
      const plaintext = encoder.encode('Authenticated message')
      const aad = randomBytes(16)
      const { ciphertext, iv } = await aesGcmEncrypt(key, plaintext, aad)

      const decrypted = await aesGcmDecrypt(key, ciphertext, iv, aad)
      expect(decoder.decode(decrypted)).toBe('Authenticated message')
    })

    it('fails to decrypt with wrong additional data', async () => {
      const key = randomBytes(32)
      const plaintext = encoder.encode('Authenticated message')
      const correctAad = encoder.encode('correct-aad')
      const wrongAad = encoder.encode('wrong-aad')
      const { ciphertext, iv } = await aesGcmEncrypt(key, plaintext, correctAad)

      await expect(aesGcmDecrypt(key, ciphertext, iv, wrongAad)).rejects.toThrow()
    })

    it('produces different ciphertext with different IVs', async () => {
      const key = randomBytes(32)
      const plaintext = encoder.encode('Same message')

      const result1 = await aesGcmEncrypt(key, plaintext)
      const result2 = await aesGcmEncrypt(key, plaintext)

      expect(result1.ciphertext).not.toEqual(result2.ciphertext)
      expect(result1.iv).not.toEqual(result2.iv)
    })

    it('rejects wrong key length', async () => {
      const key = randomBytes(16) // wrong length
      const plaintext = randomBytes(10)

      await expect(aesGcmEncrypt(key, plaintext)).rejects.toThrow('密钥长度错误')
    })
  })
})
