import { z } from 'zod'

export const authCeremonyPurposeSchema = z.enum(['vault_create', 'login', 'device_add'])
export const authCeremonyIdSchema = z.string().uuid()

export const authSessionResponseSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false) }),
  z.object({
    authenticated: z.literal(true),
    vaultId: z.string().uuid(),
    credentialId: z.string().min(1),
    deviceName: z.string().nullable(),
    expiresAt: z.number().int().positive(),
  }),
])

export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>

export const registerStartRequestSchema = z.object({
  setupToken: z.string().min(1).max(512).optional(),
  clientRequestId: z.string().uuid().optional(),
}).strict()

export const authCeremonyResponseFieldsSchema = z.object({
  ceremonyId: authCeremonyIdSchema,
  ceremonyExpiresAt: z.number().int().positive(),
  protocolVersion: z.literal(2),
})

const webAuthnOptionsSchema = z.record(z.string(), z.unknown())

export const registerStartResponseSchema = z.discriminatedUnion('initialized', [
  z.object({ initialized: z.literal(true) }),
  z.object({
    initialized: z.literal(false),
    options: webAuthnOptionsSchema,
    protocolVersion: z.literal(2),
    ceremonyId: authCeremonyIdSchema,
    ceremonyExpiresAt: z.number().int().positive(),
  }),
])

export const loginStartResponseSchema = z.object({
  options: webAuthnOptionsSchema,
  prfSalt: z.string().min(1).optional(),
  credentialId: z.string().min(1).optional(),
  deviceName: z.string().nullable().optional(),
  credentialPrfSalts: z.record(z.string(), z.string().min(1)).optional(),
  protocolVersion: z.literal(2),
  ceremonyId: authCeremonyIdSchema,
  ceremonyExpiresAt: z.number().int().positive(),
})

export const loginFinishResponseSchema = z.object({
  wrappedKey: z.string().min(1),
  iv: z.string().min(1),
  credentialId: z.string().min(1),
  deviceName: z.string().nullable(),
})

export const deviceAddStartResponseSchema = z.object({
  options: webAuthnOptionsSchema,
  protocolVersion: z.literal(2),
  ceremonyId: authCeremonyIdSchema,
  ceremonyExpiresAt: z.number().int().positive(),
  grantId: z.string().uuid(),
})

export const okResponseSchema = z.object({ ok: z.literal(true) })

export const deviceListResponseSchema = z.object({
  credentials: z.array(z.object({
    id: z.string().min(1),
    deviceName: z.string().nullable(),
    lastUsedAt: z.number().int().nonnegative().nullable(),
    createdAt: z.number().int().nonnegative().nullable(),
  })),
})

export const deviceGrantSecretSchema = z.string().min(16).max(512)
