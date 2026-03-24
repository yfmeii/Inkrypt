import type { Hono } from 'hono'
import { z } from 'zod'
import {
  countCredentialsByUserId,
  listCredentialsByUserId,
} from '../../repositories/credentials'
import type { AppEnv } from '../../env'
import {
  createUserWithChallenge,
  reuseOrPersistChallenge,
} from '../../services/auth/challenge'
import {
  generatePasskeyRegistrationOptions,
  verifyAndPersistRegistration,
} from '../../services/auth/registration'
import { finalizeSession } from '../../services/auth/session'
import { verificationErrorResponse } from '../../services/auth/verification'
import { DEFAULT_VAULT_USERNAME } from '../../services/auth/vault'
import {
  loadInitializedVaultUser,
  loadOptionalVaultUser,
  parseJsonBody,
  requireFreshChallengeValue,
} from './shared'
import { MAX_IV_B64, MAX_PRF_SALT, MAX_WRAPPED_KEY } from './constants'
import { nowMs } from '../shared'

export function registerAuthRegistrationRoutes(app: Hono<AppEnv>): void {
  app.post('/register/start', async (c) => {
    const body = await parseJsonBody(
      c,
      z.object({
        username: z.string().trim().min(1).max(64).optional(),
        userId: z.string().uuid().optional(),
      }),
    )
    if (body instanceof Response) return body

    const existingUser = await loadOptionalVaultUser(c)
    if (existingUser instanceof Response) return existingUser

    let userId: string
    let username: string

    if (existingUser) {
      const credCount = await countCredentialsByUserId(c.env.DB, existingUser.id)
      if (credCount > 0) return c.json({ initialized: true }, 200)
      userId = existingUser.id
      username = existingUser.username
    } else {
      userId = body.userId ?? crypto.randomUUID()
      username = body.username?.trim() || DEFAULT_VAULT_USERNAME
    }

    const options = await generatePasskeyRegistrationOptions(c.env, {
      userId,
      username,
      excludeCredentialIds: existingUser
        ? (await listCredentialsByUserId(c.env.DB, userId)).map((cred) => cred.id)
        : [],
    })

    const createdAt = nowMs()
    if (existingUser) {
      options.challenge = await reuseOrPersistChallenge(c.env.DB, existingUser, options.challenge, createdAt)
    } else {
      await createUserWithChallenge(
        c.env.DB,
        { id: userId, username },
        options.challenge,
        createdAt,
      )
    }

    return c.json({ initialized: false, options }, 200)
  })

  app.post('/register/finish', async (c) => {
    const body = await parseJsonBody(
      c,
      z.object({
        attestation: z.unknown(),
        prfSalt: z.string().min(1).max(MAX_PRF_SALT),
        wrappedKey: z.string().min(1).max(MAX_WRAPPED_KEY),
        iv: z.string().min(1).max(MAX_IV_B64),
        deviceName: z.string().trim().min(1).max(64).optional(),
      }),
    )
    if (body instanceof Response) return body

    const user = await loadInitializedVaultUser(c)
    if (user instanceof Response) return user

    const challenge = requireFreshChallengeValue(c, user.current_challenge, nowMs())
    if (challenge instanceof Response) return challenge

    const credCount = await countCredentialsByUserId(c.env.DB, user.id)
    if (credCount > 0) return c.json({ error: 'VAULT_ALREADY_INITIALIZED' }, 409)

    const verification = await verifyAndPersistRegistration(c.env.DB, c.env, {
      userId: user.id,
      attestation: body.attestation,
      expectedChallenge: challenge,
      deviceName: body.deviceName,
      prfSalt: body.prfSalt,
      wrappedKey: body.wrappedKey,
      iv: body.iv,
      createdAt: nowMs(),
    })
    if (!verification.ok) return verificationErrorResponse(c, verification)

    await finalizeSession(c, { userId: user.id, credentialId: verification.value.credential.id })

    return c.json({ ok: true }, 200)
  })
}
