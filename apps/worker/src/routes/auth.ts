import { generateAuthenticationOptions, generateRegistrationOptions } from '@simplewebauthn/server'
import { isoUint8Array } from '@simplewebauthn/server/helpers'
import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env'
import {
  countCredentialsByUserId,
  createEnrollment,
  createUser,
  deleteCredentialForUser,
  deleteHandshake,
  deleteEnrollment,
  getCredentialForUser,
  getEnrollmentByToken,
  getHandshakeByCode,
  getHandshakeBySecretHash,
  getUserById,
  listCredentialsByUserId,
  setUserChallenge,
  updateCredentialDeviceName,
  updateCredentialUsage,
  upsertCredential,
  type DbUser,
} from '../db'
import { requireAuth } from '../middleware/requireAuth'
import { rateLimit } from '../middleware/rateLimit'
import { bytesToBase64Url, randomBase64Url, base64UrlToBytes } from '../utils/base64'
import { hashSessionSecret, normalizeSessionCode, normalizeSessionSecret } from '../utils/handshakeSession'
import { clearSessionCookie, setSessionCookie } from '../utils/sessionCookie'
import { getActiveSessionFromCookie } from '../utils/activeSession'

function nowMs(): number {
  return Date.now()
}

const MAX_IV_B64 = 128
const MAX_WRAPPED_KEY = 8192
const MAX_PRF_SALT = 2048

const CHALLENGE_TTL_MS = 5 * 60_000

type StoredChallengeV1 = { v: 1; c: string; ts: number }

function wrapChallenge(challenge: string, ts: number): string {
  const payload: StoredChallengeV1 = { v: 1, c: challenge, ts }
  return JSON.stringify(payload)
}

function parseStoredChallenge(value: string | null): { challenge: string; ts: number | null } | null {
  if (!value) return null
  if (!value.trim()) return null
  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as StoredChallengeV1
      if (parsed && parsed.v === 1 && typeof parsed.c === 'string' && parsed.c && typeof parsed.ts === 'number' && Number.isFinite(parsed.ts)) {
        return { challenge: parsed.c, ts: parsed.ts }
      }
    } catch {
      // fall through to legacy
    }
  }
  return { challenge: value, ts: null }
}

function isChallengeFresh(ts: number | null, now: number): boolean {
  if (ts === null) return true
  return now - ts <= CHALLENGE_TTL_MS
}

async function tryGetSession(c: any): Promise<{ userId: string; credentialId?: string } | null> {
  const res = await getActiveSessionFromCookie(c as any, c.env)
  if (res.kind === 'revoked') {
    clearSessionCookie(c as any)
    return null
  }
  if (res.kind !== 'active') return null
  return { userId: res.session.userId, credentialId: res.session.credentialId }
}

const DEFAULT_VAULT_USERNAME = 'vault'

async function getSingleVaultUser(db: D1Database): Promise<DbUser | null> {
  const res = await db.prepare('SELECT * FROM users ORDER BY created_at ASC LIMIT 2').all<DbUser>()
  const users = res.results ?? []
  if (users.length > 1) throw new Error('MULTI_USER_UNSUPPORTED')
  return users[0] ?? null
}

export const authRoutes = new Hono<AppEnv>()

authRoutes.use('/register', rateLimit({ id: 'auth_register', limit: 10, windowMs: 60_000 }))
authRoutes.use('/login', rateLimit({ id: 'auth_login', limit: 30, windowMs: 60_000 }))
authRoutes.use('/device/add', rateLimit({ id: 'auth_device_add', limit: 20, windowMs: 60_000 }))

authRoutes.post('/register/start', async (c) => {
  const body = z
    .object({
      username: z.string().trim().min(1).max(64).optional(),
      userId: z.string().uuid().optional(),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  let existingUser: DbUser | null
  try {
    existingUser = await getSingleVaultUser(c.env.DB)
  } catch {
    return c.json({ error: 'MULTI_USER_UNSUPPORTED' }, 400)
  }

  let userId: string
  let username: string

  if (existingUser) {
    const credCount = await countCredentialsByUserId(c.env.DB, existingUser.id)
    if (credCount > 0) return c.json({ initialized: true }, 200)
    userId = existingUser.id
    username = existingUser.username
  } else {
    userId = body.data.userId ?? crypto.randomUUID()
    username = body.data.username?.trim() || DEFAULT_VAULT_USERNAME
  }

  const options = await generateRegistrationOptions({
    rpName: c.env.RP_NAME,
    rpID: c.env.RP_ID,
    userName: username,
    userDisplayName: username,
    userID: isoUint8Array.fromUTF8String(userId),
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    excludeCredentials: existingUser ? (await listCredentialsByUserId(c.env.DB, userId)).map((cred) => ({ id: cred.id })) : [],
  })

  const createdAt = nowMs()
  const existingChallenge = existingUser ? parseStoredChallenge(existingUser.current_challenge) : null
  if (existingUser && existingChallenge && isChallengeFresh(existingChallenge.ts, createdAt)) {
    options.challenge = existingChallenge.challenge
    if (existingChallenge.ts === null) {
      await setUserChallenge(c.env.DB, userId, wrapChallenge(existingChallenge.challenge, createdAt))
    }
  } else if (existingUser) {
    await setUserChallenge(c.env.DB, userId, wrapChallenge(options.challenge, createdAt))
  } else {
    await createUser(c.env.DB, {
      id: userId,
      username,
      current_challenge: wrapChallenge(options.challenge, createdAt),
      created_at: createdAt,
    })
  }

  return c.json({ initialized: false, options }, 200)
})

authRoutes.post('/register/finish', async (c) => {
  const body = z
    .object({
      attestation: z.unknown(),
      prfSalt: z.string().min(1).max(MAX_PRF_SALT),
      wrappedKey: z.string().min(1).max(MAX_WRAPPED_KEY),
      iv: z.string().min(1).max(MAX_IV_B64),
      deviceName: z.string().trim().min(1).max(64).optional(),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  let user: DbUser | null
  try {
    user = await getSingleVaultUser(c.env.DB)
  } catch {
    return c.json({ error: 'MULTI_USER_UNSUPPORTED' }, 400)
  }
  if (!user) return c.json({ error: 'VAULT_NOT_INITIALIZED' }, 404)
  const storedChallenge = parseStoredChallenge(user.current_challenge)
  if (!storedChallenge) return c.json({ error: 'NO_CHALLENGE' }, 400)
  if (!isChallengeFresh(storedChallenge.ts, nowMs())) return c.json({ error: 'CHALLENGE_EXPIRED' }, 400)

  const credCount = await countCredentialsByUserId(c.env.DB, user.id)
  if (credCount > 0) return c.json({ error: 'VAULT_ALREADY_INITIALIZED' }, 409)

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.data.attestation as any,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: c.env.ORIGIN,
      expectedRPID: c.env.RP_ID,
      requireUserVerification: true,
    })
  } catch (err) {
    return c.json({ error: 'VERIFY_FAILED', message: (err as Error).message }, 400)
  }

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: 'NOT_VERIFIED' }, 400)
  }

  const { credential } = verification.registrationInfo
  const createdAt = nowMs()

  await upsertCredential(c.env.DB, {
    id: credential.id,
    user_id: user.id,
    public_key: bytesToBase64Url(credential.publicKey),
    device_name: body.data.deviceName ?? null,
    counter: credential.counter,
    prf_salt: body.data.prfSalt,
    wrapped_master_key: body.data.wrappedKey,
    encryption_iv: body.data.iv,
    last_used_at: createdAt,
    created_at: createdAt,
  })

  await setUserChallenge(c.env.DB, user.id, null)
  await setSessionCookie(c as any, c.env, { userId: user.id, credentialId: credential.id })

  return c.json({ ok: true }, 200)
})

authRoutes.post('/login/start', async (c) => {
  const body = z
    .object({
      username: z.string().trim().min(1).max(64).optional(),
      credentialId: z.string().min(1).max(512).optional(),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  let user: DbUser | null
  try {
    user = await getSingleVaultUser(c.env.DB)
  } catch {
    return c.json({ error: 'MULTI_USER_UNSUPPORTED' }, 400)
  }
  if (!user) return c.json({ error: 'VAULT_NOT_INITIALIZED' }, 404)
  if (body.data.username && body.data.username !== user.username) {
    return c.json({ error: 'USERNAME_MISMATCH' }, 400)
  }

  const creds = await listCredentialsByUserId(c.env.DB, user.id)
  if (creds.length === 0) return c.json({ error: 'NO_CREDENTIALS' }, 400)

  const selected =
    (body.data.credentialId
      ? creds.find((x) => x.id === body.data.credentialId)
      : null) ?? creds[0]

  const options = await generateAuthenticationOptions({
    rpID: c.env.RP_ID,
    userVerification: 'required',
    allowCredentials: [
      {
        id: selected.id,
      },
    ],
  })

  const ts = nowMs()
  const existingChallenge = parseStoredChallenge(user.current_challenge)
  if (existingChallenge && isChallengeFresh(existingChallenge.ts, ts)) {
    options.challenge = existingChallenge.challenge
    if (existingChallenge.ts === null) {
      await setUserChallenge(c.env.DB, user.id, wrapChallenge(existingChallenge.challenge, ts))
    }
  } else {
    await setUserChallenge(c.env.DB, user.id, wrapChallenge(options.challenge, ts))
  }

  return c.json(
    {
      options,
      prfSalt: selected.prf_salt,
      credentialId: selected.id,
      deviceName: selected.device_name,
    },
    200,
  )
})

authRoutes.post('/login/finish', async (c) => {
  const body = z
    .object({
      username: z.string().trim().min(1).max(64).optional(),
      assertion: z.unknown(),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  let user: DbUser | null
  try {
    user = await getSingleVaultUser(c.env.DB)
  } catch {
    return c.json({ error: 'MULTI_USER_UNSUPPORTED' }, 400)
  }
  if (!user) return c.json({ error: 'VAULT_NOT_INITIALIZED' }, 404)
  if (body.data.username && body.data.username !== user.username) {
    return c.json({ error: 'USERNAME_MISMATCH' }, 400)
  }
  const storedChallenge = parseStoredChallenge(user.current_challenge)
  if (!storedChallenge) return c.json({ error: 'NO_CHALLENGE' }, 400)
  if (!isChallengeFresh(storedChallenge.ts, nowMs())) return c.json({ error: 'CHALLENGE_EXPIRED' }, 400)

  const assertion = body.data.assertion as any
  const credentialId = assertion?.id
  if (typeof credentialId !== 'string' || !credentialId) {
    return c.json({ error: 'MISSING_CREDENTIAL_ID' }, 400)
  }

  const credential = await getCredentialForUser(c.env.DB, user.id, credentialId)
  if (!credential) return c.json({ error: 'CREDENTIAL_NOT_FOUND' }, 404)

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: c.env.ORIGIN,
      expectedRPID: c.env.RP_ID,
      credential: {
        id: credential.id,
        publicKey: base64UrlToBytes(credential.public_key),
        counter: credential.counter ?? 0,
        transports: [],
      },
      requireUserVerification: true,
    })
  } catch (err) {
    return c.json({ error: 'VERIFY_FAILED', message: (err as Error).message }, 400)
  }

  if (!verification.verified || !verification.authenticationInfo) {
    return c.json({ error: 'NOT_VERIFIED' }, 400)
  }

  const ts = nowMs()
  await updateCredentialUsage(
    c.env.DB,
    credential.id,
    verification.authenticationInfo.newCounter,
    ts,
  )
  await setUserChallenge(c.env.DB, user.id, null)
  await setSessionCookie(c as any, c.env, { userId: user.id, credentialId: credential.id })

  return c.json(
    {
      wrappedKey: credential.wrapped_master_key,
      iv: credential.encryption_iv,
      credentialId: credential.id,
      deviceName: credential.device_name,
    },
    200,
  )
})

authRoutes.post('/logout', async (c) => {
  clearSessionCookie(c as any)
  return c.json({ ok: true }, 200)
})

authRoutes.get('/device/list', requireAuth, async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

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

authRoutes.post('/device/rename', requireAuth, async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

  const body = z
    .object({
      credentialId: z.string().min(1),
      deviceName: z.string().max(64).optional(),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  const credential = await getCredentialForUser(c.env.DB, userId, body.data.credentialId)
  if (!credential) return c.json({ error: 'CREDENTIAL_NOT_FOUND' }, 404)

  const normalized = body.data.deviceName?.trim() ?? ''
  const deviceName = normalized ? normalized : null

  await updateCredentialDeviceName(c.env.DB, userId, body.data.credentialId, deviceName)
  return c.json({ ok: true }, 200)
})

authRoutes.delete('/device/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const currentCredentialId = c.get('credentialId')
  if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

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

authRoutes.post('/device/enroll', requireAuth, async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

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

authRoutes.post('/device/add/start', async (c) => {
  const body = z
    .object({
      username: z.string().trim().min(1).max(64).optional(),
      enrollmentToken: z.string().min(1).max(256).optional(),
      sessionCode: z.string().min(1).max(32).optional(),
      sessionSecret: z.string().min(1).max(256).optional(),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  const session = await tryGetSession(c as any)
  let userId: string | null = session?.userId ?? null

  if (!userId) {
    if (body.data.sessionSecret) {
      let code: string | null = null
      let secret: string

      if (body.data.sessionCode) {
        try {
          code = normalizeSessionCode(body.data.sessionCode)
        } catch {
          return c.json({ error: 'INVALID_SESSION_CODE' }, 400)
        }
      }

      try {
        secret = normalizeSessionSecret(body.data.sessionSecret)
      } catch {
        return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)
      }
      const secretHash = await hashSessionSecret(secret)
      const handshake = code
        ? await getHandshakeByCode(c.env.DB, code)
        : await getHandshakeBySecretHash(c.env.DB, secretHash)
      if (!handshake || !handshake.session_secret_hash) return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)
      if (secretHash !== handshake.session_secret_hash) return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)
      if (handshake.expires_at <= nowMs()) {
        await deleteHandshake(c.env.DB, handshake.session_code)
        return c.json({ error: 'HANDSHAKE_EXPIRED' }, 404)
      }
      if (!handshake.encrypted_payload || !handshake.payload_iv) {
        return c.json({ error: 'HANDSHAKE_NOT_READY' }, 409)
      }
      userId = handshake.user_id
    }
  }

  if (!userId) {
    const token = body.data.enrollmentToken
    if (!token) return c.json({ error: 'UNAUTHORIZED' }, 401)
    const enrollment = await getEnrollmentByToken(c.env.DB, token)
    if (!enrollment) return c.json({ error: 'INVALID_TOKEN' }, 401)
    if (enrollment.expires_at <= nowMs()) {
      await deleteEnrollment(c.env.DB, token)
      return c.json({ error: 'TOKEN_EXPIRED' }, 401)
    }
    userId = enrollment.user_id
  }

  const user = await getUserById(c.env.DB, userId)
  if (!user) return c.json({ error: 'USER_NOT_FOUND' }, 404)
  if (body.data.username && body.data.username !== user.username) {
    return c.json({ error: 'USERNAME_MISMATCH' }, 400)
  }

  const existingCreds = await listCredentialsByUserId(c.env.DB, user.id)
  const options = await generateRegistrationOptions({
    rpName: c.env.RP_NAME,
    rpID: c.env.RP_ID,
    userName: user.username,
    userDisplayName: user.username,
    userID: isoUint8Array.fromUTF8String(user.id),
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    excludeCredentials: existingCreds.map((cred) => ({
      id: cred.id,
    })),
  })

  const ts = nowMs()
  const existingChallenge = parseStoredChallenge(user.current_challenge)
  if (existingChallenge && isChallengeFresh(existingChallenge.ts, ts)) {
    options.challenge = existingChallenge.challenge
    if (existingChallenge.ts === null) {
      await setUserChallenge(c.env.DB, user.id, wrapChallenge(existingChallenge.challenge, ts))
    }
  } else {
    await setUserChallenge(c.env.DB, user.id, wrapChallenge(options.challenge, ts))
  }
  return c.json({ options }, 200)
})

authRoutes.post('/device/add', async (c) => {
  const body = z
    .object({
      username: z.string().trim().min(1).max(64).optional(),
      enrollmentToken: z.string().min(1).max(256).optional(),
      sessionCode: z.string().min(1).max(32).optional(),
      sessionSecret: z.string().min(1).max(256).optional(),
      attestation: z.unknown(),
      prfSalt: z.string().min(1).max(MAX_PRF_SALT),
      wrappedKey: z.string().min(1).max(MAX_WRAPPED_KEY),
      iv: z.string().min(1).max(MAX_IV_B64),
      deviceName: z.string().trim().min(1).max(64).optional(),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  const session = await tryGetSession(c as any)
  let userId: string | null = session?.userId ?? null
  let enrollmentTokenToConsume: string | null = null
  let handshakeCodeToConsume: string | null = null

  if (!userId) {
    if (body.data.sessionSecret) {
      let code: string | null = null
      let secret: string

      if (body.data.sessionCode) {
        try {
          code = normalizeSessionCode(body.data.sessionCode)
        } catch {
          return c.json({ error: 'INVALID_SESSION_CODE' }, 400)
        }
      }

      try {
        secret = normalizeSessionSecret(body.data.sessionSecret)
      } catch {
        return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)
      }
      const secretHash = await hashSessionSecret(secret)
      const handshake = code
        ? await getHandshakeByCode(c.env.DB, code)
        : await getHandshakeBySecretHash(c.env.DB, secretHash)
      if (!handshake || !handshake.session_secret_hash) return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)
      if (secretHash !== handshake.session_secret_hash) return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)
      if (handshake.expires_at <= nowMs()) {
        await deleteHandshake(c.env.DB, handshake.session_code)
        return c.json({ error: 'HANDSHAKE_EXPIRED' }, 404)
      }
      if (!handshake.encrypted_payload || !handshake.payload_iv) {
        return c.json({ error: 'HANDSHAKE_NOT_READY' }, 409)
      }
      userId = handshake.user_id
      handshakeCodeToConsume = handshake.session_code
    }
  }

  if (!userId) {
    const token = body.data.enrollmentToken
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

  const user = await getUserById(c.env.DB, userId)
  if (!user) return c.json({ error: 'USER_NOT_FOUND' }, 404)
  if (body.data.username && body.data.username !== user.username) {
    return c.json({ error: 'USERNAME_MISMATCH' }, 400)
  }
  const storedChallenge = parseStoredChallenge(user.current_challenge)
  if (!storedChallenge) return c.json({ error: 'NO_CHALLENGE' }, 400)
  if (!isChallengeFresh(storedChallenge.ts, nowMs())) return c.json({ error: 'CHALLENGE_EXPIRED' }, 400)

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body.data.attestation as any,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: c.env.ORIGIN,
      expectedRPID: c.env.RP_ID,
      requireUserVerification: true,
    })
  } catch (err) {
    return c.json({ error: 'VERIFY_FAILED', message: (err as Error).message }, 400)
  }

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: 'NOT_VERIFIED' }, 400)
  }

  const { credential } = verification.registrationInfo
  const createdAt = nowMs()

  await upsertCredential(c.env.DB, {
    id: credential.id,
    user_id: user.id,
    public_key: bytesToBase64Url(credential.publicKey),
    device_name: body.data.deviceName ?? null,
    counter: credential.counter,
    prf_salt: body.data.prfSalt,
    wrapped_master_key: body.data.wrappedKey,
    encryption_iv: body.data.iv,
    last_used_at: createdAt,
    created_at: createdAt,
  })

  await setUserChallenge(c.env.DB, user.id, null)
  if (enrollmentTokenToConsume) await deleteEnrollment(c.env.DB, enrollmentTokenToConsume)
  if (handshakeCodeToConsume) await deleteHandshake(c.env.DB, handshakeCodeToConsume)
  await setSessionCookie(c as any, c.env, { userId: user.id, credentialId: credential.id })

  return c.json({ ok: true }, 200)
})
