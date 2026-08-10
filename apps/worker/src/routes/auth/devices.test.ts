import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../../env'

vi.mock('../../middleware/requireAuth', () => ({
  requireAuth: async (context: any, next: () => Promise<void>) => {
    const userId = context.req.header('x-user-id')
    if (!userId) return context.json({ error: 'UNAUTHORIZED' }, 401)
    context.set('userId', userId)
    context.set('credentialId', context.req.header('x-credential-id') ?? undefined)
    await next()
  },
}))

vi.mock('../../repositories/authCeremonies', () => ({ getAuthCeremony: vi.fn() }))
vi.mock('../../repositories/authTransactions', () => ({ completeDeviceRegistration: vi.fn() }))
vi.mock('../../repositories/credentials', () => ({
  deleteCredentialUnlessLast: vi.fn(),
  getCredentialForUser: vi.fn(),
  listCredentialsByUserId: vi.fn(),
  updateCredentialDeviceName: vi.fn(),
}))
vi.mock('../../repositories/deviceGrants', () => ({
  claimDeviceGrant: vi.fn(),
  getDeviceGrantById: vi.fn(),
}))
vi.mock('../../repositories/users', () => ({ getUserById: vi.fn() }))
vi.mock('../../services/auth/ceremonies', () => ({
  claimCeremonyForVerification: vi.fn(),
  markCeremonyFailed: vi.fn(),
  startAuthCeremony: vi.fn(),
}))
vi.mock('../../services/auth/deviceAddition', () => ({ resolveDeviceAddAccess: vi.fn() }))
vi.mock('../../services/auth/deviceGrants', () => ({ issueDeviceGrant: vi.fn() }))
vi.mock('../../services/auth/registration', () => ({ generatePasskeyRegistrationOptions: vi.fn() }))
vi.mock('../../services/auth/session', () => ({ finalizeSession: vi.fn() }))
vi.mock('../../services/auth/verification', () => ({
  verificationErrorResponse: vi.fn((context, verification) => context.json({ error: verification.error }, 400)),
  verifyRegistration: vi.fn(),
}))
vi.mock('../../utils/base64', () => ({ bytesToBase64Url: vi.fn(() => 'public-key') }))
vi.mock('../../utils/sessionCookie', () => ({ clearSessionCookie: vi.fn() }))

import { getAuthCeremony } from '../../repositories/authCeremonies'
import { completeDeviceRegistration } from '../../repositories/authTransactions'
import {
  deleteCredentialUnlessLast,
  getCredentialForUser,
  listCredentialsByUserId,
  updateCredentialDeviceName,
} from '../../repositories/credentials'
import { claimDeviceGrant, getDeviceGrantById } from '../../repositories/deviceGrants'
import { getUserById } from '../../repositories/users'
import {
  claimCeremonyForVerification,
  startAuthCeremony,
} from '../../services/auth/ceremonies'
import { resolveDeviceAddAccess } from '../../services/auth/deviceAddition'
import { issueDeviceGrant } from '../../services/auth/deviceGrants'
import { generatePasskeyRegistrationOptions } from '../../services/auth/registration'
import { finalizeSession } from '../../services/auth/session'
import { verifyRegistration } from '../../services/auth/verification'
import { clearSessionCookie } from '../../utils/sessionCookie'
import { registerAuthDeviceRoutes } from './devices'

const env = {
  DB: {},
  RATE_LIMITER: {},
  RP_NAME: 'Inkrypt',
  RP_ID: 'example.com',
  ORIGIN: 'https://example.com',
  CORS_ORIGIN: 'https://example.com',
  COOKIE_SAMESITE: 'Lax',
  SESSION_SECRET: 'a'.repeat(32),
  SETUP_TOKEN: 'setup-token-value',
} as AppEnv['Bindings']

const credential = {
  id: 'cred-1', user_id: 'user-1', public_key: 'public-key', device_name: 'Laptop',
  counter: 1, prf_salt: 'salt', wrapped_master_key: 'wrapped', encryption_iv: 'iv',
  last_used_at: 5, created_at: 1,
}

function createApp() {
  const app = new Hono<AppEnv>()
  registerAuthDeviceRoutes(app)
  return app
}

beforeEach(() => vi.clearAllMocks())

describe('device routes', () => {
  it('lists active credentials as devices', async () => {
    vi.mocked(listCredentialsByUserId).mockResolvedValue([credential])
    const response = await createApp().request('/device/list', {
      headers: { 'x-user-id': 'user-1' },
    }, env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      credentials: [{ id: 'cred-1', deviceName: 'Laptop', lastUsedAt: 5, createdAt: 1 }],
    })
  })

  it('atomically preserves the final credential', async () => {
    vi.mocked(getCredentialForUser).mockResolvedValue(credential)
    vi.mocked(deleteCredentialUnlessLast).mockResolvedValue(false)
    const response = await createApp().request('/device/cred-1', {
      method: 'DELETE',
      headers: { 'x-user-id': 'user-1', 'x-credential-id': 'cred-1' },
    }, env)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'LAST_DEVICE' })
    expect(clearSessionCookie).not.toHaveBeenCalled()
  })

  it('normalizes device names', async () => {
    vi.mocked(getCredentialForUser).mockResolvedValue(credential)
    const response = await createApp().request('/device/rename', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'user-1' },
      body: JSON.stringify({ credentialId: 'cred-1', deviceName: '  Desk Key  ' }),
    }, env)
    expect(response.status).toBe(200)
    expect(updateCredentialDeviceName).toHaveBeenCalledWith(env.DB, 'user-1', 'cred-1', 'Desk Key')
  })

  it('issues a hash-at-rest enrollment grant', async () => {
    vi.mocked(issueDeviceGrant).mockResolvedValue({
      secret: 'raw-secret',
      grant: { id: 'grant-1', expires_at: 700_000 } as never,
    })
    const response = await createApp().request('/device/enroll', {
      method: 'POST',
      headers: { 'x-user-id': 'user-1', 'x-credential-id': 'cred-1' },
    }, env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      enrollmentToken: 'raw-secret',
      grantSecret: 'raw-secret',
      grantId: 'grant-1',
      expiresAt: 700_000,
    })
    expect(issueDeviceGrant).toHaveBeenCalledWith(env.DB, {
      vaultId: 'user-1', source: 'enrollment', issuedByCredentialId: 'cred-1', state: 'ready',
    })
  })

  it('starts device registration with a grant-bound ceremony', async () => {
    vi.mocked(resolveDeviceAddAccess).mockResolvedValue({
      userId: 'user-1',
      deviceGrant: { id: 'grant-1' } as never,
    })
    vi.mocked(getUserById).mockResolvedValue({ id: 'user-1', username: 'vault' } as never)
    vi.mocked(listCredentialsByUserId).mockResolvedValue([credential])
    vi.mocked(generatePasskeyRegistrationOptions).mockResolvedValue({ challenge: 'challenge' } as never)
    vi.mocked(startAuthCeremony).mockResolvedValue({ id: 'ceremony-1', expires_at: 5000 } as never)

    const response = await createApp().request('/device/add/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grantSecret: 'raw-secret' }),
    }, env)
    expect(response.status).toBe(200)
    expect(startAuthCeremony).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      vaultId: 'user-1', purpose: 'device_add', deviceGrantId: 'grant-1', challenge: 'challenge',
    }))
  })

  it('claims the grant and atomically completes device registration', async () => {
    const ceremony = {
      id: '11111111-1111-4111-8111-111111111111', vault_id: 'user-1',
      purpose: 'device_add', device_grant_id: 'grant-1', challenge: 'challenge',
    }
    vi.mocked(getAuthCeremony).mockResolvedValue(ceremony as never)
    vi.mocked(claimCeremonyForVerification).mockResolvedValue({
      ceremony, responseHash: 'response-hash',
    } as never)
    vi.mocked(getDeviceGrantById).mockResolvedValue({ id: 'grant-1', expires_at: Date.now() + 1000 } as never)
    vi.mocked(verifyRegistration).mockResolvedValue({
      ok: true,
      value: { credential: { id: 'cred-2', publicKey: new Uint8Array([1]), counter: 0 } },
    } as never)
    vi.mocked(claimDeviceGrant).mockResolvedValue(true)
    vi.mocked(completeDeviceRegistration).mockResolvedValue(true)

    const response = await createApp().request('/device/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ceremonyId: ceremony.id,
        attestation: { id: 'cred-2' },
        prfSalt: 'salt', wrappedKey: 'wrapped', iv: 'iv',
      }),
    }, env)
    expect(response.status).toBe(200)
    expect(claimDeviceGrant).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      grantId: 'grant-1', ceremonyId: ceremony.id,
    }))
    expect(completeDeviceRegistration).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      id: 'cred-2', deviceGrantId: 'grant-1', ceremonyId: ceremony.id,
    }))
    expect(finalizeSession).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-1', credentialId: 'cred-2',
    })
  })
})
