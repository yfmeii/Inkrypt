import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'

function parseAllowedOrigins(env: AppEnv['Bindings']): string[] {
  const raw = (env.CORS_ORIGIN ?? '').trim()
  if (raw) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  const fallback = (env.ORIGIN ?? '').trim()
  return fallback ? [fallback] : []
}

export const csrfProtect: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return await next()

  const secFetchSite = c.req.header('Sec-Fetch-Site')?.trim().toLowerCase()
  if (secFetchSite === 'cross-site') return c.json({ error: 'CSRF_BLOCKED' }, 403)

  const origin = c.req.header('Origin')?.trim()
  if (!origin) return await next()

  const allowed = parseAllowedOrigins(c.env)
  if (allowed.length > 0 && allowed.includes(origin)) return await next()

  return c.json({ error: 'BAD_ORIGIN' }, 403)
}

