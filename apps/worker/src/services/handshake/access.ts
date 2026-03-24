import type { D1Database } from '../../cloudflare'
import type { DbHandshake } from '../../repositories/handshakes'
import { expireHandshakeIfNeeded, resolveHandshakeByCodeOrSecret } from './lookup'
import { nowMs } from './shared'

type HandshakeLookupInput = {
  db: D1Database
  sessionCode?: string
  sessionSecret: string
}

export type ResolveActiveHandshakeError =
  | 'INVALID_SESSION_CODE'
  | 'HANDSHAKE_NOT_FOUND'
  | 'HANDSHAKE_EXPIRED'

export async function resolveActiveHandshake(
  input: HandshakeLookupInput,
  ts = nowMs(),
): Promise<{ ok: true; handshake: DbHandshake } | { ok: false; error: ResolveActiveHandshakeError }> {
  const resolved = await resolveHandshakeByCodeOrSecret(input)
  if ('error' in resolved) return { ok: false, error: resolved.error }

  if (await expireHandshakeIfNeeded(input.db, resolved.handshake, ts)) {
    return { ok: false, error: 'HANDSHAKE_EXPIRED' }
  }

  return { ok: true, handshake: resolved.handshake }
}

export function isHandshakeOwner(
  handshake: Pick<DbHandshake, 'user_id'>,
  userId: string,
): boolean {
  return handshake.user_id === userId
}
