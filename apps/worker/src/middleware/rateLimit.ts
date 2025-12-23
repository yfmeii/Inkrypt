import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'

type Bucket = { resetAt: number; count: number }

const buckets = new Map<string, Bucket>()
let lastCleanupAt = 0

type RateLimitResult = {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
  retryAfter: number
}

function normalizeBooleanEnv(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function getClientIp(c: any): string | null {
  const raw =
    (typeof c.req.header === 'function' ? c.req.header('CF-Connecting-IP') : null) ??
    (typeof c.req.header === 'function' ? c.req.header('X-Forwarded-For') : null) ??
    null
  if (!raw) return null
  const first = raw.split(',')[0]?.trim()
  return first || null
}

function cleanupExpired(now: number): void {
  if (now - lastCleanupAt < 60_000) return
  lastCleanupAt = now
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key)
  }
}

function clampInt(value: unknown, min: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.floor(n))
}

async function checkRateLimitLocal(args: {
  key: string
  limit: number
  windowMs: number
  cost: number
}): Promise<RateLimitResult> {
  const now = Date.now()
  cleanupExpired(now)

  const existing = buckets.get(args.key)

  const resetAt = existing && existing.resetAt > now ? existing.resetAt : now + args.windowMs
  const count = existing && existing.resetAt > now ? existing.count + args.cost : args.cost
  buckets.set(args.key, { resetAt, count })

  const remaining = Math.max(0, args.limit - count)
  const allowed = count <= args.limit
  const retryAfter = allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000))

  return { allowed, limit: args.limit, remaining, resetAt, retryAfter }
}

async function checkRateLimitGlobal(args: {
  namespace: DurableObjectNamespace
  key: string
  limit: number
  windowMs: number
  cost: number
}): Promise<RateLimitResult> {
  const id = args.namespace.idFromName(args.key)
  const stub = args.namespace.get(id)
  const resp = await stub.fetch('https://ratelimiter/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ limit: args.limit, windowMs: args.windowMs, cost: args.cost }),
  })

  let data: any = null
  try {
    data = await resp.json()
  } catch {
    data = null
  }

  const limit = clampInt(data?.limit, 1, args.limit)
  const remaining = clampInt(data?.remaining, 0, 0)
  const resetAt = clampInt(data?.resetAt, 0, Date.now())
  const retryAfter = clampInt(data?.retryAfter, 0, 0)
  const allowed = resp.status !== 429

  return { allowed, limit, remaining, resetAt, retryAfter }
}

export async function enforceRateLimit(
  c: any,
  args: {
    id: string
    limit: number
    windowMs: number
    cost?: number
    keyParts?: Array<string | null | undefined>
  },
): Promise<Response | null> {
  if (c.req.method === 'OPTIONS') return null
  if (normalizeBooleanEnv(c.env.RATE_LIMIT_DISABLED)) return null

  const ip = getClientIp(c) ?? 'unknown'
  const limit = Math.max(1, Math.floor(args.limit))
  const windowMs = Math.max(1000, Math.floor(args.windowMs))
  const cost = Math.max(1, Math.floor(args.cost ?? 1))
  const key = [args.id, ip, ...(args.keyParts ?? [])].filter(Boolean).join(':')

  let res: RateLimitResult
  try {
    res = await checkRateLimitGlobal({
      namespace: c.env.RATE_LIMITER,
      key,
      limit,
      windowMs,
      cost,
    })
  } catch (err) {
    console.error('rateLimit:global_failed', err)
    res = await checkRateLimitLocal({ key, limit, windowMs, cost })
  }

  c.header('X-RateLimit-Limit', String(res.limit))
  c.header('X-RateLimit-Remaining', String(res.remaining))
  c.header('X-RateLimit-Reset', String(Math.ceil(res.resetAt / 1000)))

  if (!res.allowed) {
    c.header('Retry-After', String(res.retryAfter))
    return c.json({ error: 'RATE_LIMITED', retryAfter: res.retryAfter }, 429)
  }

  return null
}

export function rateLimit(args: {
  id: string
  limit: number
  windowMs: number
  keyParts?: (c: any) => Array<string | null | undefined>
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const blocked = await enforceRateLimit(c, {
      id: args.id,
      limit: args.limit,
      windowMs: args.windowMs,
      keyParts: args.keyParts ? args.keyParts(c) : undefined,
    })
    if (blocked) return blocked
    await next()
  }
}
