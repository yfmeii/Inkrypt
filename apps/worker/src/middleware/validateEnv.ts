import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'
import { parseWorkerConfig } from '../config'

export const validateEnv: MiddlewareHandler<AppEnv> = async (c, next) => {
  const config = parseWorkerConfig(c.env)
  if (!config.success) return c.json({ error: 'MISCONFIGURED' }, 500)
  await next()
}
