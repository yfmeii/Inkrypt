import type { D1Database } from '../../cloudflare'
import {
  deleteHandshake,
  getHandshakeByCode,
  getHandshakeBySecretHash,
  type DbHandshake,
} from '../../repositories/handshakes'
import { hashSessionSecret, normalizeSessionCode, normalizeSessionSecret } from '../../utils/handshakeSession'
import { nowMs } from './shared'

export type ResolveHandshakeError = 'INVALID_SESSION_CODE' | 'HANDSHAKE_NOT_FOUND'

type ResolveHandshakeInput = {
  db: D1Database
  sessionCode?: string
  sessionSecret: string
}

type ResolveHandshakeSuccess = {
  handshake: DbHandshake
  sessionCode: string | null
  sessionSecret: string
  sessionSecretHash: string
}

export type ResolveHandshakeResult =
  | { error: ResolveHandshakeError }
  | ResolveHandshakeSuccess

export async function resolveHandshakeByCodeOrSecret(
  input: ResolveHandshakeInput,
): Promise<ResolveHandshakeResult> {
  let sessionCode: string | null = null
  if (input.sessionCode) {
    try {
      sessionCode = normalizeSessionCode(input.sessionCode)
    } catch {
      return { error: 'INVALID_SESSION_CODE' }
    }
  }

  let sessionSecret: string
  try {
    sessionSecret = normalizeSessionSecret(input.sessionSecret)
  } catch {
    return { error: 'HANDSHAKE_NOT_FOUND' }
  }

  const sessionSecretHash = await hashSessionSecret(sessionSecret)
  const handshake = sessionCode
    ? await getHandshakeByCode(input.db, sessionCode)
    : await getHandshakeBySecretHash(input.db, sessionSecretHash)

  if (!handshake || !handshake.session_secret_hash) {
    return { error: 'HANDSHAKE_NOT_FOUND' }
  }
  if (sessionSecretHash !== handshake.session_secret_hash) {
    return { error: 'HANDSHAKE_NOT_FOUND' }
  }

  return { handshake, sessionCode, sessionSecret, sessionSecretHash }
}

export async function expireHandshakeIfNeeded(
  db: D1Database,
  handshake: DbHandshake,
  ts = nowMs(),
): Promise<boolean> {
  if (handshake.expires_at > ts) return false

  await deleteHandshake(db, handshake.session_code)
  return true
}
