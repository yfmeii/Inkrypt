import type { Context } from 'hono'
import type { AppEnv } from '../../env'
import { setUserChallenge } from '../../repositories/users'
import { getActiveSessionFromCookie } from '../../utils/activeSession'
import { clearSessionCookie, setSessionCookie } from '../../utils/sessionCookie'

export async function tryGetSession(
  c: Context<AppEnv>,
): Promise<{ userId: string; credentialId?: string } | null> {
  const res = await getActiveSessionFromCookie(c as any, c.env)
  if (res.kind === 'revoked') {
    clearSessionCookie(c as any)
    return null
  }
  if (res.kind !== 'active') return null
  return { userId: res.session.userId, credentialId: res.session.credentialId }
}

export async function finalizeSession(
  c: Context<AppEnv>,
  input: { userId: string; credentialId: string },
): Promise<void> {
  await setUserChallenge(c.env.DB, input.userId, null)
  await setSessionCookie(c as any, c.env, input)
}
