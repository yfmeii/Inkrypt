import { z } from 'zod'
import type { AppEnv } from './env'

const hostnameSchema = z.string().trim().min(1).refine((value) => {
  try {
    return new URL(`https://${value}`).hostname === value
  } catch {
    return false
  }
}, 'RP_ID must be a hostname')

const originSchema = z.string().url().refine((value) => {
  const url = new URL(value)
  return url.pathname === '/' && !url.search && !url.hash
}, 'Origin must not include a path, query, or fragment')

export const workerConfigSchema = z.object({
  ENVIRONMENT: z.enum(['development', 'production']).default('development'),
  TENANCY_MODE: z.literal('single').default('single'),
  VAULT_USERNAME: z.string().trim().min(1).max(64).default('vault'),
  RP_NAME: z.string().trim().min(1).max(128),
  RP_ID: hostnameSchema,
  ORIGIN: originSchema,
  CORS_ORIGIN: originSchema,
  COOKIE_SAMESITE: z.enum(['Lax', 'Strict']),
  SESSION_SECRET: z.string().refine(
    (value) => new TextEncoder().encode(value).byteLength >= 32,
    'SESSION_SECRET must contain at least 32 bytes',
  ),
  SETUP_TOKEN: z.string().min(16).max(512),
  RELEASE_SHA: z.string().default('development'),
  RATE_LIMIT_DISABLED: z.string().optional(),
}).superRefine((config, context) => {
  const origin = new URL(config.ORIGIN)
  if (origin.hostname !== config.RP_ID) {
    context.addIssue({ code: 'custom', message: 'ORIGIN host must match RP_ID' })
  }
  if (config.CORS_ORIGIN !== config.ORIGIN) {
    context.addIssue({ code: 'custom', message: 'CORS_ORIGIN must match ORIGIN' })
  }
  if (config.ENVIRONMENT === 'production' && origin.protocol !== 'https:') {
    context.addIssue({ code: 'custom', message: 'Production ORIGIN must use HTTPS' })
  }
  if (config.ENVIRONMENT === 'production' && config.RATE_LIMIT_DISABLED === 'true') {
    context.addIssue({ code: 'custom', message: 'Rate limiting cannot be disabled in production' })
  }
})

export type WorkerConfig = z.infer<typeof workerConfigSchema>

export function parseWorkerConfig(bindings: AppEnv['Bindings']) {
  return workerConfigSchema.safeParse(bindings)
}
