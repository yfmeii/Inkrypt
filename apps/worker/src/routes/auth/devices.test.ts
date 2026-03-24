import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateRegistrationOptionsOpts } from '@simplewebauthn/server'
import type { AppEnv } from '../../env'

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
}))

vi.mock('@simplewebauthn/server/helpers', () => ({
  isoUint8Array: {
    fromUTF8String: vi.fn((value: string) => new TextEncoder().encode(value)),
  },
}))

vi.mock('../../middleware/requireAuth', () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    const userId = c.req.header('x-user-id')
    if (!userId) return c.json({ error: 'UNAUTHORIZED' }, 401)

    c.set('userId', userId)
    c.set('credentialId', c.req.header('x-credential-id') ?? undefined)
    await next()
  },
}))

vi.mock('../../repositories/credentials', () => ({
  countCredentialsByUserId: vi.fn(),
  deleteCredentialForUser: vi.fn(),
  getCredentialForUser: vi.fn(),
  listCredentialsByUserId: vi.fn(),
  updateCredentialDeviceName: vi.fn(),
}))

vi.mock('../../repositories/enrollments', () => ({
  createEnrollment: vi.fn(),
}))

vi.mock('../../repositories/users', () => ({
  getUserById: vi.fn(),
}))

vi.mock('../../services/auth/challenge', () => ({
  requireFreshChallenge: vi.fn(),
  reuseOrPersistChallenge: vi.fn(),
}))

vi.mock('../../services/auth/credentials', () => ({
  persistCredential: vi.fn(),
}))

vi.mock('../../services/auth/deviceAddition', () => ({
  completeDeviceAdd: vi.fn(),
  resolveDeviceAddAccess: vi.fn(),
}))

vi.mock('../../services/auth/verification', () => ({
  verificationErrorResponse: vi.fn((c, verification) => c.json({ error: verification.error }, 400)),
  verifyRegistration: vi.fn(),
}))

vi.mock('../../services/auth/vault', () => ({
  validateUsernameMatch: vi.fn(),
}))

vi.mock('../../utils/base64', () => ({
  randomBase64Url: vi.fn(),
}))

vi.mock('../../utils/sessionCookie', () => ({
  clearSessionCookie: vi.fn(),
}))

import { generateRegistrationOptions } from '@simplewebauthn/server'
import { isoUint8Array } from '@simplewebauthn/server/helpers'
import {
  countCredentialsByUserId,
  deleteCredentialForUser,
  getCredentialForUser,
  listCredentialsByUserId,
  updateCredentialDeviceName,
} from '../../repositories/credentials'
import { createEnrollment } from '../../repositories/enrollments'
import { getUserById } from '../../repositories/users'
import { requireFreshChallenge, reuseOrPersistChallenge } from '../../services/auth/challenge'
import { persistCredential } from '../../services/auth/credentials'
import { completeDeviceAdd, resolveDeviceAddAccess } from '../../services/auth/deviceAddition'
import { verificationErrorResponse, verifyRegistration } from '../../services/auth/verification'
import { validateUsernameMatch } from '../../services/auth/vault'
import { randomBase64Url } from '../../utils/base64'
import { clearSessionCookie } from '../../utils/sessionCookie'
import { registerAuthDeviceRoutes } from './devices'

function createApp() {
  const app = new Hono<AppEnv>()
  registerAuthDeviceRoutes(app)
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

const credential = {
  id: 'cred-1',
  user_id: 'user-1',
  public_key: 'public-key',
  device_name: 'MacBook Pro',
  counter: 7,
  prf_salt: 'salt-1',
  wrapped_master_key: 'wrapped-1',
  encryption_iv: 'iv-1',
  last_used_at: 5_000,
  created_at: 1_000,
}

const user = {
  id: 'user-1',
  username: 'vault',
  current_challenge: '{"v":1,"c":"stored-challenge","ts":1000}',
  created_at: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(validateUsernameMatch).mockReturnValue(null)
})

describe('registerAuthDeviceRoutes', () => {
  it('lists devices for the authenticated user', async () => {
    vi.mocked(listCredentialsByUserId).mockResolvedValue([
      credential,
      {
        ...credential,
        id: 'cred-2',
        device_name: null,
        last_used_at: null,
        created_at: 900,
      },
    ])

    const response = await createApp().request(
      '/device/list',
      {
        method: 'GET',
        headers: { 'x-user-id': 'user-1' },
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      credentials: [
        {
          id: 'cred-1',
          deviceName: 'MacBook Pro',
          lastUsedAt: 5_000,
          createdAt: 1_000,
        },
        {
          id: 'cred-2',
          deviceName: null,
          lastUsedAt: null,
          createdAt: 900,
        },
      ],
    })
    expect(listCredentialsByUserId).toHaveBeenCalledWith(env.DB, 'user-1')
  })

  it('trims and persists the renamed device name', async () => {
    vi.mocked(getCredentialForUser).mockResolvedValue(credential)

    const response = await createApp().request(
      '/device/rename',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': 'user-1',
        },
        body: JSON.stringify({
          credentialId: 'cred-1',
          deviceName: '  Desk Key  ',
        }),
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(updateCredentialDeviceName).toHaveBeenCalledWith(env.DB, 'user-1', 'cred-1', 'Desk Key')
  })

  it('revokes the selected device and clears the current session cookie when needed', async () => {
    vi.mocked(getCredentialForUser).mockResolvedValue(credential)
    vi.mocked(countCredentialsByUserId).mockResolvedValue(2)

    const response = await createApp().request(
      '/device/cred-1',
      {
        method: 'DELETE',
        headers: {
          'x-user-id': 'user-1',
          'x-credential-id': 'cred-1',
        },
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(deleteCredentialForUser).toHaveBeenCalledWith(env.DB, 'user-1', 'cred-1')
    expect(clearSessionCookie).toHaveBeenCalledTimes(1)
  })

  it('creates an enrollment token for the authenticated user', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000)
    vi.mocked(randomBase64Url).mockReturnValue('enrollment-token')

    const response = await createApp().request(
      '/device/enroll',
      {
        method: 'POST',
        headers: { 'x-user-id': 'user-1' },
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      enrollmentToken: 'enrollment-token',
      expiresAt: 700_000,
    })
    expect(createEnrollment).toHaveBeenCalledWith(env.DB, {
      token: 'enrollment-token',
      user_id: 'user-1',
      created_at: 100_000,
      expires_at: 700_000,
    })
  })

  it('starts device add registration with resolved access and persisted challenge reuse', async () => {
    vi.mocked(resolveDeviceAddAccess).mockResolvedValue({
      userId: 'user-1',
      enrollmentTokenToConsume: 'token-1',
      handshakeCodeToConsume: null,
    })
    vi.mocked(getUserById).mockResolvedValue(user)
    vi.mocked(listCredentialsByUserId).mockResolvedValue([credential])
    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: 'generated-challenge',
      rp: { id: 'example.com', name: 'Inkrypt' },
      user: { id: 'user-1', name: 'vault', displayName: 'vault' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    } as Awaited<ReturnType<typeof generateRegistrationOptions>>)
    vi.mocked(reuseOrPersistChallenge).mockResolvedValue('persisted-challenge')

    const response = await createApp().request(
      '/device/add/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enrollmentToken: 'token-1', username: 'vault' }),
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      options: {
        challenge: 'persisted-challenge',
        rp: { id: 'example.com', name: 'Inkrypt' },
        user: { id: 'user-1', name: 'vault', displayName: 'vault' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      },
    })
    expect(generateRegistrationOptions).toHaveBeenCalledWith({
      rpName: 'Inkrypt',
      rpID: 'example.com',
      userName: 'vault',
      userDisplayName: 'vault',
      userID: new Uint8Array(new TextEncoder().encode('user-1')),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: [{ id: 'cred-1' }],
    } satisfies GenerateRegistrationOptionsOpts)
    expect(isoUint8Array.fromUTF8String).toHaveBeenCalledWith('user-1')
    expect(reuseOrPersistChallenge).toHaveBeenCalledWith(env.DB, user, 'generated-challenge', expect.any(Number))
  })
})
