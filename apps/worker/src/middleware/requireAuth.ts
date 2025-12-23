import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../env'
import { clearSessionCookie, maybeRefreshSessionCookie, SESSION_COOKIE_NAME } from '../utils/sessionCookie'
import { getActiveSessionFromCookie } from '../utils/activeSession'
export { SESSION_COOKIE_NAME } from '../utils/sessionCookie'

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const res = await getActiveSessionFromCookie(c as any, c.env)
  if (res.kind === 'revoked') {
    clearSessionCookie(c as any)
    return c.json({ error: 'DEVICE_REVOKED' }, 401)
  }
  if (res.kind !== 'active') return c.json({ error: 'UNAUTHORIZED' }, 401)

  await maybeRefreshSessionCookie(c as any, c.env, res.session)

  c.set('userId', res.session.userId)
  c.set('credentialId', res.session.credentialId)

  await next()
}
