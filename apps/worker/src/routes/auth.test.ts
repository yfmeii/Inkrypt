import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context, Hono, Next } from 'hono'
import type { AppEnv } from '../env'

const mocks = vi.hoisted(() => ({
  middlewareCalls: [] as Array<{ id: string; path: string }>,
}))

vi.mock('../middleware/rateLimit', () => ({
  rateLimit: vi.fn((options: { id: string }) => async (context: Context<AppEnv>, next: Next) => {
    mocks.middlewareCalls.push({ id: options.id, path: context.req.path })
    await next()
  }),
}))

vi.mock('./auth/register', () => ({
  registerAuthRegistrationRoutes: vi.fn((app: Hono<AppEnv>) => {
    app.post('/register/start', (context) => context.json({ route: 'register-start' }))
    app.post('/register/finish', (context) => context.json({ route: 'register-finish' }))
  }),
}))

vi.mock('./auth/login', () => ({
  registerAuthLoginRoutes: vi.fn((app: Hono<AppEnv>) => {
    app.post('/login/start', (context) => context.json({ route: 'login-start' }))
    app.post('/login/finish', (context) => context.json({ route: 'login-finish' }))
  }),
}))

vi.mock('./auth/devices', () => ({
  registerAuthDeviceRoutes: vi.fn((app: Hono<AppEnv>) => {
    app.post('/device/add/start', (context) => context.json({ route: 'device-add-start' }))
    app.post('/device/add', (context) => context.json({ route: 'device-add-finish' }))
  }),
}))

import { authRoutes } from './auth'

describe('auth route rate limits', () => {
  beforeEach(() => {
    mocks.middlewareCalls.length = 0
  })

  it.each([
    ['/register/start', 'auth_register'],
    ['/register/finish', 'auth_register'],
    ['/login/start', 'auth_login'],
    ['/login/finish', 'auth_login'],
    ['/device/add/start', 'auth_device_add'],
    ['/device/add', 'auth_device_add'],
  ])('applies the expected limiter to POST %s', async (path, expectedLimiterId) => {
    const response = await authRoutes.request(path, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(mocks.middlewareCalls).toEqual([{ id: expectedLimiterId, path }])
  })
})
