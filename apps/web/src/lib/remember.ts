import type { Bytes } from './crypto'
import { base64ToBytes, bytesToBase64, randomBytes } from './crypto'
import { idbDeleteMeta, idbGetMeta, idbSetMeta } from './idb'

const META_UNLOCK_KEY = 'unlock_key_v1'
const REMEMBER_COOKIE = 'inkrypt_remember_unlock'

export const REMEMBER_MAX_AGE_SECONDS = 60 * 60 * 24 * 14

type RememberCookieV1 = {
  v: 1
  exp: number
  ct: string
  iv: string
  credentialId: string | null
  deviceName: string | null
}

function isBrowser(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined'
}

function getCookie(name: string): string | null {
  if (!isBrowser()) return null
  const cookies = document.cookie ? document.cookie.split('; ') : []
  for (const part of cookies) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx)
    if (key !== name) continue
    return decodeURIComponent(part.slice(idx + 1))
  }
  return null
}

function setCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (!isBrowser()) return
  const secure = window.location.protocol === 'https:'
  const maxAge = Math.max(0, Math.floor(maxAgeSeconds))
  const exp = new Date(Date.now() + maxAge * 1000).toUTCString()
  document.cookie = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=/`,
    `Max-Age=${maxAge}`,
    `Expires=${exp}`,
    `SameSite=Strict`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')
}

function deleteCookie(name: string): void {
  if (!isBrowser()) return
  document.cookie = `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict`
}

function isCryptoKey(value: unknown): value is CryptoKey {
  if (!value || typeof value !== 'object') return false
  const v = value as any
  return typeof v.type === 'string' && typeof v.extractable === 'boolean' && v.algorithm && Array.isArray(v.usages)
}

async function getOrCreateUnlockKey(): Promise<CryptoKey> {
  const existing = await idbGetMeta(META_UNLOCK_KEY)
  if (isCryptoKey(existing)) return existing

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  await idbSetMeta(META_UNLOCK_KEY, key)
  return key
}

async function deleteUnlockKey(): Promise<void> {
  await idbDeleteMeta(META_UNLOCK_KEY)
}

async function encryptMasterKey(
  key: CryptoKey,
  masterKey: Bytes,
): Promise<{ ct: string; iv: string }> {
  const iv = randomBytes(12)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, masterKey)
  return { ct: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) }
}

async function decryptMasterKey(key: CryptoKey, ct: string, iv: string): Promise<Bytes> {
  const ciphertext = base64ToBytes(ct)
  const ivBytes = base64ToBytes(iv)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, ciphertext)
  return new Uint8Array(plaintext) as Bytes
}

export async function rememberUnlockedSession(args: {
  masterKey: Bytes
  credentialId: string | null
  deviceName: string | null
  maxAgeSeconds?: number
}): Promise<void> {
  if (!isBrowser()) return
  const maxAgeSeconds = args.maxAgeSeconds ?? REMEMBER_MAX_AGE_SECONDS
  const key = await getOrCreateUnlockKey()
  const { ct, iv } = await encryptMasterKey(key, args.masterKey)

  const payload: RememberCookieV1 = {
    v: 1,
    exp: Date.now() + maxAgeSeconds * 1000,
    ct,
    iv,
    credentialId: args.credentialId,
    deviceName: args.deviceName,
  }

  setCookie(REMEMBER_COOKIE, JSON.stringify(payload), maxAgeSeconds)
}

export async function loadRememberedUnlockedSession(): Promise<{
  masterKey: Bytes
  credentialId: string | null
  deviceName: string | null
} | null> {
  if (!isBrowser()) return null

  const raw = getCookie(REMEMBER_COOKIE)
  if (!raw) return null

  let payload: RememberCookieV1 | null = null
  try {
    payload = JSON.parse(raw) as RememberCookieV1
  } catch {
    deleteCookie(REMEMBER_COOKIE)
    return null
  }

  if (
    !payload ||
    payload.v !== 1 ||
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp) ||
    typeof payload.ct !== 'string' ||
    typeof payload.iv !== 'string'
  ) {
    deleteCookie(REMEMBER_COOKIE)
    return null
  }

  if (payload.exp <= Date.now()) {
    deleteCookie(REMEMBER_COOKIE)
    return null
  }

  const key = await idbGetMeta(META_UNLOCK_KEY)
  if (!isCryptoKey(key)) {
    deleteCookie(REMEMBER_COOKIE)
    return null
  }

  try {
    const masterKey = await decryptMasterKey(key, payload.ct, payload.iv)
    if (masterKey.byteLength !== 32) throw new Error('INVALID_MASTER_KEY')
    return {
      masterKey,
      credentialId: payload.credentialId ?? null,
      deviceName: payload.deviceName ?? null,
    }
  } catch {
    await clearRememberedUnlockedSession()
    return null
  }
}

export async function clearRememberedUnlockedSession(): Promise<void> {
  if (!isBrowser()) return
  deleteCookie(REMEMBER_COOKIE)
  await deleteUnlockKey()
}
