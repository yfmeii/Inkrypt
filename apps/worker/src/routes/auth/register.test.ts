import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GenerateRegistrationOptionsOpts,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import type { AppEnv } from '../../env'

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
}))

vi.mock('@simplewebauthn/server/helpers', () => ({
  isoUint8Array: {
    fromUTF8String: vi.fn((value: string) => new TextEncoder().encode(value)),
  },
}))

vi.mock('../../repositories/credentials', () => ({
  countCredentialsByUserId: vi.fn(),
  listCredentialsByUserId: vi.fn(),
}))

vi.mock('../../services/auth/challenge', () => ({
  createUserWithChallenge: vi.fn(),
  requireFreshChallenge: vi.fn(),
  reuseOrPersistChallenge: vi.fn(),
}))

vi.mock('../../services/auth/credentials', () => ({
  persistCredential: vi.fn(),
}))

vi.mock('../../services/auth/session', () => ({
  finalizeSession: vi.fn(),
}))

vi.mock('../../services/auth/verification', () => ({
  verificationErrorResponse: vi.fn((c, verification) => c.json({ error: verification.error }, 400)),
  verifyRegistration: vi.fn(),
}))

vi.mock('../../services/auth/vault', () => ({
  DEFAULT_VAULT_USERNAME: 'vault',
  loadSingleVaultUser: vi.fn(),
}))

import { generateRegistrationOptions } from '@simplewebauthn/server'
import { isoUint8Array } from '@simplewebauthn/server/helpers'
import { countCredentialsByUserId, listCredentialsByUserId } from '../../repositories/credentials'
import {
  createUserWithChallenge,
  requireFreshChallenge,
  reuseOrPersistChallenge,
} from '../../services/auth/challenge'
import { persistCredential } from '../../services/auth/credentials'
import { finalizeSession } from '../../services/auth/session'
import { verificationErrorResponse, verifyRegistration } from '../../services/auth/verification'
import { loadSingleVaultUser } from '../../services/auth/vault'
import { registerAuthRegistrationRoutes } from './register'

function createApp() {
  const app = new Hono<AppEnv>()
  registerAuthRegistrationRoutes(app)
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

beforeEach(() => {
  vi.clearAllMocks()
})

function makeRegistrationOptions(): PublicKeyCredentialCreationOptionsJSON {
  return {
    challenge: 'generated-challenge',
    rp: { id: 'example.com', name: 'Inkrypt' },
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'vault',
      displayName: 'vault',
    },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  }
}

function encodedUserId(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode('11111111-1111-4111-8111-111111111111')) as Uint8Array<ArrayBuffer>
}

function makeAttestation(id: string): RegistrationResponseJSON {
  return {
    id,
    rawId: id,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: 'client-data',
      attestationObject: 'attestation-object',
      transports: ['internal'],
    },
  }
}

describe('registerAuthRegistrationRoutes', () => {
  it('issues registration options and creates a new vault user challenge', async () => {
    vi.mocked(loadSingleVaultUser).mockResolvedValue(null)
    vi.mocked(generateRegistrationOptions).mockResolvedValue(makeRegistrationOptions())

    const response = await createApp().request(
      '/register/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: '11111111-1111-4111-8111-111111111111', username: 'vault' }),
      },
      env,
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as any
    expect(payload).toMatchObject({
      initialized: false,
      options: {
        challenge: 'generated-challenge',
        rp: { id: 'example.com', name: 'Inkrypt' },
        user: {
          name: 'vault',
          displayName: 'vault',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      },
    })
    expect(isoUint8Array.fromUTF8String).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
    expect(generateRegistrationOptions).toHaveBeenCalledWith({
      rpName: 'Inkrypt',
      rpID: 'example.com',
      userName: 'vault',
      userDisplayName: 'vault',
      userID: encodedUserId(),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: [],
    } satisfies GenerateRegistrationOptionsOpts)
    expect(createUserWithChallenge).toHaveBeenCalledWith(
      env.DB,
      { id: '11111111-1111-4111-8111-111111111111', username: 'vault' },
      'generated-challenge',
      expect.any(Number),
    )
    expect(reuseOrPersistChallenge).not.toHaveBeenCalled()
  })

  it('persists the wrapped key payload and finalizes the session on successful verification', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(60_000)
    vi.mocked(loadSingleVaultUser).mockResolvedValue(vaultUser)
    vi.mocked(requireFreshChallenge).mockReturnValue({ challenge: 'stored-challenge' })
    vi.mocked(countCredentialsByUserId).mockResolvedValue(0)
    vi.mocked(verifyRegistration).mockResolvedValue({
      ok: true,
      value: {
        fmt: 'none',
        aaguid: '00000000-0000-0000-0000-000000000000',
        credential: {
          id: 'cred-1',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 9,
        },
        credentialType: 'public-key',
        attestationObject: new Uint8Array([1]),
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'https://example.com',
        rpID: 'example.com',
      },
    })

    const response = await createApp().request(
      '/register/finish',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attestation: makeAttestation('att-1'),
          prfSalt: 'salt-1',
          wrappedKey: 'wrapped-1',
          iv: 'iv-1',
          deviceName: 'MacBook',
        }),
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(persistCredential).toHaveBeenCalledWith(env.DB, {
      userId: 'user-1',
      credential: {
        id: 'cred-1',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 9,
      },
      deviceName: 'MacBook',
      prfSalt: 'salt-1',
      wrappedKey: 'wrapped-1',
      iv: 'iv-1',
      createdAt: 60_000,
    })
    expect(finalizeSession).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-1',
      credentialId: 'cred-1',
    })
  })

  it('returns verification errors without persisting credentials or session state', async () => {
    vi.mocked(loadSingleVaultUser).mockResolvedValue(vaultUser)
    vi.mocked(requireFreshChallenge).mockReturnValue({ challenge: 'stored-challenge' })
    vi.mocked(countCredentialsByUserId).mockResolvedValue(0)
    const verification = { ok: false as const, error: 'VERIFY_FAILED' as const }
    vi.mocked(verifyRegistration).mockResolvedValue(verification)

    const response = await createApp().request(
      '/register/finish',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attestation: makeAttestation('att-1'),
          prfSalt: 'salt-1',
          wrappedKey: 'wrapped-1',
          iv: 'iv-1',
        }),
      },
      env,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'VERIFY_FAILED' })
    expect(verificationErrorResponse).toHaveBeenCalled()
    expect(persistCredential).not.toHaveBeenCalled()
    expect(finalizeSession).not.toHaveBeenCalled()
    expect(listCredentialsByUserId).not.toHaveBeenCalled()
  })
})
