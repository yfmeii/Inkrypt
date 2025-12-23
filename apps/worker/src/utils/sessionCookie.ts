import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppEnv } from '../env'
import { signSession, verifySession, type SessionClaims } from './session'

export const SESSION_COOKIE_NAME = 'inkrypt_session'

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
const REFRESH_THRESHOLD_SECONDS = 60 * 60 * 24

function normalizeSameSite(value: string | undefined): 'Strict' | 'Lax' | 'None' {
  if (!value) return 'Lax'
  if (value === 'Strict' || value === 'Lax' || value === 'None') return value
  return 'Lax'
}

export async function setSessionCookie(
  c: Parameters<typeof setCookie>[0],
  env: AppEnv['Bindings'],
  claims: SessionClaims,
): Promise<void> {
  const token = await signSession(env.SESSION_SECRET, claims, DEFAULT_SESSION_TTL_SECONDS)
  const isSecure = new URL(c.req.url).protocol === 'https:'
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: normalizeSameSite(env.COOKIE_SAMESITE),
    path: '/',
    maxAge: DEFAULT_SESSION_TTL_SECONDS,
  })
}

export function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' })
}

export async function getVerifiedSessionFromCookie(
  c: Parameters<typeof getCookie>[0],
  env: AppEnv['Bindings'],
): Promise<(SessionClaims & { issuedAt?: number; expiresAt?: number }) | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (!token) return null
  return await verifySession(env.SESSION_SECRET, token)
}

export async function maybeRefreshSessionCookie(
  c: Parameters<typeof setCookie>[0],
  env: AppEnv['Bindings'],
  session: SessionClaims & { expiresAt?: number },
): Promise<void> {
  const exp = session.expiresAt
  if (!exp) return
  const now = Math.floor(Date.now() / 1000)
  if (exp - now > REFRESH_THRESHOLD_SECONDS) return
  await setSessionCookie(c, env, { userId: session.userId, credentialId: session.credentialId })
}

