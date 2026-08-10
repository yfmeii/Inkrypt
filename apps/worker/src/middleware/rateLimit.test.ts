import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DurableObjectNamespace } from '../cloudflare'
import type { AppEnv } from '../env'
import { rateLimit } from './rateLimit'

function createRateLimiterNamespace(responseFactory: () => Response): DurableObjectNamespace {
  return {
    idFromName: vi.fn(() => ({ toString: () => 'rate-limit-id' })),
    get: vi.fn(() => ({ fetch: vi.fn(async () => responseFactory()) })),
  } as unknown as DurableObjectNamespace
}

function createApp(limiterId: string, limit = 1): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use('/protected', rateLimit({ id: limiterId, limit, windowMs: 60_000 }))
  app.get('/protected', (context) => context.json({ ok: true }))
  return app
}

function createBindings(namespace: DurableObjectNamespace): AppEnv['Bindings'] {
  return {
    RATE_LIMITER: namespace,
  } as AppEnv['Bindings']
}

describe('rateLimit', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the local fallback instead of allowing every request after a 500 response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const namespace = createRateLimiterNamespace(() => Response.json({ error: 'broken' }, { status: 500 }))
    const app = createApp('invalid-global-response')
    const requestHeaders = { 'CF-Connecting-IP': '203.0.113.10' }

    const firstResponse = await app.request('/protected', { headers: requestHeaders }, createBindings(namespace))
    const secondResponse = await app.request('/protected', { headers: requestHeaders }, createBindings(namespace))

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(429)
    await expect(secondResponse.json()).resolves.toMatchObject({ error: 'RATE_LIMITED' })
  })

  it('honors an explicit global rejection', async () => {
    const namespace = createRateLimiterNamespace(() => Response.json({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfter: 60,
    }, { status: 429 }))
    const app = createApp('global-rejection', 10)

    const response = await app.request(
      '/protected',
      { headers: { 'CF-Connecting-IP': '203.0.113.11' } },
      createBindings(namespace),
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
  })
})
