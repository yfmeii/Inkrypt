import { generateAuthenticationOptions } from '@simplewebauthn/server'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../env'
import { completeLoginCeremony } from '../../repositories/authTransactions'
import {
  getCredentialForUser,
  listCredentialsByUserId,
} from '../../repositories/credentials'
import {
  claimCeremonyForVerification,
  markCeremonyFailed,
  startAuthCeremony,
} from '../../services/auth/ceremonies'
import {
  buildLoginFinishResponse,
  buildLoginStartResponse,
} from '../../services/auth/credentials'
import { finalizeSession } from '../../services/auth/session'
import {
  verificationErrorResponse,
  verifyAuthentication,
} from '../../services/auth/verification'
import { loadInitializedVaultUser, parseJsonBody } from './shared'

const loginStartRequestSchema = z.object({
  credentialId: z.string().min(1).max(512).optional(),
  clientRequestId: z.string().uuid().optional(),
  capabilities: z.object({
    prfEvalByCredential: z.boolean().optional(),
  }).strict().optional(),
}).strict()

const loginFinishRequestSchema = z.object({
  ceremonyId: z.string().uuid(),
  assertion: z.unknown(),
}).strict()

export function registerAuthLoginRoutes(app: Hono<AppEnv>): void {
  app.post('/login/start', async (context) => {
    const body = await parseJsonBody(context, loginStartRequestSchema)
    if (body instanceof Response) return body

    const vaultUser = await loadInitializedVaultUser(context)
    if (vaultUser instanceof Response) return vaultUser

    const credentials = await listCredentialsByUserId(context.env.DB, vaultUser.id)
    if (credentials.length === 0) return context.json({ error: 'NO_CREDENTIALS' }, 400)

    const supportsMultiCredentialPrf = body.capabilities?.prfEvalByCredential === true
    const preferredCredential = body.credentialId
      ? credentials.find((credential) => credential.id === body.credentialId) ?? null
      : null
    const selectedCredential = preferredCredential ?? credentials[0]
    const allowedCredentials = supportsMultiCredentialPrf
      ? credentials.map((credential) => ({ id: credential.id }))
      : [{ id: selectedCredential.id }]

    const options = await generateAuthenticationOptions({
      rpID: context.env.RP_ID,
      userVerification: 'required',
      allowCredentials: allowedCredentials,
    })
    const ceremony = await startAuthCeremony(context.env.DB, {
      vaultId: vaultUser.id,
      purpose: 'login',
      challenge: options.challenge,
      preferredCredentialId: supportsMultiCredentialPrf ? null : selectedCredential.id,
      clientRequestId: body.clientRequestId,
    })

    if (!supportsMultiCredentialPrf) {
      return context.json({
        ...buildLoginStartResponse(options, selectedCredential),
        protocolVersion: 2 as const,
        ceremonyId: ceremony.id,
        ceremonyExpiresAt: ceremony.expires_at,
      }, 200)
    }

    return context.json({
      options,
      credentialPrfSalts: Object.fromEntries(
        credentials.map((credential) => [credential.id, credential.prf_salt]),
      ),
      protocolVersion: 2 as const,
      ceremonyId: ceremony.id,
      ceremonyExpiresAt: ceremony.expires_at,
    }, 200)
  })

  app.post('/login/finish', async (context) => {
    const body = await parseJsonBody(context, loginFinishRequestSchema)
    if (body instanceof Response) return body

    const vaultUser = await loadInitializedVaultUser(context)
    if (vaultUser instanceof Response) return vaultUser

    const assertion = body.assertion as { id?: unknown }
    const credentialId = typeof assertion?.id === 'string' ? assertion.id : null
    if (!credentialId) return context.json({ error: 'MISSING_CREDENTIAL_ID' }, 400)

    const claimed = await claimCeremonyForVerification(context, {
      ceremonyId: body.ceremonyId,
      vaultId: vaultUser.id,
      purpose: 'login',
      response: body.assertion,
    })
    if (claimed instanceof Response) return claimed
    if (
      claimed.ceremony.preferred_credential_id &&
      claimed.ceremony.preferred_credential_id !== credentialId
    ) {
      await markCeremonyFailed(context.env.DB, {
        ceremonyId: body.ceremonyId,
        responseHash: claimed.responseHash,
        failureCode: 'CREDENTIAL_NOT_FOUND',
      })
      return context.json({ error: 'CREDENTIAL_NOT_FOUND' }, 404)
    }

    const credential = await getCredentialForUser(context.env.DB, vaultUser.id, credentialId)
    if (!credential) return context.json({ error: 'CREDENTIAL_NOT_FOUND' }, 404)

    const verification = await verifyAuthentication(
      context.env,
      body.assertion,
      claimed.ceremony.challenge,
      credential,
    )
    if (!verification.ok) {
      await markCeremonyFailed(context.env.DB, {
        ceremonyId: body.ceremonyId,
        responseHash: claimed.responseHash,
        failureCode: verification.error,
      })
      return verificationErrorResponse(context, verification)
    }

    const completed = await completeLoginCeremony(context.env.DB, {
      ceremonyId: body.ceremonyId,
      vaultId: vaultUser.id,
      credentialId: credential.id,
      previousCounter: credential.counter ?? 0,
      newCounter: verification.value.newCounter,
      responseHash: claimed.responseHash,
      now: Date.now(),
    })
    if (!completed) return context.json({ error: 'CEREMONY_REPLAYED' }, 409)

    await finalizeSession(context, {
      userId: vaultUser.id,
      credentialId: credential.id,
    })
    return context.json(buildLoginFinishResponse(credential), 200)
  })
}
