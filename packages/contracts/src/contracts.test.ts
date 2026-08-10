import { describe, expect, it } from 'vitest'
import { apiErrorResponseSchema } from './errors'
import {
  aliceHandshakeStatusResponseSchema,
  bobHandshakeStatusResponseSchema,
  p256PublicJwkSchema,
} from './handshake'
import { noteChangesResponseSchema, saveNoteRequestSchema } from './notes'

describe('shared runtime contracts', () => {
  it('accepts the versioned note changes response', () => {
    expect(noteChangesResponseSchema.safeParse({
      notes: [],
      next_cursor: 'opaque-cursor',
      has_more: false,
    }).success).toBe(true)
  })

  it('rejects unknown note save fields', () => {
    expect(saveNoteRequestSchema.safeParse({
      base_version: 0,
      encrypted_data: 'ciphertext',
      data_iv: 'initialization-vector',
      is_deleted: false,
      plaintext: 'must-not-cross-the-boundary',
    }).success).toBe(false)
  })

  it('requires complete P-256 public coordinates', () => {
    expect(p256PublicJwkSchema.safeParse({ kty: 'EC', crv: 'P-256' }).success).toBe(false)
  })

  it('requires encrypted payload fields only after a handshake finishes', () => {
    const publicKey = {
      kty: 'EC',
      crv: 'P-256',
      x: 'A'.repeat(43),
      y: 'B'.repeat(43),
    }

    expect(bobHandshakeStatusResponseSchema.safeParse({
      status: 'waiting_confirm',
      expiresAt: 100,
      alicePublicKey: publicKey,
      encryptedPayload: null,
      iv: null,
    }).success).toBe(true)
    expect(bobHandshakeStatusResponseSchema.safeParse({
      status: 'finished',
      expiresAt: 100,
      alicePublicKey: publicKey,
      encryptedPayload: null,
      iv: null,
    }).success).toBe(false)
  })

  it('requires Bob public key after the Alice handshake leaves waiting state', () => {
    expect(aliceHandshakeStatusResponseSchema.safeParse({
      status: 'waiting_join',
      expiresAt: 100,
      bobPublicKey: null,
    }).success).toBe(true)
    expect(aliceHandshakeStatusResponseSchema.safeParse({
      status: 'waiting_confirm',
      expiresAt: 100,
      bobPublicKey: null,
    }).success).toBe(false)
  })

  it('rejects error codes outside the shared vocabulary', () => {
    expect(apiErrorResponseSchema.safeParse({ error: 'UNAUTHORIZED' }).success).toBe(true)
    expect(apiErrorResponseSchema.safeParse({ error: 'AD_HOC_ERROR' }).success).toBe(false)
  })
})
