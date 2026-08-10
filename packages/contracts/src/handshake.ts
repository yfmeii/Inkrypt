import { z } from 'zod'

const base64UrlCoordinateSchema = z.string().regex(/^[A-Za-z0-9_-]+$/).min(40).max(48)

export const p256PublicJwkSchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: base64UrlCoordinateSchema,
  y: base64UrlCoordinateSchema,
  ext: z.boolean().optional(),
  key_ops: z.array(z.string()).optional(),
}).strict()

export type P256PublicJwk = z.infer<typeof p256PublicJwkSchema>

export const handshakeStatusSchema = z.enum(['waiting_join', 'waiting_confirm', 'finished'])

export const handshakeInitResponseSchema = z.object({
  sessionCode: z.string().min(1).max(32),
  sessionSecret: z.string().min(1).max(256),
  expiresAt: z.number().int().positive(),
})

export const handshakeMutationResponseSchema = z.object({
  ok: z.literal(true),
  expiresAt: z.number().int().positive(),
})

export const bobHandshakeStatusResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('waiting_join'),
    expiresAt: z.number().int().positive(),
    alicePublicKey: p256PublicJwkSchema,
    encryptedPayload: z.null(),
    iv: z.null(),
  }),
  z.object({
    status: z.literal('waiting_confirm'),
    expiresAt: z.number().int().positive(),
    alicePublicKey: p256PublicJwkSchema,
    encryptedPayload: z.null(),
    iv: z.null(),
  }),
  z.object({
    status: z.literal('finished'),
    expiresAt: z.number().int().positive(),
    alicePublicKey: p256PublicJwkSchema,
    encryptedPayload: z.string().min(1).max(1024),
    iv: z.string().min(1).max(128),
  }),
])

export const aliceHandshakeStatusResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('waiting_join'),
    expiresAt: z.number().int().positive(),
    bobPublicKey: z.null(),
  }),
  z.object({
    status: z.literal('waiting_confirm'),
    expiresAt: z.number().int().positive(),
    bobPublicKey: p256PublicJwkSchema,
  }),
  z.object({
    status: z.literal('finished'),
    expiresAt: z.number().int().positive(),
    bobPublicKey: p256PublicJwkSchema,
  }),
])
