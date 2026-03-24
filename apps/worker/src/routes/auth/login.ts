import { generateAuthenticationOptions } from '@simplewebauthn/server'
import type { Hono } from 'hono'
import { z } from 'zod'
import {
  getCredentialForUser,
  listCredentialsByUserId,
  updateCredentialUsage,
} from '../../repositories/credentials'
import type { AppEnv } from '../../env'
import { reuseOrPersistChallenge } from '../../services/auth/challenge'
import {
  buildLoginFinishResponse,
  buildLoginStartResponse,
} from '../../services/auth/credentials'
import { finalizeSession } from '../../services/auth/session'
import {
  verificationErrorResponse,
  verifyAuthentication,
} from '../../services/auth/verification'
import {
  ensureUsernameMatches,
  loadInitializedVaultUser,
  parseJsonBody,
  requireFreshChallengeValue,
} from './shared'
import { nowMs } from '../shared'

export function registerAuthLoginRoutes(app: Hono<AppEnv>): void {
  app.post('/login/start', async (c) => {
    const body = await parseJsonBody(
      c,
      z.object({
        username: z.string().trim().min(1).max(64).optional(),
        credentialId: z.string().min(1).max(512).optional(),
      }),
    )
    if (body instanceof Response) return body

    const user = await loadInitializedVaultUser(c)
    if (user instanceof Response) return user
    const usernameMismatch = ensureUsernameMatches(c, user.username, body.username)
    if (usernameMismatch) return usernameMismatch

    const creds = await listCredentialsByUserId(c.env.DB, user.id)
    if (creds.length === 0) return c.json({ error: 'NO_CREDENTIALS' }, 400)

    const selected =
      (body.credentialId ? creds.find((x) => x.id === body.credentialId) : null) ??
      creds[0]

    const options = await generateAuthenticationOptions({
      rpID: c.env.RP_ID,
      userVerification: 'required',
      allowCredentials: [{ id: selected.id }],
    })

    options.challenge = await reuseOrPersistChallenge(c.env.DB, user, options.challenge, nowMs())

    return c.json(buildLoginStartResponse(options, selected), 200)
  })

  app.post('/login/finish', async (c) => {
    const body = await parseJsonBody(
      c,
      z.object({
        username: z.string().trim().min(1).max(64).optional(),
        assertion: z.unknown(),
      }),
    )
    if (body instanceof Response) return body

    const user = await loadInitializedVaultUser(c)
    if (user instanceof Response) return user
    const usernameMismatch = ensureUsernameMatches(c, user.username, body.username)
    if (usernameMismatch) return usernameMismatch

    const challenge = requireFreshChallengeValue(c, user.current_challenge, nowMs())
    if (challenge instanceof Response) return challenge

    const assertion = body.assertion as any
    const credentialId = assertion?.id
    if (typeof credentialId !== 'string' || !credentialId) {
      return c.json({ error: 'MISSING_CREDENTIAL_ID' }, 400)
    }

    const credential = await getCredentialForUser(c.env.DB, user.id, credentialId)
    if (!credential) return c.json({ error: 'CREDENTIAL_NOT_FOUND' }, 404)

    const verification = await verifyAuthentication(c.env, assertion, challenge, credential)
    if (!verification.ok) return verificationErrorResponse(c, verification)

    const ts = nowMs()
    await updateCredentialUsage(c.env.DB, credential.id, verification.value.newCounter, ts)
    await finalizeSession(c, { userId: user.id, credentialId: credential.id })

    return c.json(buildLoginFinishResponse(credential), 200)
  })
}
