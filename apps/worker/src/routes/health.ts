import {
  INKRYPT_API_VERSION,
  INKRYPT_DATABASE_SCHEMA_VERSION,
} from '@inkrypt/contracts/version'
import type { Context } from 'hono'
import type { AppEnv } from '../env'
import { parseWorkerConfig } from '../config'

type CheckStatus = 'ok' | 'error'

export function livenessResponse() {
  return {
    status: 'ok' as const,
    service: 'inkrypt-worker' as const,
    apiVersion: INKRYPT_API_VERSION,
  }
}

export async function deepHealthResponse(context: Context<AppEnv>): Promise<Response> {
  const checks: Record<'config' | 'database' | 'migrations' | 'tenant' | 'rateLimiter', CheckStatus> = {
    config: 'error',
    database: 'error',
    migrations: 'error',
    tenant: 'error',
    rateLimiter: 'error',
  }
  let tenantState: 'empty' | 'initialized' | 'invalid' = 'invalid'

  checks.config = parseWorkerConfig(context.env).success ? 'ok' : 'error'

  try {
    const databaseResult = await context.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()
    checks.database = databaseResult?.ok === 1 ? 'ok' : 'error'

    const migration = await context.env.DB
      .prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1')
      .first<{ name: string }>()
    checks.migrations = migration?.name === INKRYPT_DATABASE_SCHEMA_VERSION ? 'ok' : 'error'

    const userCount = await context.env.DB
      .prepare('SELECT COUNT(1) AS count FROM users')
      .first<{ count: number }>()
    if (userCount?.count === 0) tenantState = 'empty'
    else if (userCount?.count === 1) tenantState = 'initialized'
    checks.tenant = tenantState === 'invalid' ? 'error' : 'ok'
  } catch {
    // Individual check statuses remain error without exposing database details.
  }

  try {
    const durableObjectId = context.env.RATE_LIMITER.idFromName('inkrypt-health')
    const response = await context.env.RATE_LIMITER.get(durableObjectId).fetch('https://rate-limiter/health')
    checks.rateLimiter = response.ok ? 'ok' : 'error'
  } catch {
    checks.rateLimiter = 'error'
  }

  const healthy = Object.values(checks).every((status) => status === 'ok')
  return context.json({
    status: healthy ? 'ok' as const : 'error' as const,
    service: 'inkrypt-worker' as const,
    apiVersion: INKRYPT_API_VERSION,
    release: context.env.RELEASE_SHA ?? 'development',
    databaseSchema: INKRYPT_DATABASE_SCHEMA_VERSION,
    tenant: { mode: 'single' as const, state: tenantState },
    checks,
  }, healthy ? 200 : 503)
}
