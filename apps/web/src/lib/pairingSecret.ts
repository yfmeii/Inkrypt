import { wordlist as BIP39_ENGLISH_WORDLIST } from '@scure/bip39/wordlists/english.js'

export const PAIRING_SECRET_WORD_COUNT = 8

export const PAIRING_WORDLIST = BIP39_ENGLISH_WORDLIST

export const PAIRING_DEEPLINK_HASH_PREFIX = '#/pair/'

const WORDS = PAIRING_WORDLIST
const WORD_SET = new Set(WORDS)
const WORD_PREFIX4 = new Map<string, string>()

for (const w of WORDS) {
  const prefix = w.slice(0, 4)
  if (!WORD_PREFIX4.has(prefix)) WORD_PREFIX4.set(prefix, w)
  else WORD_PREFIX4.set(prefix, '')
}

export function splitPairingSecretWords(input: string): string[] {
  return input
    .trim()
    .toLowerCase()
    .split(/[^a-z]+/g)
    .filter(Boolean)
}

export function resolvePairingWord(input: string): string | null {
  const raw = input.trim().toLowerCase().replace(/[^a-z]/g, '')
  if (!raw) return null
  if (WORD_SET.has(raw)) return raw
  if (raw.length >= 4) {
    const resolved = WORD_PREFIX4.get(raw.slice(0, 4))
    if (resolved) return resolved
  }
  return null
}

export function normalizePairingSecret(input: string): string {
  const rawWords = splitPairingSecretWords(input)
  if (rawWords.length !== PAIRING_SECRET_WORD_COUNT) {
    throw new Error(`配对口令应为 ${PAIRING_SECRET_WORD_COUNT} 个英文单词`)
  }

  const words: string[] = []
  for (const raw of rawWords) {
    const resolved = resolvePairingWord(raw)
    if (!resolved) throw new Error(`无效单词：${raw}`)
    words.push(resolved)
  }

  return words.join(' ')
}

function tryNormalizePairingSecret(input: string): string | null {
  try {
    return normalizePairingSecret(input)
  } catch {
    return null
  }
}

export function encodePairingSecretForUrl(secret: string): string {
  const normalized = normalizePairingSecret(secret)
  return splitPairingSecretWords(normalized).join('-')
}

export function buildPairingDeepLink(secret: string, baseUrl: string): string {
  const payload = encodePairingSecretForUrl(secret)
  const url = new URL(baseUrl)
  url.pathname = '/'
  url.search = ''
  url.hash = `${PAIRING_DEEPLINK_HASH_PREFIX}${payload}`
  return url.toString()
}

export function extractPairingSecretFromText(input: string): string | null {
  const direct = tryNormalizePairingSecret(input)
  if (direct) return direct

  const dashed = tryNormalizePairingSecret(input.replace(/[-_]/g, ' '))
  if (dashed) return dashed

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }

  const hash = url.hash || ''
  const trimmedHash = hash.startsWith('#') ? hash.slice(1) : hash
  const hashPath = trimmedHash.startsWith('/') ? trimmedHash : `/${trimmedHash}`

  if (hashPath.startsWith('/pair/')) {
    const rawPayload = hashPath.slice('/pair/'.length).replace(/^\/+|\/+$/g, '')
    const payload = decodeURIComponent(rawPayload.split('?')[0] ?? '')
    return tryNormalizePairingSecret(payload.replace(/[-_]/g, ' '))
  }

  return null
}

export function formatPairingSecretForDisplay(secret: string): string {
  const words = splitPairingSecretWords(secret)
  if (words.length <= 4) return words.join(' ')
  return `${words.slice(0, 4).join(' ')}\n${words.slice(4).join(' ')}`
}
