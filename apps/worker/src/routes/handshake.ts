import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env'
import {
  createHandshake,
  deleteHandshake,
  getHandshakeByCode,
  getHandshakeBySecretHash,
  updateHandshakeJoin,
  updateHandshakePayload,
} from '../db'
import { requireAuth } from '../middleware/requireAuth'
import { rateLimit } from '../middleware/rateLimit'
import {
  generateSessionCode,
  generateSessionSecret,
  hashSessionSecret,
  normalizeSessionCode,
  normalizeSessionSecret,
} from '../utils/handshakeSession'

function nowMs(): number {
  return Date.now()
}

function tryJsonStringify(value: unknown, maxLength: number): string | null {
  let out: string
  try {
    out = JSON.stringify(value)
  } catch {
    return null
  }
  if (out.length > maxLength) return null
  return out
}

const MAX_PUBLIC_KEY_JSON = 4096
const MAX_HANDSHAKE_PAYLOAD_B64 = 1024
const MAX_IV_B64 = 128
const JOIN_TTL_MS = 5 * 60_000

export const handshakeRoutes = new Hono<AppEnv>()

handshakeRoutes.use('/join', rateLimit({ id: 'handshake_join', limit: 20, windowMs: 60_000 }))
handshakeRoutes.use('/status/bob', rateLimit({ id: 'handshake_status_bob', limit: 120, windowMs: 60_000 }))
handshakeRoutes.use('/status/alice', rateLimit({ id: 'handshake_status_alice', limit: 120, windowMs: 60_000 }))
handshakeRoutes.use('/confirm', rateLimit({ id: 'handshake_confirm', limit: 30, windowMs: 60_000 }))

// Alice: init a pairing session (requires auth)
handshakeRoutes.post('/init', requireAuth, async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

  const body = z
    .object({
      sessionCode: z.string().max(32).optional(),
      publicKey: z.unknown(),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  const createdAt = nowMs()
  const joinExpiresAt = createdAt + JOIN_TTL_MS

  const alicePublicKey = tryJsonStringify(body.data.publicKey, MAX_PUBLIC_KEY_JSON)
  if (!alicePublicKey) return c.json({ error: 'INVALID_PUBLIC_KEY' }, 400)

  const requested = body.data.sessionCode?.trim() ? normalizeSessionCode(body.data.sessionCode) : null
  const codesToTry = requested ? [requested] : Array.from({ length: 20 }, () => generateSessionCode())
  const sessionSecret = generateSessionSecret()
  const sessionSecretHash = await hashSessionSecret(sessionSecret)

  for (const code of codesToTry) {
    const ok = await createHandshake(c.env.DB, {
      session_code: code,
      user_id: userId,
      session_secret_hash: sessionSecretHash,
      alice_public_key: alicePublicKey,
      bob_public_key: null,
      encrypted_payload: null,
      payload_iv: null,
      created_at: createdAt,
      expires_at: joinExpiresAt,
    })
    if (ok) return c.json({ sessionCode: code, sessionSecret, expiresAt: joinExpiresAt }, 200)
  }

  return c.json({ error: 'CODE_CONFLICT' }, 409)
})

// Bob: join a pairing session (no auth)
handshakeRoutes.post('/join', async (c) => {
  const body = z
    .object({
      sessionCode: z.string().min(1).max(32).optional(),
      sessionSecret: z.string().min(1).max(256),
      publicKey: z.unknown(),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  let code: string | null = null
  if (body.data.sessionCode) {
    try {
      code = normalizeSessionCode(body.data.sessionCode)
    } catch {
      return c.json({ error: 'INVALID_SESSION_CODE' }, 400)
    }
  }

  let secret: string
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

  const ts = nowMs()
  if (handshake.expires_at <= ts) {
    await deleteHandshake(c.env.DB, handshake.session_code)
    return c.json({ error: 'HANDSHAKE_EXPIRED' }, 404)
  }

  if (handshake.bob_public_key) return c.json({ error: 'ALREADY_JOINED' }, 409)

  const bobPublicKey = tryJsonStringify(body.data.publicKey, MAX_PUBLIC_KEY_JSON)
  if (!bobPublicKey) return c.json({ error: 'INVALID_PUBLIC_KEY' }, 400)
  const expiresAt = ts + JOIN_TTL_MS
  await updateHandshakeJoin(c.env.DB, handshake.session_code, bobPublicKey, expiresAt)

  return c.json({ ok: true, expiresAt }, 200)
})

async function requireHandshakeByCodeOrSecret(
  c: any,
  code: string | null,
  secret: string,
): Promise<Awaited<ReturnType<typeof getHandshakeByCode>> | null> {
  const secretHash = await hashSessionSecret(secret)
  const handshake = code
    ? await getHandshakeByCode(c.env.DB, code)
    : await getHandshakeBySecretHash(c.env.DB, secretHash)
  if (!handshake || !handshake.session_secret_hash) return null
  if (secretHash !== handshake.session_secret_hash) return null
  return handshake
}

// Bob polling (no auth): return Alice's public key + (when finished) encrypted payload
handshakeRoutes.post('/status/bob', async (c) => {
  const body = z
    .object({
      sessionCode: z.string().min(1).max(32).optional(),
      sessionSecret: z.string().min(1).max(256),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  let code: string | null = null
  if (body.data.sessionCode) {
    try {
      code = normalizeSessionCode(body.data.sessionCode)
    } catch {
      return c.json({ error: 'INVALID_SESSION_CODE' }, 400)
    }
  }

  let secret: string
  try {
    secret = normalizeSessionSecret(body.data.sessionSecret)
  } catch {
    return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)
  }

  const handshake = await requireHandshakeByCodeOrSecret(c, code, secret)
  if (!handshake) return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)

  const ts = nowMs()
  if (handshake.expires_at <= ts) {
    await deleteHandshake(c.env.DB, handshake.session_code)
    return c.json({ error: 'HANDSHAKE_EXPIRED' }, 404)
  }

  const status =
    !handshake.bob_public_key
      ? 'waiting_join'
      : !handshake.encrypted_payload || !handshake.payload_iv
        ? 'waiting_confirm'
        : 'finished'

  let alicePublicKey: unknown = null
  try {
    alicePublicKey = JSON.parse(handshake.alice_public_key)
  } catch {
    alicePublicKey = handshake.alice_public_key
  }

  return c.json(
    {
      status,
      expiresAt: handshake.expires_at,
      alicePublicKey,
      encryptedPayload: status === 'finished' ? handshake.encrypted_payload : null,
      iv: status === 'finished' ? handshake.payload_iv : null,
    },
    200,
  )
})

// Alice polling (requires auth): return Bob's public key (no encrypted payload)
handshakeRoutes.post('/status/alice', requireAuth, async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

  const body = z
    .object({
      sessionCode: z.string().min(1).max(32).optional(),
      sessionSecret: z.string().min(1).max(256),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  let code: string | null = null
  if (body.data.sessionCode) {
    try {
      code = normalizeSessionCode(body.data.sessionCode)
    } catch {
      return c.json({ error: 'INVALID_SESSION_CODE' }, 400)
    }
  }

  let secret: string
  try {
    secret = normalizeSessionSecret(body.data.sessionSecret)
  } catch {
    return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)
  }

  const handshake = await requireHandshakeByCodeOrSecret(c, code, secret)
  if (!handshake) return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)
  if (handshake.user_id !== userId) return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)

  const ts = nowMs()
  if (handshake.expires_at <= ts) {
    await deleteHandshake(c.env.DB, handshake.session_code)
    return c.json({ error: 'HANDSHAKE_EXPIRED' }, 404)
  }

  const status =
    !handshake.bob_public_key
      ? 'waiting_join'
      : !handshake.encrypted_payload || !handshake.payload_iv
        ? 'waiting_confirm'
        : 'finished'

  let bobPublicKey: unknown = null
  if (handshake.bob_public_key) {
    try {
      bobPublicKey = JSON.parse(handshake.bob_public_key)
    } catch {
      bobPublicKey = handshake.bob_public_key
    }
  }

  return c.json(
    {
      status,
      expiresAt: handshake.expires_at,
      bobPublicKey,
    },
    200,
  )
})

// Alice: confirm after SAS matches, and upload encrypted MK payload (requires auth)
handshakeRoutes.post('/confirm', requireAuth, async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

  const body = z
    .object({
      sessionCode: z.string().min(1).max(32).optional(),
      sessionSecret: z.string().min(1).max(256),
      encryptedPayload: z.string().min(1).max(MAX_HANDSHAKE_PAYLOAD_B64),
      iv: z.string().min(1).max(MAX_IV_B64),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  let code: string | null = null
  if (body.data.sessionCode) {
    try {
      code = normalizeSessionCode(body.data.sessionCode)
    } catch {
      return c.json({ error: 'INVALID_SESSION_CODE' }, 400)
    }
  }

  let secret: string
  try {
    secret = normalizeSessionSecret(body.data.sessionSecret)
  } catch {
    return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)
  }

  const handshake = await requireHandshakeByCodeOrSecret(c, code, secret)
  if (!handshake) return c.json({ error: 'HANDSHAKE_NOT_FOUND' }, 404)
  if (handshake.user_id !== userId) return c.json({ error: 'FORBIDDEN' }, 403)

  const ts = nowMs()
  if (handshake.expires_at <= ts) {
    await deleteHandshake(c.env.DB, handshake.session_code)
    return c.json({ error: 'HANDSHAKE_EXPIRED' }, 404)
  }

  if (!handshake.bob_public_key) return c.json({ error: 'NO_JOIN_YET' }, 409)
  if (handshake.encrypted_payload || handshake.payload_iv) return c.json({ error: 'ALREADY_CONFIRMED' }, 409)

  const expiresAt = ts + JOIN_TTL_MS
  await updateHandshakePayload(
    c.env.DB,
    handshake.session_code,
    body.data.encryptedPayload,
    body.data.iv,
    expiresAt,
  )

  return c.json({ ok: true, expiresAt }, 200)
})

handshakeRoutes.post('/cancel', requireAuth, async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

  const body = z
    .object({
      sessionCode: z.string().min(1).max(32).optional(),
      sessionSecret: z.string().min(1).max(256),
    })
    .safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'INVALID_BODY' }, 400)

  let code: string | null = null
  if (body.data.sessionCode) {
    try {
      code = normalizeSessionCode(body.data.sessionCode)
    } catch {
      return c.json({ error: 'INVALID_SESSION_CODE' }, 400)
    }
  }

  let secret: string
  try {
    secret = normalizeSessionSecret(body.data.sessionSecret)
  } catch {
    return c.json({ ok: true }, 200)
  }

  const handshake = await requireHandshakeByCodeOrSecret(c, code, secret)
  if (!handshake) return c.json({ ok: true }, 200)
  if (handshake.user_id !== userId) return c.json({ error: 'FORBIDDEN' }, 403)

  await deleteHandshake(c.env.DB, handshake.session_code)
  return c.json({ ok: true }, 200)
})
