import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { D1Database } from '../../cloudflare'
import type { DbHandshake } from '../../repositories/handshakes'

vi.mock('../../repositories/handshakes', () => ({
  createHandshake: vi.fn(),
  deleteHandshake: vi.fn(),
  updateHandshakeJoin: vi.fn(),
  updateHandshakePayload: vi.fn(),
}))

vi.mock('../../utils/handshakeSession', () => ({
  generateSessionCode: vi.fn(),
  generateSessionSecret: vi.fn(),
  hashSessionSecret: vi.fn(),
  normalizeSessionCode: vi.fn(),
}))

vi.mock('./access', () => ({
  isHandshakeOwner: vi.fn(),
  resolveActiveHandshake: vi.fn(),
}))

vi.mock('./actors', () => ({
  buildAliceHandshakeStatus: vi.fn(),
  buildBobHandshakeStatus: vi.fn(),
}))

vi.mock('./lifecycle', () => ({
  hasConfirmedHandshake: vi.fn(),
  hasJoinedHandshake: vi.fn(),
  nextHandshakeExpiry: vi.fn(),
  serializePublicKey: vi.fn(),
}))

vi.mock('./lookup', () => ({
  resolveHandshakeByCodeOrSecret: vi.fn(),
}))

vi.mock('./shared', () => ({
  deriveHandshakeStatus: vi.fn(),
  nowMs: vi.fn(),
}))

import {
  createHandshake,
  updateHandshakeJoin,
  updateHandshakePayload,
} from '../../repositories/handshakes'
import {
  generateSessionCode,
  generateSessionSecret,
  hashSessionSecret,
  normalizeSessionCode,
} from '../../utils/handshakeSession'
import { isHandshakeOwner, resolveActiveHandshake } from './access'
import { buildAliceHandshakeStatus } from './actors'
import { hasConfirmedHandshake, hasJoinedHandshake, nextHandshakeExpiry, serializePublicKey } from './lifecycle'
import { nowMs } from './shared'
import {
  confirmHandshake,
  getHandshakeStatusForAlice,
  initHandshake,
  joinHandshake,
} from './workflows'

const db = {} as D1Database

function makeHandshake(overrides: Partial<DbHandshake> = {}): DbHandshake {
  return {
    session_code: '123456',
    user_id: 'alice-id',
    session_secret_hash: 'secret-hash',
    alice_public_key: '{"alice":true}',
    bob_public_key: null,
    encrypted_payload: null,
    payload_iv: null,
    created_at: 100,
    expires_at: 1_500,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(nowMs).mockReturnValue(1_000)
  vi.mocked(nextHandshakeExpiry).mockReturnValue(2_000)
  vi.mocked(generateSessionCode).mockReturnValue('123456')
  vi.mocked(generateSessionSecret).mockReturnValue('alpha beta gamma delta epsilon zeta eta theta')
  vi.mocked(hashSessionSecret).mockResolvedValue('secret-hash')
  vi.mocked(normalizeSessionCode).mockImplementation((value) => value.replace(/\s+/g, ''))
  vi.mocked(serializePublicKey).mockReturnValue('{"kty":"OKP"}')
  vi.mocked(hasJoinedHandshake).mockReturnValue(false)
  vi.mocked(hasConfirmedHandshake).mockReturnValue(false)
  vi.mocked(isHandshakeOwner).mockReturnValue(true)
  vi.mocked(buildAliceHandshakeStatus).mockReturnValue({
    status: 'waiting_confirm',
    expiresAt: 2_000,
    bobPublicKey: { kty: 'OKP' },
  })
})

describe('workflows', () => {
  it('rejects init when the public key cannot be serialized', async () => {
    vi.mocked(serializePublicKey).mockReturnValueOnce(null)

    const result = await initHandshake({
      db,
      userId: 'alice-id',
      publicKey: { bad: true },
    })

    expect(result).toEqual({ ok: false, error: 'INVALID_PUBLIC_KEY' })
    expect(createHandshake).not.toHaveBeenCalled()
  })

  it('rejects join when the handshake is already joined', async () => {
    vi.mocked(resolveActiveHandshake).mockResolvedValue({ ok: true, handshake: makeHandshake() })
    vi.mocked(hasJoinedHandshake).mockReturnValueOnce(true)

    const result = await joinHandshake({
      db,
      sessionCode: '123456',
      sessionSecret: 'secret',
      publicKey: { bob: true },
    })

    expect(result).toEqual({ ok: false, error: 'ALREADY_JOINED' })
    expect(updateHandshakeJoin).not.toHaveBeenCalled()
  })

  it('rejects join when the public key is invalid', async () => {
    vi.mocked(resolveActiveHandshake).mockResolvedValue({ ok: true, handshake: makeHandshake() })
    vi.mocked(serializePublicKey).mockReturnValueOnce(null)

    const result = await joinHandshake({
      db,
      sessionCode: '123456',
      sessionSecret: 'secret',
      publicKey: { bob: true },
    })

    expect(result).toEqual({ ok: false, error: 'INVALID_PUBLIC_KEY' })
    expect(updateHandshakeJoin).not.toHaveBeenCalled()
  })

  it('stores bob key and extends expiry on join success', async () => {
    vi.mocked(resolveActiveHandshake).mockResolvedValue({ ok: true, handshake: makeHandshake() })
    vi.mocked(serializePublicKey).mockReturnValueOnce('{"kty":"EC","x":"1"}')

    const result = await joinHandshake({
      db,
      sessionCode: '123456',
      sessionSecret: 'secret',
      publicKey: { bob: true },
    })

    expect(result).toEqual({ ok: true, value: { expiresAt: 2_000 } })
    expect(nextHandshakeExpiry).toHaveBeenCalledWith(1_000)
    expect(updateHandshakeJoin).toHaveBeenCalledWith(db, '123456', '{"kty":"EC","x":"1"}', 2_000)
  })

  it('hides alice status from non-owners', async () => {
    vi.mocked(resolveActiveHandshake).mockResolvedValue({ ok: true, handshake: makeHandshake() })
    vi.mocked(isHandshakeOwner).mockReturnValueOnce(false)

    const result = await getHandshakeStatusForAlice({
      db,
      sessionCode: '123456',
      sessionSecret: 'secret',
      userId: 'other-user',
    })

    expect(result).toEqual({ ok: false, error: 'HANDSHAKE_NOT_FOUND' })
    expect(buildAliceHandshakeStatus).not.toHaveBeenCalled()
  })

  it('rejects confirm when the caller does not own the handshake', async () => {
    vi.mocked(resolveActiveHandshake).mockResolvedValue({ ok: true, handshake: makeHandshake() })
    vi.mocked(isHandshakeOwner).mockReturnValueOnce(false)

    const result = await confirmHandshake({
      db,
      sessionCode: '123456',
      sessionSecret: 'secret',
      userId: 'other-user',
      encryptedPayload: 'cipher',
      iv: 'iv',
    })

    expect(result).toEqual({ ok: false, error: 'FORBIDDEN' })
    expect(updateHandshakePayload).not.toHaveBeenCalled()
  })

  it('rejects confirm before anyone joins', async () => {
    vi.mocked(resolveActiveHandshake).mockResolvedValue({ ok: true, handshake: makeHandshake() })
    vi.mocked(hasJoinedHandshake).mockReturnValueOnce(false)

    const result = await confirmHandshake({
      db,
      sessionCode: '123456',
      sessionSecret: 'secret',
      userId: 'alice-id',
      encryptedPayload: 'cipher',
      iv: 'iv',
    })

    expect(result).toEqual({ ok: false, error: 'NO_JOIN_YET' })
    expect(updateHandshakePayload).not.toHaveBeenCalled()
  })

  it('rejects confirm when payload is already stored', async () => {
    vi.mocked(resolveActiveHandshake).mockResolvedValue({ ok: true, handshake: makeHandshake() })
    vi.mocked(hasJoinedHandshake).mockReturnValueOnce(true)
    vi.mocked(hasConfirmedHandshake).mockReturnValueOnce(true)

    const result = await confirmHandshake({
      db,
      sessionCode: '123456',
      sessionSecret: 'secret',
      userId: 'alice-id',
      encryptedPayload: 'cipher',
      iv: 'iv',
    })

    expect(result).toEqual({ ok: false, error: 'ALREADY_CONFIRMED' })
    expect(updateHandshakePayload).not.toHaveBeenCalled()
  })

  it('stores encrypted payload and extends expiry on confirm success', async () => {
    vi.mocked(resolveActiveHandshake).mockResolvedValue({ ok: true, handshake: makeHandshake() })
    vi.mocked(hasJoinedHandshake).mockReturnValueOnce(true)

    const result = await confirmHandshake({
      db,
      sessionCode: '123456',
      sessionSecret: 'secret',
      userId: 'alice-id',
      encryptedPayload: 'cipher',
      iv: 'iv',
    })

    expect(result).toEqual({ ok: true, value: { expiresAt: 2_000 } })
    expect(nextHandshakeExpiry).toHaveBeenCalledWith(1_000)
    expect(updateHandshakePayload).toHaveBeenCalledWith(db, '123456', 'cipher', 'iv', 2_000)
  })
})
