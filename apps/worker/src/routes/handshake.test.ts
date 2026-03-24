import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../env'

vi.mock('../middleware/requireAuth', () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    const userId = c.req.header('x-user-id')
    if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

    c.set('userId', userId)
    await next()
  },
}))

vi.mock('../middleware/rateLimit', () => ({
  rateLimit: () => async (_c: any, next: () => Promise<void>) => {
    await next()
  },
}))

vi.mock('../services/handshake/workflows', () => ({
  cancelHandshake: vi.fn(),
  confirmHandshake: vi.fn(),
  getHandshakeStatusForAlice: vi.fn(),
  getHandshakeStatusForBob: vi.fn(),
  initHandshake: vi.fn(),
  joinHandshake: vi.fn(),
}))

import {
  cancelHandshake,
  confirmHandshake,
  getHandshakeStatusForAlice,
  getHandshakeStatusForBob,
  initHandshake,
  joinHandshake,
} from '../services/handshake/workflows'
import { handshakeRoutes } from './handshake'

function createApp() {
  const app = new Hono<AppEnv>()
  app.route('/api/handshake', handshakeRoutes)
  return app
}

const env = {
  DB: {},
  RATE_LIMITER: {},
  RP_NAME: 'Inkrypt',
  RP_ID: 'example.com',
  ORIGIN: 'https://example.com',
  CORS_ORIGIN: 'https://example.com',
  COOKIE_SAMESITE: 'Lax',
  SESSION_SECRET: 'secret',
} as AppEnv['Bindings']

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handshakeRoutes', () => {
  it('requires auth for alice init', async () => {
    const response = await createApp().request(
      '/api/handshake/init',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicKey: { kty: 'OKP' } }),
      },
      env,
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'UNAUTHORIZED' })
    expect(initHandshake).not.toHaveBeenCalled()
  })

  it('returns invalid body before calling join workflow', async () => {
    const response = await createApp().request(
      '/api/handshake/join',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionSecret: '' }),
      },
      env,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_BODY' })
    expect(joinHandshake).not.toHaveBeenCalled()
  })

  it('maps join workflow errors to the documented status codes', async () => {
    vi.mocked(joinHandshake).mockResolvedValueOnce({ ok: false, error: 'ALREADY_JOINED' })

    const response = await createApp().request(
      '/api/handshake/join',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionCode: 'ABCD', sessionSecret: 'secret', publicKey: { kty: 'OKP' } }),
      },
      env,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'ALREADY_JOINED' })
  })

  it('returns bob status payload when lookup succeeds', async () => {
    vi.mocked(getHandshakeStatusForBob).mockResolvedValueOnce({
      ok: true,
      value: {
        status: 'finished',
        expiresAt: 123_456,
        alicePublicKey: { kty: 'OKP' },
        encryptedPayload: 'cipher',
        iv: 'iv',
      },
    })

    const response = await createApp().request(
      '/api/handshake/status/bob',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionCode: 'ABCD', sessionSecret: 'secret' }),
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'finished',
      expiresAt: 123_456,
      alicePublicKey: { kty: 'OKP' },
      encryptedPayload: 'cipher',
      iv: 'iv',
    })
  })

  it('passes the authenticated user through alice status checks', async () => {
    vi.mocked(getHandshakeStatusForAlice).mockResolvedValueOnce({
      ok: true,
      value: { status: 'waiting_confirm', expiresAt: 123_456, bobPublicKey: { kty: 'OKP' } },
    })

    const response = await createApp().request(
      '/api/handshake/status/alice',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': 'user-1',
        },
        body: JSON.stringify({ sessionCode: 'ABCD', sessionSecret: 'secret' }),
      },
      env,
    )

    expect(response.status).toBe(200)
    expect(getHandshakeStatusForAlice).toHaveBeenCalledWith({
      db: env.DB,
      userId: 'user-1',
      sessionCode: 'ABCD',
      sessionSecret: 'secret',
    })
  })

  it('maps confirm handshake state errors to 409/403/404 responses', async () => {
    vi.mocked(confirmHandshake).mockResolvedValueOnce({ ok: false, error: 'NO_JOIN_YET' })

    const response = await createApp().request(
      '/api/handshake/confirm',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': 'user-1',
        },
        body: JSON.stringify({
          sessionCode: 'ABCD',
          sessionSecret: 'secret',
          encryptedPayload: 'cipher',
          iv: 'iv',
        }),
      },
      env,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'NO_JOIN_YET' })
  })

  it('returns cancel workflow payload for the owner', async () => {
    vi.mocked(cancelHandshake).mockResolvedValueOnce({ ok: true, value: { ok: true } })

    const response = await createApp().request(
      '/api/handshake/cancel',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': 'user-1',
        },
        body: JSON.stringify({ sessionCode: 'ABCD', sessionSecret: 'secret' }),
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })
})
