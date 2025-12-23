type StoredBucket = { resetAt: number; count: number }

type CheckRequest = {
  limit: number
  windowMs: number
  cost?: number
}

type CheckResponse = {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
  retryAfter: number
}

const BUCKET_STORAGE_KEY = 'bucket_v1'

function clampInt(value: unknown, min: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.floor(n))
}

export class RateLimiterDO implements DurableObject {
  private state: DurableObjectState
  private bucket: StoredBucket | null = null

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

    let body: CheckRequest | null = null
    try {
      body = (await request.json()) as CheckRequest
    } catch {
      return new Response('Bad Request', { status: 400 })
    }

    const limit = clampInt(body?.limit, 1, 1)
    const windowMs = clampInt(body?.windowMs, 1000, 60_000)
    const cost = clampInt(body?.cost ?? 1, 1, 1)

    const now = Date.now()

    let bucket = this.bucket
    if (!bucket) {
      bucket = (await this.state.storage.get<StoredBucket>(BUCKET_STORAGE_KEY)) ?? null
    }
    if (!bucket || bucket.resetAt <= now) bucket = { resetAt: now + windowMs, count: 0 }

    bucket.count += cost
    this.bucket = bucket
    await this.state.storage.put(BUCKET_STORAGE_KEY, bucket)

    const remaining = Math.max(0, limit - bucket.count)
    const allowed = bucket.count <= limit
    const retryAfter = allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))

    const res: CheckResponse = {
      allowed,
      limit,
      remaining,
      resetAt: bucket.resetAt,
      retryAfter,
    }

    return Response.json(res, { status: allowed ? 200 : 429 })
  }
}

