import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../../env'

vi.mock('../../repositories/authCeremonies', () => ({ getAuthCeremony: vi.fn() }))
vi.mock('../../repositories/authTransactions', () => ({ completeVaultRegistration: vi.fn() }))
vi.mock('../../repositories/credentials', () => ({
  countCredentialsByUserId: vi.fn(),
  listCredentialsByUserId: vi.fn(),
}))
vi.mock('../../repositories/users', () => ({ createUser: vi.fn(), getUserById: vi.fn() }))
vi.mock('../../services/auth/bootstrap', () => ({ verifySetupToken: vi.fn() }))
vi.mock('../../services/auth/ceremonies', () => ({
  claimCeremonyForVerification: vi.fn(),
  markCeremonyFailed: vi.fn(),
  startAuthCeremony: vi.fn(),
}))
vi.mock('../../services/auth/registration', () => ({ generatePasskeyRegistrationOptions: vi.fn() }))
vi.mock('../../services/auth/session', () => ({ finalizeSession: vi.fn() }))
vi.mock('../../services/auth/verification', () => ({
  verificationErrorResponse: vi.fn((context, verification) => context.json({ error: verification.error }, 400)),
  verifyRegistration: vi.fn(),
}))
vi.mock('../../services/auth/vault', () => ({
  DEFAULT_VAULT_USERNAME: 'vault',
  loadSingleVaultUser: vi.fn(),
}))
vi.mock('../../utils/base64', () => ({ bytesToBase64Url: vi.fn(() => 'public-key') }))

import { getAuthCeremony } from '../../repositories/authCeremonies'
import { completeVaultRegistration } from '../../repositories/authTransactions'
import { countCredentialsByUserId, listCredentialsByUserId } from '../../repositories/credentials'
import { createUser } from '../../repositories/users'
import { verifySetupToken } from '../../services/auth/bootstrap'
import { claimCeremonyForVerification, startAuthCeremony } from '../../services/auth/ceremonies'
import { generatePasskeyRegistrationOptions } from '../../services/auth/registration'
import { finalizeSession } from '../../services/auth/session'
import { verifyRegistration } from '../../services/auth/verification'
import { loadSingleVaultUser } from '../../services/auth/vault'
import { registerAuthRegistrationRoutes } from './register'

const env = {
  DB: {}, RATE_LIMITER: {}, RP_NAME: 'Inkrypt', RP_ID: 'example.com',
  ORIGIN: 'https://example.com', CORS_ORIGIN: 'https://example.com', COOKIE_SAMESITE: 'Lax',
  SESSION_SECRET: 'a'.repeat(32), SETUP_TOKEN: 'setup-token-value',
} as AppEnv['Bindings']

function createApp() {
  const app = new Hono<AppEnv>()
  registerAuthRegistrationRoutes(app)
  return app
}

beforeEach(() => vi.clearAllMocks())

describe('registration ceremonies', () => {
  it('requires setup authorization and creates a vault_create ceremony', async () => {
    vi.mocked(loadSingleVaultUser)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'user-1', username: 'vault', created_at: 1,
      })
    vi.mocked(verifySetupToken).mockResolvedValue('valid')
    vi.mocked(listCredentialsByUserId).mockResolvedValue([])
    vi.mocked(generatePasskeyRegistrationOptions).mockResolvedValue({ challenge: 'challenge' } as never)
    vi.mocked(startAuthCeremony).mockResolvedValue({ id: 'ceremony-1', expires_at: 5000 } as never)

    const response = await createApp().request('/register/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setupToken: 'setup-token-value' }),
    }, env)
    expect(response.status).toBe(200)
    expect(createUser).toHaveBeenCalledWith(env.DB, expect.objectContaining({ username: 'vault' }))
    expect(startAuthCeremony).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      purpose: 'vault_create', challenge: 'challenge',
    }))
  })

  it('inserts the first credential and completes its ceremony atomically', async () => {
    const ceremonyId = '11111111-1111-4111-8111-111111111111'
    const ceremony = { id: ceremonyId, vault_id: 'user-1', purpose: 'vault_create', challenge: 'challenge' }
    vi.mocked(loadSingleVaultUser).mockResolvedValue({
      id: 'user-1', username: 'vault', created_at: 1,
    })
    vi.mocked(getAuthCeremony).mockResolvedValue(ceremony as never)
    vi.mocked(claimCeremonyForVerification).mockResolvedValue({ ceremony, responseHash: 'hash' } as never)
    vi.mocked(countCredentialsByUserId).mockResolvedValue(0)
    vi.mocked(verifyRegistration).mockResolvedValue({
      ok: true,
      value: { credential: { id: 'cred-1', publicKey: new Uint8Array([1]), counter: 0 } },
    } as never)
    vi.mocked(completeVaultRegistration).mockResolvedValue(true)

    const response = await createApp().request('/register/finish', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ceremonyId, attestation: { id: 'cred-1' }, prfSalt: 'salt', wrappedKey: 'wrapped', iv: 'iv',
      }),
    }, env)
    expect(response.status).toBe(200)
    expect(completeVaultRegistration).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      id: 'cred-1', vaultId: 'user-1', ceremonyId,
    }))
    expect(finalizeSession).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-1', credentialId: 'cred-1',
    })
  })
})
