import { bytesToBase64Url } from './base64'
import { wordlist as BIP39_ENGLISH_WORDLIST } from '@scure/bip39/wordlists/english.js'

const SESSION_SECRET_WORD_COUNT = 8
const WORDS = BIP39_ENGLISH_WORDLIST
const WORD_SET = new Set(WORDS)
const WORD_PREFIX4 = new Map<string, string>()

for (const w of WORDS) {
  const prefix = w.slice(0, 4)
  if (!WORD_PREFIX4.has(prefix)) WORD_PREFIX4.set(prefix, w)
  else WORD_PREFIX4.set(prefix, '')
}

export function normalizeSessionCode(input: string): string {
  const code = input.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(code)) throw new Error('INVALID_SESSION_CODE')
  return code
}

export function generateSessionCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
  return String(n).padStart(6, '0')
}

export function normalizeSessionSecret(input: string): string {
  const rawWords = input
    .trim()
    .toLowerCase()
    .split(/[^a-z]+/g)
    .filter(Boolean)

  if (rawWords.length !== SESSION_SECRET_WORD_COUNT) throw new Error('INVALID_SESSION_SECRET')

  const words: string[] = []
  for (const raw of rawWords) {
    if (WORD_SET.has(raw)) {
      words.push(raw)
      continue
    }
    if (raw.length >= 4) {
      const resolved = WORD_PREFIX4.get(raw.slice(0, 4))
      if (resolved) {
        words.push(resolved)
        continue
      }
    }
    throw new Error('INVALID_SESSION_SECRET')
  }

  return words.join(' ')
}

export function generateSessionSecret(): string {
  const picks = new Uint16Array(SESSION_SECRET_WORD_COUNT)
  crypto.getRandomValues(picks)
  return Array.from(picks)
    .map((n) => WORDS[n & 2047])
    .join(' ')
}

export async function hashSessionSecret(secret: string): Promise<string> {
  const data = new TextEncoder().encode(secret)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToBase64Url(new Uint8Array(digest))
}
