import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env'
import { requireAuth } from '../middleware/requireAuth'
import { rateLimit } from '../middleware/rateLimit'
import { jsonError, parseJsonBody, requireUserId } from './shared'
import { MAX_HANDSHAKE_PAYLOAD_B64, MAX_IV_B64 } from '../services/handshake/shared'
import {
  cancelHandshake,
  confirmHandshake,
  getHandshakeStatusForAlice,
  getHandshakeStatusForBob,
  initHandshake,
  joinHandshake,
} from '../services/handshake/workflows'

export const handshakeRoutes = new Hono<AppEnv>()

type ErrorStatus = 400 | 401 | 403 | 404 | 409

function errorStatus(
  error: string,
  statusByError: Record<string, ErrorStatus>,
  fallbackStatus: ErrorStatus,
) {
  return statusByError[error] ?? fallbackStatus
}

handshakeRoutes.use('/join', rateLimit({ id: 'handshake_join', limit: 20, windowMs: 60_000 }))
handshakeRoutes.use('/status/bob', rateLimit({ id: 'handshake_status_bob', limit: 120, windowMs: 60_000 }))
handshakeRoutes.use('/status/alice', rateLimit({ id: 'handshake_status_alice', limit: 120, windowMs: 60_000 }))
handshakeRoutes.use('/confirm', rateLimit({ id: 'handshake_confirm', limit: 30, windowMs: 60_000 }))

// Alice: init a pairing session (requires auth)
handshakeRoutes.post('/init', requireAuth, async (c) => {
  const userId = requireUserId(c)
  if (userId instanceof Response) return userId

  const body = await parseJsonBody(
    c,
    z.object({
      sessionCode: z.string().max(32).optional(),
      publicKey: z.unknown(),
    }),
  )
  if (body instanceof Response) return body

  const result = await initHandshake({
    db: c.env.DB,
    userId,
    sessionCode: body.sessionCode,
    publicKey: body.publicKey,
  })
  if (!result.ok) {
    return jsonError(c, result.error, errorStatus(result.error, { CODE_CONFLICT: 409 }, 400))
  }

  return c.json(result.value, 200)
})

// Bob: join a pairing session (no auth)
handshakeRoutes.post('/join', async (c) => {
  const body = await parseJsonBody(
    c,
    z.object({
      sessionCode: z.string().min(1).max(32).optional(),
      sessionSecret: z.string().min(1).max(256),
      publicKey: z.unknown(),
    }),
  )
  if (body instanceof Response) return body

  const result = await joinHandshake({
    db: c.env.DB,
    sessionCode: body.sessionCode,
    sessionSecret: body.sessionSecret,
    publicKey: body.publicKey,
  })
  if (!result.ok) {
    return jsonError(
      c,
      result.error,
      errorStatus(
        result.error,
        {
          INVALID_SESSION_CODE: 400,
          INVALID_PUBLIC_KEY: 400,
          ALREADY_JOINED: 409,
        },
        404,
      ),
    )
  }

  return c.json({ ok: true, expiresAt: result.value.expiresAt }, 200)
})

// Bob polling (no auth): return Alice's public key + (when finished) encrypted payload
handshakeRoutes.post('/status/bob', async (c) => {
  const body = await parseJsonBody(
    c,
    z.object({
      sessionCode: z.string().min(1).max(32).optional(),
      sessionSecret: z.string().min(1).max(256),
    }),
  )
  if (body instanceof Response) return body

  const result = await getHandshakeStatusForBob({
    db: c.env.DB,
    sessionCode: body.sessionCode,
    sessionSecret: body.sessionSecret,
  })
  if (!result.ok) {
    return jsonError(c, result.error, errorStatus(result.error, { INVALID_SESSION_CODE: 400 }, 404))
  }

  return c.json(result.value, 200)
})

// Alice polling (requires auth): return Bob's public key (no encrypted payload)
handshakeRoutes.post('/status/alice', requireAuth, async (c) => {
  const userId = requireUserId(c)
  if (userId instanceof Response) return userId

  const body = await parseJsonBody(
    c,
    z.object({
      sessionCode: z.string().min(1).max(32).optional(),
      sessionSecret: z.string().min(1).max(256),
    }),
  )
  if (body instanceof Response) return body

  const result = await getHandshakeStatusForAlice({
    db: c.env.DB,
    userId,
    sessionCode: body.sessionCode,
    sessionSecret: body.sessionSecret,
  })
  if (!result.ok) {
    return jsonError(c, result.error, errorStatus(result.error, { INVALID_SESSION_CODE: 400 }, 404))
  }

  return c.json(result.value, 200)
})

// Alice: confirm after SAS matches, and upload encrypted MK payload (requires auth)
handshakeRoutes.post('/confirm', requireAuth, async (c) => {
  const userId = requireUserId(c)
  if (userId instanceof Response) return userId

  const body = await parseJsonBody(
    c,
    z.object({
      sessionCode: z.string().min(1).max(32).optional(),
      sessionSecret: z.string().min(1).max(256),
      encryptedPayload: z.string().min(1).max(MAX_HANDSHAKE_PAYLOAD_B64),
      iv: z.string().min(1).max(MAX_IV_B64),
    }),
  )
  if (body instanceof Response) return body

  const result = await confirmHandshake({
    db: c.env.DB,
    userId,
    sessionCode: body.sessionCode,
    sessionSecret: body.sessionSecret,
    encryptedPayload: body.encryptedPayload,
    iv: body.iv,
  })
  if (!result.ok) {
    return jsonError(
      c,
      result.error,
      errorStatus(
        result.error,
        {
          INVALID_SESSION_CODE: 400,
          FORBIDDEN: 403,
          NO_JOIN_YET: 409,
          ALREADY_CONFIRMED: 409,
        },
        404,
      ),
    )
  }

  return c.json({ ok: true, expiresAt: result.value.expiresAt }, 200)
})

handshakeRoutes.post('/cancel', requireAuth, async (c) => {
  const userId = requireUserId(c)
  if (userId instanceof Response) return userId

  const body = await parseJsonBody(
    c,
    z.object({
      sessionCode: z.string().min(1).max(32).optional(),
      sessionSecret: z.string().min(1).max(256),
    }),
  )
  if (body instanceof Response) return body

  const result = await cancelHandshake({
    db: c.env.DB,
    userId,
    sessionCode: body.sessionCode,
    sessionSecret: body.sessionSecret,
  })
  if (!result.ok) {
    return jsonError(c, result.error, errorStatus(result.error, { FORBIDDEN: 403 }, 400))
  }

  return c.json(result.value, 200)
})
