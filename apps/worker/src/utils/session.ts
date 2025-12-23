import { SignJWT, jwtVerify } from 'jose'

export type SessionClaims = {
  userId: string
  credentialId?: string
}

const encoder = new TextEncoder()

function getSecret(secret: string): Uint8Array {
  return encoder.encode(secret)
}

export async function signSession(
  sessionSecret: string,
  claims: SessionClaims,
  ttlSeconds: number,
): Promise<string> {
  const ttl = Math.max(60, Math.floor(ttlSeconds))
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({ cid: claims.credentialId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(getSecret(sessionSecret))
}

export async function verifySession(
  sessionSecret: string,
  token: string,
): Promise<(SessionClaims & { issuedAt?: number; expiresAt?: number }) | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(sessionSecret))
    if (typeof payload.sub !== 'string' || !payload.sub) return null

    const credentialId = typeof payload.cid === 'string' ? payload.cid : undefined
    const issuedAt = typeof payload.iat === 'number' && Number.isFinite(payload.iat) ? payload.iat : undefined
    const expiresAt = typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : undefined
    return { userId: payload.sub, credentialId, issuedAt, expiresAt }
  } catch {
    return null
  }
}
