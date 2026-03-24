import { describe, expect, test } from 'vitest'
import { buildAliceHandshakeStatus, buildBobHandshakeStatus } from '../../../../worker/src/services/handshake/actors'
import { isHandshakeOwner } from '../../../../worker/src/services/handshake/access'
import {
  hasConfirmedHandshake,
  hasJoinedHandshake,
  nextHandshakeExpiry,
  serializePublicKey,
} from '../../../../worker/src/services/handshake/lifecycle'
import { JOIN_TTL_MS } from '../../../../worker/src/services/handshake/shared'

describe('handshake helper behavior', () => {
  test('buildBobHandshakeStatus exposes parsed key and withholds payload until finished', () => {
    expect(
      buildBobHandshakeStatus({
        alice_public_key: '{"kty":"EC"}',
        encrypted_payload: 'ciphertext',
        payload_iv: 'iv-value',
        bob_public_key: null,
        expires_at: 123,
      }),
    ).toEqual({
      status: 'waiting_join',
      expiresAt: 123,
      alicePublicKey: { kty: 'EC' },
      encryptedPayload: null,
      iv: null,
    })

    expect(
      buildBobHandshakeStatus({
        alice_public_key: 'not-json',
        encrypted_payload: 'ciphertext',
        payload_iv: 'iv-value',
        bob_public_key: '{"joined":true}',
        expires_at: 456,
      }),
    ).toEqual({
      status: 'finished',
      expiresAt: 456,
      alicePublicKey: 'not-json',
      encryptedPayload: 'ciphertext',
      iv: 'iv-value',
    })
  })

  test('buildAliceHandshakeStatus shapes bob progress from stored public key state', () => {
    expect(
      buildAliceHandshakeStatus({
        bob_public_key: null,
        encrypted_payload: null,
        payload_iv: null,
        expires_at: 11,
      }),
    ).toEqual({
      status: 'waiting_join',
      expiresAt: 11,
      bobPublicKey: null,
    })

    expect(
      buildAliceHandshakeStatus({
        bob_public_key: '{"x":"1"}',
        encrypted_payload: null,
        payload_iv: null,
        expires_at: 22,
      }),
    ).toEqual({
      status: 'waiting_confirm',
      expiresAt: 22,
      bobPublicKey: { x: '1' },
    })
  })

  test('lifecycle helpers reflect join, confirm, ttl, and key serialization rules', () => {
    expect(hasJoinedHandshake({ bob_public_key: null })).toBe(false)
    expect(hasJoinedHandshake({ bob_public_key: '{}' })).toBe(true)

    expect(hasConfirmedHandshake({ encrypted_payload: null, payload_iv: null })).toBe(false)
    expect(hasConfirmedHandshake({ encrypted_payload: 'ciphertext', payload_iv: null })).toBe(true)
    expect(hasConfirmedHandshake({ encrypted_payload: null, payload_iv: 'iv-only' })).toBe(true)

    expect(nextHandshakeExpiry(1_000)).toBe(1_000 + JOIN_TTL_MS)
    expect(serializePublicKey({ kty: 'EC', crv: 'P-256' })).toBe('{"kty":"EC","crv":"P-256"}')
  })

  test('serializePublicKey rejects circular and oversized values', () => {
    const circular: { self?: unknown } = {}
    circular.self = circular

    expect(serializePublicKey(circular)).toBeNull()
    expect(serializePublicKey({ key: 'x'.repeat(5_000) })).toBeNull()
  })

  test('isHandshakeOwner compares the stored owner id exactly', () => {
    expect(isHandshakeOwner({ user_id: 'alice' }, 'alice')).toBe(true)
    expect(isHandshakeOwner({ user_id: 'alice' }, 'bob')).toBe(false)
  })
})
