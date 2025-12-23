import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'

let checked = false
let errorMessage: string | null = null

function validateSessionSecret(secret: string | undefined): string | null {
  if (!secret || !secret.trim()) return 'SESSION_SECRET is missing'
  const bytes = new TextEncoder().encode(secret)
  if (bytes.byteLength < 32) return 'SESSION_SECRET is too short (need 32+ bytes of high-entropy secret)'
  return null
}

export const validateEnv: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!checked) {
    checked = true
    errorMessage = validateSessionSecret(c.env.SESSION_SECRET)
  }

  if (errorMessage) return c.json({ error: 'MISCONFIGURED', message: errorMessage }, 500)
  await next()
}

