import type { AppEnv } from '../env'
import { getCredentialForUser } from '../db'
import { getVerifiedSessionFromCookie } from './sessionCookie'

export type ActiveSession = {
  userId: string
  credentialId: string
  issuedAt?: number
  expiresAt?: number
}

export type ActiveSessionResult =
  | { kind: 'none' }
  | { kind: 'active'; session: ActiveSession }
  | { kind: 'revoked'; userId: string; credentialId: string }

export async function getActiveSessionFromCookie(
  c: any,
  env: AppEnv['Bindings'],
): Promise<ActiveSessionResult> {
  const claims = await getVerifiedSessionFromCookie(c as any, env)
  if (!claims) return { kind: 'none' }

  const credentialId = claims.credentialId
  if (!credentialId) return { kind: 'none' }

  const cred = await getCredentialForUser(env.DB, claims.userId, credentialId)
  if (!cred) return { kind: 'revoked', userId: claims.userId, credentialId }

  return {
    kind: 'active',
    session: {
      userId: claims.userId,
      credentialId,
      issuedAt: claims.issuedAt,
      expiresAt: claims.expiresAt,
    },
  }
}

