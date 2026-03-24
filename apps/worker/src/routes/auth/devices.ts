import type { Hono } from 'hono'
import { z } from 'zod'
import {
  countCredentialsByUserId,
  deleteCredentialForUser,
  getCredentialForUser,
  listCredentialsByUserId,
  updateCredentialDeviceName,
} from '../../repositories/credentials'
import { createEnrollment } from '../../repositories/enrollments'
import { getUserById } from '../../repositories/users'
import type { AppEnv } from '../../env'
import { requireAuth } from '../../middleware/requireAuth'
import { randomBase64Url } from '../../utils/base64'
import { clearSessionCookie } from '../../utils/sessionCookie'
import { reuseOrPersistChallenge } from '../../services/auth/challenge'
import { completeDeviceAdd, resolveDeviceAddAccess } from '../../services/auth/deviceAddition'
import {
  generatePasskeyRegistrationOptions,
  verifyAndPersistRegistration,
} from '../../services/auth/registration'
import { verificationErrorResponse } from '../../services/auth/verification'
import {
  ensureUsernameMatches,
  parseJsonBody,
  requireFreshChallengeValue,
} from './shared'
import { MAX_IV_B64, MAX_PRF_SALT, MAX_WRAPPED_KEY } from './constants'
import { nowMs, requireUserId } from '../shared'

export function registerAuthDeviceRoutes(app: Hono<AppEnv>): void {
  app.post('/logout', async (c) => {
    clearSessionCookie(c as any)
    return c.json({ ok: true }, 200)
  })

  app.get('/device/list', requireAuth, async (c) => {
    const userId = requireUserId(c)
    if (userId instanceof Response) return userId

    const creds = await listCredentialsByUserId(c.env.DB, userId)
    return c.json(
      {
        credentials: creds.map((x) => ({
          id: x.id,
          deviceName: x.device_name,
          lastUsedAt: x.last_used_at,
          createdAt: x.created_at,
        })),
      },
      200,
    )
  })

  app.post('/device/rename', requireAuth, async (c) => {
    const userId = requireUserId(c)
    if (userId instanceof Response) return userId

    const body = await parseJsonBody(
      c,
      z.object({
        credentialId: z.string().min(1),
        deviceName: z.string().max(64).optional(),
      }),
    )
    if (body instanceof Response) return body

    const credential = await getCredentialForUser(c.env.DB, userId, body.credentialId)
    if (!credential) return c.json({ error: 'CREDENTIAL_NOT_FOUND' }, 404)

    const normalized = body.deviceName?.trim() ?? ''
    const deviceName = normalized ? normalized : null

    await updateCredentialDeviceName(c.env.DB, userId, body.credentialId, deviceName)
    return c.json({ ok: true }, 200)
  })

  app.delete('/device/:id', requireAuth, async (c) => {
    const userId = requireUserId(c)
    const currentCredentialId = c.get('credentialId')
    if (userId instanceof Response) return userId

    const credentialId = c.req.param('id')
    const credential = await getCredentialForUser(c.env.DB, userId, credentialId)
    if (!credential) return c.json({ error: 'CREDENTIAL_NOT_FOUND' }, 404)

    const count = await countCredentialsByUserId(c.env.DB, userId)
    if (count <= 1) return c.json({ error: 'LAST_DEVICE' }, 400)

    await deleteCredentialForUser(c.env.DB, userId, credentialId)
    if (currentCredentialId && currentCredentialId === credentialId) {
      clearSessionCookie(c as any)
    }

    return c.json({ ok: true }, 200)
  })

  app.post('/device/enroll', requireAuth, async (c) => {
    const userId = requireUserId(c)
    if (userId instanceof Response) return userId

    const token = randomBase64Url(24)
    const createdAt = nowMs()
    const expiresAt = createdAt + 10 * 60 * 1000

    await createEnrollment(c.env.DB, {
      token,
      user_id: userId,
      created_at: createdAt,
      expires_at: expiresAt,
    })

    return c.json({ enrollmentToken: token, expiresAt }, 200)
  })

  app.post('/device/add/start', async (c) => {
    const body = await parseJsonBody(
      c,
      z.object({
        username: z.string().trim().min(1).max(64).optional(),
        enrollmentToken: z.string().min(1).max(256).optional(),
        sessionCode: z.string().min(1).max(32).optional(),
        sessionSecret: z.string().min(1).max(256).optional(),
      }),
    )
    if (body instanceof Response) return body

    const access = await resolveDeviceAddAccess(c, body)
    if (access instanceof Response) return access

    const user = await getUserById(c.env.DB, access.userId)
    if (!user) return c.json({ error: 'USER_NOT_FOUND' }, 404)
    const usernameMismatch = ensureUsernameMatches(c, user.username, body.username)
    if (usernameMismatch) return usernameMismatch

    const existingCreds = await listCredentialsByUserId(c.env.DB, user.id)
    const options = await generatePasskeyRegistrationOptions(c.env, {
      userId: user.id,
      username: user.username,
      excludeCredentialIds: existingCreds.map((cred) => cred.id),
    })

    options.challenge = await reuseOrPersistChallenge(c.env.DB, user, options.challenge, nowMs())

    return c.json({ options }, 200)
  })

  app.post('/device/add', async (c) => {
    const body = await parseJsonBody(
      c,
      z.object({
        username: z.string().trim().min(1).max(64).optional(),
        enrollmentToken: z.string().min(1).max(256).optional(),
        sessionCode: z.string().min(1).max(32).optional(),
        sessionSecret: z.string().min(1).max(256).optional(),
        attestation: z.unknown(),
        prfSalt: z.string().min(1).max(MAX_PRF_SALT),
        wrappedKey: z.string().min(1).max(MAX_WRAPPED_KEY),
        iv: z.string().min(1).max(MAX_IV_B64),
        deviceName: z.string().trim().min(1).max(64).optional(),
      }),
    )
    if (body instanceof Response) return body

    const access = await resolveDeviceAddAccess(c, body)
    if (access instanceof Response) return access

    const user = await getUserById(c.env.DB, access.userId)
    if (!user) return c.json({ error: 'USER_NOT_FOUND' }, 404)
    const usernameMismatch = ensureUsernameMatches(c, user.username, body.username)
    if (usernameMismatch) return usernameMismatch

    const challenge = requireFreshChallengeValue(c, user.current_challenge, nowMs())
    if (challenge instanceof Response) return challenge

    const verification = await verifyAndPersistRegistration(c.env.DB, c.env, {
      userId: user.id,
      attestation: body.attestation,
      expectedChallenge: challenge,
      deviceName: body.deviceName,
      prfSalt: body.prfSalt,
      wrappedKey: body.wrappedKey,
      iv: body.iv,
      createdAt: nowMs(),
    })
    if (!verification.ok) return verificationErrorResponse(c, verification)

    await completeDeviceAdd(c, {
      userId: user.id,
      enrollmentTokenToConsume: access.enrollmentTokenToConsume,
      handshakeCodeToConsume: access.handshakeCodeToConsume,
      credentialId: verification.value.credential.id,
    })

    return c.json({ ok: true }, 200)
  })
}
