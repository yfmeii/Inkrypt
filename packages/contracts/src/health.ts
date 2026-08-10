import { z } from 'zod'

export const healthCheckStatusSchema = z.enum(['ok', 'error'])

export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('inkrypt-worker'),
  apiVersion: z.number().int().positive(),
})

export const deepHealthResponseSchema = z.object({
  status: healthCheckStatusSchema,
  service: z.literal('inkrypt-worker'),
  apiVersion: z.number().int().positive(),
  release: z.string(),
  databaseSchema: z.string(),
  tenant: z.object({
    mode: z.literal('single'),
    state: z.enum(['empty', 'initialized', 'invalid']),
  }),
  checks: z.object({
    config: healthCheckStatusSchema,
    database: healthCheckStatusSchema,
    migrations: healthCheckStatusSchema,
    tenant: healthCheckStatusSchema,
    rateLimiter: healthCheckStatusSchema,
  }),
})
