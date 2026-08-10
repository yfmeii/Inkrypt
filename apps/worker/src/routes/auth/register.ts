import { registerStartRequestSchema } from '@inkrypt/contracts/auth'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../env'
import { completeVaultRegistration } from '../../repositories/authTransactions'
import {
  countCredentialsByUserId,
  listCredentialsByUserId,
} from '../../repositories/credentials'
import { createUser } from '../../repositories/users'
import { verifySetupToken } from '../../services/auth/bootstrap'
import {
  claimCeremonyForVerification,
  markCeremonyFailed,
  startAuthCeremony,
} from '../../services/auth/ceremonies'
import { generatePasskeyRegistrationOptions } from '../../services/auth/registration'
import { finalizeSession } from '../../services/auth/session'
import {
  verificationErrorResponse,
  verifyRegistration,
} from '../../services/auth/verification'
import { DEFAULT_VAULT_USERNAME } from '../../services/auth/vault'
import { bytesToBase64Url } from '../../utils/base64'
import { MAX_IV_B64, MAX_PRF_SALT, MAX_WRAPPED_KEY } from './constants'
import {
  loadInitializedVaultUser,
  loadOptionalVaultUser,
  parseJsonBody,
} from './shared'

const registerFinishRequestSchema = z.object({
  ceremonyId: z.string().uuid(),
  attestation: z.unknown(),
  prfSalt: z.string().min(1).max(MAX_PRF_SALT),
  wrappedKey: z.string().min(1).max(MAX_WRAPPED_KEY),
  iv: z.string().min(1).max(MAX_IV_B64),
  deviceName: z.string().trim().min(1).max(64).optional(),
}).strict()

export function registerAuthRegistrationRoutes(app: Hono<AppEnv>): void {
  app.post('/register/start', async (context) => {
    const body = await parseJsonBody(context, registerStartRequestSchema)
    if (body instanceof Response) return body

    let vaultUser = await loadOptionalVaultUser(context)
    if (vaultUser instanceof Response) return vaultUser

    if (vaultUser) {
      const credentialCount = await countCredentialsByUserId(context.env.DB, vaultUser.id)
      if (credentialCount > 0) return context.json({ initialized: true }, 200)
    }

    const setupTokenResult = await verifySetupToken(context.env, body.setupToken)
    if (setupTokenResult === 'misconfigured') {
      return context.json({ error: 'MISCONFIGURED' }, 500)
    }
    if (setupTokenResult !== 'valid') {
      return context.json({ error: 'SETUP_TOKEN_INVALID' }, 403)
    }

    if (!vaultUser) {
      const createdAt = Date.now()
      const vaultId = crypto.randomUUID()
      const username = context.env.VAULT_USERNAME?.trim() || DEFAULT_VAULT_USERNAME
      try {
        await createUser(context.env.DB, {
          id: vaultId,
          username,
          created_at: createdAt,
        })
      } catch {
        // A concurrent setup request may have created the singleton vault first.
      }

      vaultUser = await loadOptionalVaultUser(context)
      if (vaultUser instanceof Response) return vaultUser
      if (!vaultUser) return context.json({ error: 'INTERNAL_ERROR' }, 500)
    }

    const options = await generatePasskeyRegistrationOptions(context.env, {
      userId: vaultUser.id,
      username: vaultUser.username,
      excludeCredentialIds: (await listCredentialsByUserId(context.env.DB, vaultUser.id))
        .map((credential) => credential.id),
    })
    const ceremony = await startAuthCeremony(context.env.DB, {
      vaultId: vaultUser.id,
      purpose: 'vault_create',
      challenge: options.challenge,
      clientRequestId: body.clientRequestId,
    })

    return context.json({
      initialized: false,
      options,
      protocolVersion: 2 as const,
      ceremonyId: ceremony.id,
      ceremonyExpiresAt: ceremony.expires_at,
    }, 200)
  })

  app.post('/register/finish', async (context) => {
    const body = await parseJsonBody(context, registerFinishRequestSchema)
    if (body instanceof Response) return body

    const vaultUser = await loadInitializedVaultUser(context)
    if (vaultUser instanceof Response) return vaultUser

    const claimed = await claimCeremonyForVerification(context, {
      ceremonyId: body.ceremonyId,
      vaultId: vaultUser.id,
      purpose: 'vault_create',
      response: body.attestation,
    })
    if (claimed instanceof Response) return claimed

    const verification = await verifyRegistration(
      context.env,
      body.attestation,
      claimed.ceremony.challenge,
    )
    if (!verification.ok) {
      await markCeremonyFailed(context.env.DB, {
        ceremonyId: body.ceremonyId,
        responseHash: claimed.responseHash,
        failureCode: verification.error,
      })
      return verificationErrorResponse(context, verification)
    }

    const createdAt = Date.now()
    const credential = verification.value.credential
    const completed = await completeVaultRegistration(context.env.DB, {
      id: credential.id,
      vaultId: vaultUser.id,
      publicKey: bytesToBase64Url(credential.publicKey),
      deviceName: body.deviceName ?? null,
      counter: credential.counter,
      prfSalt: body.prfSalt,
      wrappedMasterKey: body.wrappedKey,
      encryptionIv: body.iv,
      ceremonyId: body.ceremonyId,
      createdAt,
    })
    if (!completed) return context.json({ error: 'VAULT_ALREADY_INITIALIZED' }, 409)

    await finalizeSession(context, {
      userId: vaultUser.id,
      credentialId: credential.id,
    })
    return context.json({ ok: true }, 200)
  })
}
