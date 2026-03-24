import type { D1Database } from '../../cloudflare'
import {
  createHandshake,
  deleteHandshake,
  updateHandshakeJoin,
  updateHandshakePayload,
} from '../../repositories/handshakes'
import {
  generateSessionCode,
  generateSessionSecret,
  hashSessionSecret,
  normalizeSessionCode,
} from '../../utils/handshakeSession'
import { isHandshakeOwner, resolveActiveHandshake } from './access'
import { buildAliceHandshakeStatus, buildBobHandshakeStatus } from './actors'
import {
  hasConfirmedHandshake,
  hasJoinedHandshake,
  nextHandshakeExpiry,
  serializePublicKey,
} from './lifecycle'
import { resolveHandshakeByCodeOrSecret } from './lookup'
import { deriveHandshakeStatus, nowMs } from './shared'

type ServiceResult<T, E extends string> = { ok: true; value: T } | { ok: false; error: E }

type HandshakeLookupInput = {
  db: D1Database
  sessionCode?: string
  sessionSecret: string
}

type InitHandshakeInput = {
  db: D1Database
  userId: string
  sessionCode?: string
  publicKey: unknown
}

type JoinHandshakeInput = HandshakeLookupInput & {
  publicKey: unknown
}

type ConfirmHandshakeInput = HandshakeLookupInput & {
  userId: string
  encryptedPayload: string
  iv: string
}

type CancelHandshakeInput = HandshakeLookupInput & {
  userId: string
}

type StatusHandshakeInput = HandshakeLookupInput

export async function initHandshake(
  input: InitHandshakeInput,
): Promise<
  ServiceResult<
    {
      sessionCode: string
      sessionSecret: string
      expiresAt: number
    },
    'INVALID_PUBLIC_KEY' | 'CODE_CONFLICT'
  >
> {
  const createdAt = nowMs()
  const expiresAt = nextHandshakeExpiry(createdAt)

  const alicePublicKey = serializePublicKey(input.publicKey)
  if (!alicePublicKey) return { ok: false, error: 'INVALID_PUBLIC_KEY' }

  const requested = input.sessionCode?.trim() ? normalizeSessionCode(input.sessionCode) : null
  const codesToTry = requested ? [requested] : Array.from({ length: 20 }, () => generateSessionCode())
  const sessionSecret = generateSessionSecret()
  const sessionSecretHash = await hashSessionSecret(sessionSecret)

  for (const sessionCode of codesToTry) {
    const created = await createHandshake(input.db, {
      session_code: sessionCode,
      user_id: input.userId,
      session_secret_hash: sessionSecretHash,
      alice_public_key: alicePublicKey,
      bob_public_key: null,
      encrypted_payload: null,
      payload_iv: null,
      created_at: createdAt,
      expires_at: expiresAt,
    })

    if (created) {
      return {
        ok: true,
        value: { sessionCode, sessionSecret, expiresAt },
      }
    }
  }

  return { ok: false, error: 'CODE_CONFLICT' }
}

export async function joinHandshake(
  input: JoinHandshakeInput,
): Promise<
  ServiceResult<
    { expiresAt: number },
    'INVALID_SESSION_CODE' | 'HANDSHAKE_NOT_FOUND' | 'HANDSHAKE_EXPIRED' | 'ALREADY_JOINED' | 'INVALID_PUBLIC_KEY'
  >
> {
  const ts = nowMs()
  const resolved = await resolveActiveHandshake(input, ts)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  if (hasJoinedHandshake(resolved.handshake)) return { ok: false, error: 'ALREADY_JOINED' }

  const bobPublicKey = serializePublicKey(input.publicKey)
  if (!bobPublicKey) return { ok: false, error: 'INVALID_PUBLIC_KEY' }

  const expiresAt = nextHandshakeExpiry(ts)
  await updateHandshakeJoin(input.db, resolved.handshake.session_code, bobPublicKey, expiresAt)
  return { ok: true, value: { expiresAt } }
}

export async function getHandshakeStatusForBob(
  input: StatusHandshakeInput,
): Promise<
  ServiceResult<
    {
      status: ReturnType<typeof deriveHandshakeStatus>
      expiresAt: number
      alicePublicKey: unknown | null
      encryptedPayload: string | null
      iv: string | null
    },
    'INVALID_SESSION_CODE' | 'HANDSHAKE_NOT_FOUND' | 'HANDSHAKE_EXPIRED'
  >
> {
  const resolved = await resolveActiveHandshake(input)
  if (!resolved.ok) return { ok: false, error: resolved.error }

  return { ok: true, value: buildBobHandshakeStatus(resolved.handshake) }
}

export async function getHandshakeStatusForAlice(
  input: StatusHandshakeInput & { userId: string },
): Promise<
  ServiceResult<
    {
      status: ReturnType<typeof deriveHandshakeStatus>
      expiresAt: number
      bobPublicKey: unknown | null
    },
    'INVALID_SESSION_CODE' | 'HANDSHAKE_NOT_FOUND' | 'HANDSHAKE_EXPIRED'
  >
> {
  const resolved = await resolveActiveHandshake(input)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  if (!isHandshakeOwner(resolved.handshake, input.userId)) return { ok: false, error: 'HANDSHAKE_NOT_FOUND' }

  return { ok: true, value: buildAliceHandshakeStatus(resolved.handshake) }
}

export async function confirmHandshake(
  input: ConfirmHandshakeInput,
): Promise<
  ServiceResult<
    { expiresAt: number },
    'INVALID_SESSION_CODE' | 'HANDSHAKE_NOT_FOUND' | 'FORBIDDEN' | 'HANDSHAKE_EXPIRED' | 'NO_JOIN_YET' | 'ALREADY_CONFIRMED'
  >
> {
  const ts = nowMs()
  const resolved = await resolveActiveHandshake(input, ts)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  if (!isHandshakeOwner(resolved.handshake, input.userId)) return { ok: false, error: 'FORBIDDEN' }
  if (!hasJoinedHandshake(resolved.handshake)) return { ok: false, error: 'NO_JOIN_YET' }
  if (hasConfirmedHandshake(resolved.handshake)) {
    return { ok: false, error: 'ALREADY_CONFIRMED' }
  }

  const expiresAt = nextHandshakeExpiry(ts)
  await updateHandshakePayload(
    input.db,
    resolved.handshake.session_code,
    input.encryptedPayload,
    input.iv,
    expiresAt,
  )
  return { ok: true, value: { expiresAt } }
}

export async function cancelHandshake(
  input: CancelHandshakeInput,
): Promise<ServiceResult<{ ok: true }, 'INVALID_SESSION_CODE' | 'FORBIDDEN'>> {
  const resolved = await resolveHandshakeByCodeOrSecret(input)
  if ('error' in resolved) {
    if (resolved.error === 'HANDSHAKE_NOT_FOUND') {
      return { ok: true, value: { ok: true } }
    }
    return { ok: false, error: resolved.error }
  }
  if (!isHandshakeOwner(resolved.handshake, input.userId)) return { ok: false, error: 'FORBIDDEN' }

  await deleteHandshake(input.db, resolved.handshake.session_code)
  return { ok: true, value: { ok: true } }
}
