import type { DbHandshake } from '../../repositories/handshakes'
import { JOIN_TTL_MS, MAX_PUBLIC_KEY_JSON, tryJsonStringify } from './shared'

export function serializePublicKey(publicKey: unknown): string | null {
  return tryJsonStringify(publicKey, MAX_PUBLIC_KEY_JSON)
}

export function nextHandshakeExpiry(ts: number): number {
  return ts + JOIN_TTL_MS
}

export function hasJoinedHandshake(
  handshake: Pick<DbHandshake, 'bob_public_key'>,
): boolean {
  return Boolean(handshake.bob_public_key)
}

export function hasConfirmedHandshake(
  handshake: Pick<DbHandshake, 'encrypted_payload' | 'payload_iv'>,
): boolean {
  return Boolean(handshake.encrypted_payload || handshake.payload_iv)
}
