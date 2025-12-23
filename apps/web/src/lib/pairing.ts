import {
  type Bytes,
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToBytes,
  bytesToBase64,
} from './crypto'

const EMOJI_64 = [
  '🐶',
  '🐱',
  '🐭',
  '🐹',
  '🐰',
  '🦊',
  '🐻',
  '🐼',
  '🐨',
  '🐯',
  '🦁',
  '🐮',
  '🐷',
  '🐸',
  '🐵',
  '🐔',
  '🐧',
  '🐦',
  '🐤',
  '🐺',
  '🦄',
  '🐝',
  '🦋',
  '🐌',
  '🐞',
  '🐢',
  '🐙',
  '🦑',
  '🦀',
  '🐡',
  '🐠',
  '🐬',
  '🐳',
  '🦈',
  '🌵',
  '🌲',
  '🌳',
  '🌴',
  '🌸',
  '🌼',
  '🌻',
  '🍎',
  '🍐',
  '🍊',
  '🍋',
  '🍉',
  '🍇',
  '🍓',
  '🍒',
  '🥝',
  '🍍',
  '🥑',
  '🍞',
  '🧀',
  '🍕',
  '🍔',
  '🍟',
  '🚗',
  '🚕',
  '🚌',
  '🚲',
  '✈️',
  '🚀',
  '🎈',
  '⭐',
]

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.byteLength + b.byteLength) as Uint8Array<ArrayBuffer>
  out.set(a, 0)
  out.set(b, a.byteLength)
  return out
}

export async function generateEphemeralEcdhKeyPair(): Promise<CryptoKeyPair> {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const privateJwk = (await crypto.subtle.exportKey('jwk', keyPair.privateKey)) as JsonWebKey
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  return { publicKey: keyPair.publicKey, privateKey }
}

export async function exportPublicKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return (await crypto.subtle.exportKey('jwk', key)) as JsonWebKey
}

export async function deriveSharedSecretBits(
  localPrivateKey: CryptoKey,
  remotePublicKeyJwk: JsonWebKey,
): Promise<ArrayBuffer> {
  const remotePublicKey = await crypto.subtle.importKey(
    'jwk',
    remotePublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  return await crypto.subtle.deriveBits({ name: 'ECDH', public: remotePublicKey }, localPrivateKey, 256)
}

export async function hkdfSha256(
  keyMaterialBytes: ArrayBuffer,
  salt: string,
  info: string,
  lengthBits: number,
): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', keyMaterialBytes, 'HKDF', false, ['deriveBits'])
  return await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode(salt),
      info: enc.encode(info),
    },
    keyMaterial,
    lengthBits,
  )
}

export async function deriveTransportKey(sharedSecretBits: ArrayBuffer): Promise<Bytes> {
  const bits = await hkdfSha256(sharedSecretBits, 'Transport_Salt', 'Inkrypt_Transfer', 256)
  return new Uint8Array(bits) as Bytes
}

export async function generateSasEmoji(sharedSecretBits: ArrayBuffer): Promise<string> {
  const enc = new TextEncoder()
  const data = concatBytes(new Uint8Array(sharedSecretBits) as Uint8Array<ArrayBuffer>, enc.encode('SAS_V1'))
  const hash = await crypto.subtle.digest('SHA-256', data)
  const h = new Uint8Array(hash)
  const n = (h[0] << 16) | (h[1] << 8) | h[2]

  const i0 = (n >> 18) & 0x3f
  const i1 = (n >> 12) & 0x3f
  const i2 = (n >> 6) & 0x3f
  const i3 = n & 0x3f

  return `${EMOJI_64[i0]} ${EMOJI_64[i1]} ${EMOJI_64[i2]} ${EMOJI_64[i3]}`
}

export async function encryptMasterKeyForTransfer(
  sharedSecretBits: ArrayBuffer,
  masterKey: Bytes,
): Promise<{ encryptedPayload: string; iv: string }> {
  const transportKey = await deriveTransportKey(sharedSecretBits)
  const { ciphertext, iv } = await aesGcmEncrypt(transportKey, masterKey)
  return { encryptedPayload: bytesToBase64(ciphertext), iv: bytesToBase64(iv) }
}

export async function decryptMasterKeyFromTransfer(
  sharedSecretBits: ArrayBuffer,
  encryptedPayload: string,
  iv: string,
): Promise<Bytes> {
  const transportKey = await deriveTransportKey(sharedSecretBits)
  const ciphertext = base64ToBytes(encryptedPayload)
  const ivBytes = base64ToBytes(iv)
  return await aesGcmDecrypt(transportKey, ciphertext, ivBytes)
}
