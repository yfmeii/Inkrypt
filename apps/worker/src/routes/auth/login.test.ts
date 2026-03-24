import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AuthenticationResponseJSON,
  GenerateAuthenticationOptionsOpts,
  PublicKeyCredentialDescriptorJSON,
} from '@simplewebauthn/server'
import type { AppEnv } from '../../env'

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(),
}))

vi.mock('../../repositories/credentials', () => ({
  getCredentialForUser: vi.fn(),
  listCredentialsByUserId: vi.fn(),
  updateCredentialUsage: vi.fn(),
}))

vi.mock('../../services/auth/challenge', () => ({
  requireFreshChallenge: vi.fn(),
  reuseOrPersistChallenge: vi.fn(),
}))

vi.mock('../../services/auth/session', () => ({
  finalizeSession: vi.fn(),
}))

vi.mock('../../services/auth/verification', () => ({
  verificationErrorResponse: vi.fn((c, verification) => c.json({ error: verification.error }, 400)),
  verifyAuthentication: vi.fn(),
}))

vi.mock('../../services/auth/vault', () => ({
  loadSingleVaultUser: vi.fn(),
  validateUsernameMatch: vi.fn(),
}))

import { generateAuthenticationOptions } from '@simplewebauthn/server'
import {
  getCredentialForUser,
  listCredentialsByUserId,
  updateCredentialUsage,
} from '../../repositories/credentials'
import { reuseOrPersistChallenge, requireFreshChallenge } from '../../services/auth/challenge'
import { finalizeSession } from '../../services/auth/session'
import { verificationErrorResponse, verifyAuthentication } from '../../services/auth/verification'
import { loadSingleVaultUser, validateUsernameMatch } from '../../services/auth/vault'
import { registerAuthLoginRoutes } from './login'

function createApp() {
  const app = new Hono<AppEnv>()
  registerAuthLoginRoutes(app)
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

const vaultUser = {
  id: 'user-1',
  username: 'vault',
  current_challenge: '{"v":1,"c":"stored-challenge","ts":1000}',
  created_at: 1,
}

const credential = {
  id: 'cred-1',
  user_id: 'user-1',
  public_key: 'public-key',
  device_name: 'MacBook',
  counter: 7,
  prf_salt: 'salt-1',
  wrapped_master_key: 'wrapped-1',
  encryption_iv: 'iv-1',
  last_used_at: 5,
  created_at: 4,
}

function makeAllowCredential(id: string): PublicKeyCredentialDescriptorJSON {
  return { id, type: 'public-key' }
}

function makeAssertion(id: string): AuthenticationResponseJSON {
  return {
    id,
    rawId: id,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: 'client-data',
      authenticatorData: 'auth-data',
      signature: 'signature',
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadSingleVaultUser).mockResolvedValue(vaultUser)
  vi.mocked(validateUsernameMatch).mockReturnValue(null)
})

describe('registerAuthLoginRoutes', () => {
  it('issues login options using the persisted challenge and selected credential', async () => {
    vi.mocked(listCredentialsByUserId).mockResolvedValue([credential])
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({
      challenge: 'generated-challenge',
      rpID: 'example.com',
      allowCredentials: [makeAllowCredential('cred-1')],
    } as Awaited<ReturnType<typeof generateAuthenticationOptions>>)
    vi.mocked(reuseOrPersistChallenge).mockResolvedValue('persisted-challenge')

    const response = await createApp().request(
      '/login/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'vault', credentialId: 'cred-1' }),
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      options: {
        challenge: 'persisted-challenge',
        rpID: 'example.com',
        allowCredentials: [makeAllowCredential('cred-1')],
      },
      prfSalt: 'salt-1',
      credentialId: 'cred-1',
      deviceName: 'MacBook',
    })
    expect(generateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: 'example.com',
      userVerification: 'required',
      allowCredentials: [{ id: 'cred-1' }],
    } satisfies GenerateAuthenticationOptionsOpts)
    expect(reuseOrPersistChallenge).toHaveBeenCalledWith(env.DB, vaultUser, 'generated-challenge', expect.any(Number))
  })

  it('updates credential usage and finalizes the session on successful verification', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(50_000)
    vi.mocked(requireFreshChallenge).mockReturnValue({ challenge: 'stored-challenge' })
    vi.mocked(getCredentialForUser).mockResolvedValue(credential)
    vi.mocked(verifyAuthentication).mockResolvedValue({
      ok: true,
      value: {
        credentialID: 'cred-1',
        newCounter: 11,
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'https://example.com',
        rpID: 'example.com',
      },
    })

    const response = await createApp().request(
      '/login/finish',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'vault',
          assertion: makeAssertion('cred-1'),
        }),
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      wrappedKey: 'wrapped-1',
      iv: 'iv-1',
      credentialId: 'cred-1',
      deviceName: 'MacBook',
    })
    expect(updateCredentialUsage).toHaveBeenCalledWith(env.DB, 'cred-1', 11, 50_000)
    expect(finalizeSession).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-1',
      credentialId: 'cred-1',
    })
  })

  it('returns verification errors without mutating session state', async () => {
    vi.mocked(requireFreshChallenge).mockReturnValue({ challenge: 'stored-challenge' })
    vi.mocked(getCredentialForUser).mockResolvedValue(credential)
    const verification = { ok: false as const, error: 'NOT_VERIFIED' as const }
    vi.mocked(verifyAuthentication).mockResolvedValue(verification)

    const response = await createApp().request(
      '/login/finish',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assertion: makeAssertion('cred-1') }),
      },
      env,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'NOT_VERIFIED' })
    expect(verificationErrorResponse).toHaveBeenCalled()
    expect(updateCredentialUsage).not.toHaveBeenCalled()
    expect(finalizeSession).not.toHaveBeenCalled()
  })
})
