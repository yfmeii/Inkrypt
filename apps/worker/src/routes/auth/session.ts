import type { Hono } from 'hono'
import type { AppEnv } from '../../env'
import { getCredentialForUser } from '../../repositories/credentials'
import { getActiveSessionFromCookie } from '../../utils/activeSession'
import { clearSessionCookie } from '../../utils/sessionCookie'

export function registerAuthSessionRoutes(app: Hono<AppEnv>): void {
  app.get('/session', async (context) => {
    const result = await getActiveSessionFromCookie(context as any, context.env)
    if (result.kind === 'none') return context.json({ authenticated: false as const }, 200)
    if (result.kind === 'revoked') {
      clearSessionCookie(context as any)
      return context.json({ error: 'DEVICE_REVOKED' }, 401)
    }

    const credential = await getCredentialForUser(
      context.env.DB,
      result.session.userId,
      result.session.credentialId,
    )
    if (!credential) {
      clearSessionCookie(context as any)
      return context.json({ error: 'DEVICE_REVOKED' }, 401)
    }

    return context.json({
      authenticated: true as const,
      vaultId: result.session.userId,
      credentialId: result.session.credentialId,
      deviceName: credential.device_name,
      expiresAt: result.session.expiresAt ?? 0,
    }, 200)
  })
}
