import type { Context } from 'hono'
import { deleteHandshake } from '../../repositories/handshakes'
import { deleteEnrollment, getEnrollmentByToken } from '../../repositories/enrollments'
import { setUserChallenge } from '../../repositories/users'
import type { AppEnv } from '../../env'
import { expireHandshakeIfNeeded, resolveHandshakeByCodeOrSecret } from '../handshake/lookup'
import { finalizeSession, tryGetSession } from './session'

function nowMs(): number {
  return Date.now()
}

type DeviceAccessInput = {
  enrollmentToken?: string
  sessionCode?: string
  sessionSecret?: string
}

type DeviceAccessResult = {
  userId: string
  enrollmentTokenToConsume: string | null
  handshakeCodeToConsume: string | null
}

type CompleteDeviceAddInput = DeviceAccessResult & {
  credentialId: string
}

export async function resolveDeviceAddAccess(
  c: Context<AppEnv>,
  input: DeviceAccessInput,
): Promise<DeviceAccessResult | Response> {
  const session = await tryGetSession(c)
  let userId: string | null = session?.userId ?? null
  let enrollmentTokenToConsume: string | null = null
  let handshakeCodeToConsume: string | null = null

  if (!userId && input.sessionSecret) {
    const resolved = await resolveHandshakeByCodeOrSecret({
      db: c.env.DB,
      sessionCode: input.sessionCode,
      sessionSecret: input.sessionSecret,
    })
    if ('error' in resolved) {
      return c.json({ error: resolved.error }, resolved.error === 'INVALID_SESSION_CODE' ? 400 : 404)
    }
    if (await expireHandshakeIfNeeded(c.env.DB, resolved.handshake, nowMs())) {
      return c.json({ error: 'HANDSHAKE_EXPIRED' }, 404)
    }
    if (!resolved.handshake.encrypted_payload || !resolved.handshake.payload_iv) {
      return c.json({ error: 'HANDSHAKE_NOT_READY' }, 409)
    }

    userId = resolved.handshake.user_id
    handshakeCodeToConsume = resolved.handshake.session_code
  }

  if (!userId) {
    const token = input.enrollmentToken
    if (!token) return c.json({ error: 'UNAUTHORIZED' }, 401)

    const enrollment = await getEnrollmentByToken(c.env.DB, token)
    if (!enrollment) return c.json({ error: 'INVALID_TOKEN' }, 401)
    if (enrollment.expires_at <= nowMs()) {
      await deleteEnrollment(c.env.DB, token)
      return c.json({ error: 'TOKEN_EXPIRED' }, 401)
    }

    userId = enrollment.user_id
    enrollmentTokenToConsume = token
  }

  return { userId, enrollmentTokenToConsume, handshakeCodeToConsume }
}

export async function completeDeviceAdd(
  c: Context<AppEnv>,
  input: CompleteDeviceAddInput,
): Promise<void> {
  if (input.enrollmentTokenToConsume) {
    await deleteEnrollment(c.env.DB, input.enrollmentTokenToConsume)
  }
  if (input.handshakeCodeToConsume) {
    await deleteHandshake(c.env.DB, input.handshakeCodeToConsume)
  }
  await finalizeSession(c, {
    userId: input.userId,
    credentialId: input.credentialId,
  })
}
