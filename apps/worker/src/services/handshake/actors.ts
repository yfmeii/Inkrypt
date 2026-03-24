import type { DbHandshake } from '../../repositories/handshakes'
import { deriveHandshakeStatus, parseStoredPublicKey } from './shared'

type BobStatusHandshake = Pick<
  DbHandshake,
  'alice_public_key' | 'encrypted_payload' | 'expires_at' | 'bob_public_key' | 'payload_iv'
>

type AliceStatusHandshake = Pick<
  DbHandshake,
  'bob_public_key' | 'encrypted_payload' | 'expires_at' | 'payload_iv'
>

export function buildBobHandshakeStatus(handshake: BobStatusHandshake): {
  status: ReturnType<typeof deriveHandshakeStatus>
  expiresAt: number
  alicePublicKey: unknown | null
  encryptedPayload: string | null
  iv: string | null
} {
  const status = deriveHandshakeStatus(handshake)

  return {
    status,
    expiresAt: handshake.expires_at,
    alicePublicKey: parseStoredPublicKey(handshake.alice_public_key),
    encryptedPayload: status === 'finished' ? handshake.encrypted_payload : null,
    iv: status === 'finished' ? handshake.payload_iv : null,
  }
}

export function buildAliceHandshakeStatus(handshake: AliceStatusHandshake): {
  status: ReturnType<typeof deriveHandshakeStatus>
  expiresAt: number
  bobPublicKey: unknown | null
} {
  return {
    status: deriveHandshakeStatus(handshake),
    expiresAt: handshake.expires_at,
    bobPublicKey: parseStoredPublicKey(handshake.bob_public_key),
  }
}
