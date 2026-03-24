import type { DbHandshake } from '../../repositories/handshakes'

export const MAX_PUBLIC_KEY_JSON = 4096
export const MAX_HANDSHAKE_PAYLOAD_B64 = 1024
export const MAX_IV_B64 = 128
export const JOIN_TTL_MS = 5 * 60_000

export type HandshakeStatus = 'waiting_join' | 'waiting_confirm' | 'finished'

export function nowMs(): number {
  return Date.now()
}

export function tryJsonStringify(value: unknown, maxLength: number): string | null {
  let out: string
  try {
    out = JSON.stringify(value)
  } catch {
    return null
  }
  if (out.length > maxLength) return null
  return out
}

export function deriveHandshakeStatus(
  handshake: Pick<DbHandshake, 'bob_public_key' | 'encrypted_payload' | 'payload_iv'>,
): HandshakeStatus {
  if (!handshake.bob_public_key) return 'waiting_join'
  if (!handshake.encrypted_payload || !handshake.payload_iv) return 'waiting_confirm'
  return 'finished'
}

export function parseStoredPublicKey(value: string | null): unknown | null {
  if (!value) return null

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
