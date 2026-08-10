import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'ALREADY_CONFIRMED',
  'ALREADY_JOINED',
  'BAD_ORIGIN',
  'CEREMONY_EXPIRED',
  'CEREMONY_NOT_FOUND',
  'CEREMONY_REPLAYED',
  'CODE_CONFLICT',
  'CREDENTIAL_NOT_FOUND',
  'CSRF_BLOCKED',
  'CURSOR_AHEAD',
  'DEVICE_GRANT_CONSUMED',
  'DEVICE_GRANT_EXPIRED',
  'DEVICE_GRANT_NOT_READY',
  'DEVICE_REVOKED',
  'FORBIDDEN',
  'HANDSHAKE_EXPIRED',
  'HANDSHAKE_NOT_FOUND',
  'HANDSHAKE_NOT_READY',
  'INTERNAL_ERROR',
  'INVALID_BODY',
  'INVALID_CURSOR',
  'INVALID_NOTE_ID',
  'INVALID_PUBLIC_KEY',
  'INVALID_SESSION_CODE',
  'INVALID_TOKEN',
  'LAST_DEVICE',
  'MISCONFIGURED',
  'MISSING_CREDENTIAL_ID',
  'MULTI_USER_UNSUPPORTED',
  'NO_CREDENTIALS',
  'NO_JOIN_YET',
  'NOTE_NOT_FOUND',
  'NOT_VERIFIED',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'SETUP_TOKEN_INVALID',
  'UNAUTHORIZED',
  'USER_NOT_FOUND',
  'VAULT_ALREADY_INITIALIZED',
  'VAULT_NOT_INITIALIZED',
  'VERIFY_FAILED',
  'VERSION_CONFLICT',
])

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

export const apiErrorResponseSchema = z.object({
  error: apiErrorCodeSchema,
  message: z.string().optional(),
  requestId: z.string().optional(),
  retryAfter: z.number().int().nonnegative().optional(),
})

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>
