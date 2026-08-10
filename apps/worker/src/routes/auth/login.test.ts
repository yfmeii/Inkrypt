import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../../env'

vi.mock('@simplewebauthn/server', () => ({ generateAuthenticationOptions: vi.fn() }))

vi.mock('../../repositories/authCeremonies', () => ({ getAuthCeremony: vi.fn() }))
vi.mock('../../repositories/authTransactions', () => ({ completeLoginCeremony: vi.fn() }))
vi.mock('../../repositories/credentials', () => ({
  getCredentialForUser: vi.fn(),
  listCredentialsByUserId: vi.fn(),
}))
vi.mock('../../services/auth/ceremonies', () => ({
  claimCeremonyForVerification: vi.fn(),
  markCeremonyFailed: vi.fn(),
  startAuthCeremony: vi.fn(),
}))
vi.mock('../../services/auth/session', () => ({ finalizeSession: vi.fn() }))
vi.mock('../../services/auth/verification', () => ({
  verificationErrorResponse: vi.fn((context, verification) => context.json({ error: verification.error }, 400)),
  verifyAuthentication: vi.fn(),
}))
vi.mock('../../services/auth/vault', () => ({ loadSingleVaultUser: vi.fn() }))

import { getAuthCeremony } from '../../repositories/authCeremonies'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { completeLoginCeremony } from '../../repositories/authTransactions'
import { getCredentialForUser, listCredentialsByUserId } from '../../repositories/credentials'
import { claimCeremonyForVerification, startAuthCeremony } from '../../services/auth/ceremonies'
import { finalizeSession } from '../../services/auth/session'
import { verifyAuthentication } from '../../services/auth/verification'
import { loadSingleVaultUser } from '../../services/auth/vault'
import { registerAuthLoginRoutes } from './login'

const env = {
  DB: {}, RATE_LIMITER: {}, RP_NAME: 'Inkrypt', RP_ID: 'example.com',
  ORIGIN: 'https://example.com', CORS_ORIGIN: 'https://example.com', COOKIE_SAMESITE: 'Lax',
  SESSION_SECRET: 'a'.repeat(32), SETUP_TOKEN: 'setup-token-value',
} as AppEnv['Bindings']

const vaultUser = { id: 'user-1', username: 'vault' }
const credential = {
  id: 'cred-1', user_id: 'user-1', public_key: 'public-key', device_name: 'Laptop',
  counter: 7, prf_salt: 'salt-1', wrapped_master_key: 'wrapped-1', encryption_iv: 'iv-1',
}

function createApp() {
  const app = new Hono<AppEnv>()
  registerAuthLoginRoutes(app)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadSingleVaultUser).mockResolvedValue(vaultUser as never)
})

describe('login ceremonies', () => {
  it('returns one PRF salt per active credential', async () => {
    vi.mocked(listCredentialsByUserId).mockResolvedValue([credential as never])
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({ challenge: 'challenge' } as never)
    vi.mocked(startAuthCeremony).mockResolvedValue({ id: 'ceremony-1', expires_at: 5000 } as never)

    const response = await createApp().request('/login/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: { prfEvalByCredential: true } }),
    }, env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      credentialPrfSalts: { 'cred-1': 'salt-1' },
      ceremonyId: 'ceremony-1', protocolVersion: 2,
    })
    expect(startAuthCeremony).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      purpose: 'login', challenge: 'challenge',
    }))
  })

  it('counter-CASes the credential and completes login ceremony atomically', async () => {
    const ceremonyId = '11111111-1111-4111-8111-111111111111'
    const ceremony = { id: ceremonyId, vault_id: 'user-1', purpose: 'login', challenge: 'challenge' }
    vi.mocked(getCredentialForUser).mockResolvedValue(credential as never)
    vi.mocked(getAuthCeremony).mockResolvedValue(ceremony as never)
    vi.mocked(claimCeremonyForVerification).mockResolvedValue({ ceremony, responseHash: 'hash' } as never)
    vi.mocked(verifyAuthentication).mockResolvedValue({ ok: true, value: { newCounter: 8 } } as never)
    vi.mocked(completeLoginCeremony).mockResolvedValue(true)

    const response = await createApp().request('/login/finish', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ceremonyId, assertion: { id: 'cred-1' } }),
    }, env)
    expect(response.status).toBe(200)
    expect(completeLoginCeremony).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      ceremonyId, credentialId: 'cred-1', previousCounter: 7, newCounter: 8,
    }))
    expect(finalizeSession).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-1', credentialId: 'cred-1',
    })
  })

  it('supports the preferred-credential fallback path', async () => {
    vi.mocked(listCredentialsByUserId).mockResolvedValue([credential as never])
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({ challenge: 'challenge' } as never)
    vi.mocked(startAuthCeremony).mockResolvedValue({ id: 'ceremony-1', expires_at: 5000 } as never)

    const response = await createApp().request('/login/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentialId: 'cred-1' }),
    }, env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      credentialId: 'cred-1', prfSalt: 'salt-1', deviceName: 'Laptop',
    })
  })
})
