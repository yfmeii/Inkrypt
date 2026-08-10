import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../env'
import { getAuthCeremony } from '../../repositories/authCeremonies'
import {
  completeDeviceRegistration,
} from '../../repositories/authTransactions'
import {
  deleteCredentialUnlessLast,
  getCredentialForUser,
  listCredentialsByUserId,
  updateCredentialDeviceName,
} from '../../repositories/credentials'
import { claimDeviceGrant, getDeviceGrantById } from '../../repositories/deviceGrants'
import {
  claimCeremonyForVerification,
  markCeremonyFailed,
  startAuthCeremony,
} from '../../services/auth/ceremonies'
import { resolveDeviceAddAccess } from '../../services/auth/deviceAddition'
import { issueDeviceGrant } from '../../services/auth/deviceGrants'
import { generatePasskeyRegistrationOptions } from '../../services/auth/registration'
import { finalizeSession } from '../../services/auth/session'
import {
  verificationErrorResponse,
  verifyRegistration,
} from '../../services/auth/verification'
import { requireAuth } from '../../middleware/requireAuth'
import { getUserById } from '../../repositories/users'
import { bytesToBase64Url } from '../../utils/base64'
import { clearSessionCookie } from '../../utils/sessionCookie'
import { MAX_IV_B64, MAX_PRF_SALT, MAX_WRAPPED_KEY } from './constants'
import { parseJsonBody } from './shared'
import { requireUserId } from '../shared'

const deviceAddAccessSchema = z.object({
  enrollmentToken: z.string().min(1).max(512).optional(),
  grantSecret: z.string().min(1).max(512).optional(),
  sessionSecret: z.string().min(1).max(512).optional(),
  clientRequestId: z.string().uuid().optional(),
}).strict()

const deviceAddFinishSchema = z.object({
  ceremonyId: z.string().uuid(),
  attestation: z.unknown(),
  prfSalt: z.string().min(1).max(MAX_PRF_SALT),
  wrappedKey: z.string().min(1).max(MAX_WRAPPED_KEY),
  iv: z.string().min(1).max(MAX_IV_B64),
  deviceName: z.string().trim().min(1).max(64).optional(),
}).strict()

export function registerAuthDeviceRoutes(app: Hono<AppEnv>): void {
  app.post('/logout', async (context) => {
    clearSessionCookie(context as any)
    return context.json({ ok: true }, 200)
  })

  app.get('/device/list', requireAuth, async (context) => {
    const userId = requireUserId(context)
    if (userId instanceof Response) return userId

    const credentials = await listCredentialsByUserId(context.env.DB, userId)
    return context.json({
      credentials: credentials.map((credential) => ({
        id: credential.id,
        deviceName: credential.device_name,
        lastUsedAt: credential.last_used_at,
        createdAt: credential.created_at,
      })),
    }, 200)
  })

  app.post('/device/rename', requireAuth, async (context) => {
    const userId = requireUserId(context)
    if (userId instanceof Response) return userId

    const body = await parseJsonBody(context, z.object({
      credentialId: z.string().min(1),
      deviceName: z.string().max(64).optional(),
    }).strict())
    if (body instanceof Response) return body

    const credential = await getCredentialForUser(context.env.DB, userId, body.credentialId)
    if (!credential) return context.json({ error: 'CREDENTIAL_NOT_FOUND' }, 404)

    const normalizedDeviceName = body.deviceName?.trim() || null
    await updateCredentialDeviceName(
      context.env.DB,
      userId,
      body.credentialId,
      normalizedDeviceName,
    )
    return context.json({ ok: true }, 200)
  })

  app.delete('/device/:id', requireAuth, async (context) => {
    const userId = requireUserId(context)
    const currentCredentialId = context.get('credentialId')
    if (userId instanceof Response) return userId

    const credentialId = context.req.param('id')
    const credential = await getCredentialForUser(context.env.DB, userId, credentialId)
    if (!credential) return context.json({ error: 'CREDENTIAL_NOT_FOUND' }, 404)

    const revoked = await deleteCredentialUnlessLast(context.env.DB, userId, credentialId)
    if (!revoked) return context.json({ error: 'LAST_DEVICE' }, 400)

    if (currentCredentialId === credentialId) clearSessionCookie(context as any)
    return context.json({ ok: true }, 200)
  })

  app.post('/device/enroll', requireAuth, async (context) => {
    const userId = requireUserId(context)
    const credentialId = context.get('credentialId')
    if (userId instanceof Response) return userId

    const issued = await issueDeviceGrant(context.env.DB, {
      vaultId: userId,
      source: 'enrollment',
      issuedByCredentialId: credentialId ?? null,
      state: 'ready',
    })
    return context.json({
      enrollmentToken: issued.secret,
      grantSecret: issued.secret,
      grantId: issued.grant.id,
      expiresAt: issued.grant.expires_at,
    }, 200)
  })

  app.post('/device/add/start', async (context) => {
    const body = await parseJsonBody(context, deviceAddAccessSchema)
    if (body instanceof Response) return body

    const access = await resolveDeviceAddAccess(context, body)
    if (access instanceof Response) return access

    const user = await getUserById(context.env.DB, access.userId)
    if (!user) return context.json({ error: 'USER_NOT_FOUND' }, 404)

    const credentials = await listCredentialsByUserId(context.env.DB, user.id)
    const options = await generatePasskeyRegistrationOptions(context.env, {
      userId: user.id,
      username: user.username,
      excludeCredentialIds: credentials.map((credential) => credential.id),
    })
    const ceremony = await startAuthCeremony(context.env.DB, {
      vaultId: user.id,
      purpose: 'device_add',
      challenge: options.challenge,
      deviceGrantId: access.deviceGrant.id,
      clientRequestId: body.clientRequestId,
    })

    return context.json({
      options,
      protocolVersion: 2 as const,
      ceremonyId: ceremony.id,
      ceremonyExpiresAt: ceremony.expires_at,
      grantId: access.deviceGrant.id,
    }, 200)
  })

  app.post('/device/add', async (context) => {
    const body = await parseJsonBody(context, deviceAddFinishSchema)
    if (body instanceof Response) return body

    const pendingCeremony = await getAuthCeremony(context.env.DB, body.ceremonyId)
    if (!pendingCeremony || pendingCeremony.purpose !== 'device_add') {
      return context.json({ error: 'CEREMONY_NOT_FOUND' }, 404)
    }

    const claimed = await claimCeremonyForVerification(context, {
      ceremonyId: body.ceremonyId,
      vaultId: pendingCeremony.vault_id,
      purpose: 'device_add',
      response: body.attestation,
    })
    if (claimed instanceof Response) return claimed

    const deviceGrantId = claimed.ceremony.device_grant_id
    if (!deviceGrantId) return context.json({ error: 'DEVICE_GRANT_NOT_READY' }, 409)
    const deviceGrant = await getDeviceGrantById(context.env.DB, deviceGrantId)
    if (!deviceGrant || deviceGrant.expires_at <= Date.now()) {
      return context.json({ error: 'DEVICE_GRANT_EXPIRED' }, 409)
    }

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

    const claimedGrant = await claimDeviceGrant(context.env.DB, {
      grantId: deviceGrantId,
      ceremonyId: body.ceremonyId,
      now: Date.now(),
    })
    if (!claimedGrant) return context.json({ error: 'DEVICE_GRANT_CONSUMED' }, 409)

    const credential = verification.value.credential
    const createdAt = Date.now()
    const completed = await completeDeviceRegistration(context.env.DB, {
      id: credential.id,
      vaultId: claimed.ceremony.vault_id,
      publicKey: bytesToBase64Url(credential.publicKey),
      deviceName: body.deviceName ?? null,
      counter: credential.counter,
      prfSalt: body.prfSalt,
      wrappedMasterKey: body.wrappedKey,
      encryptionIv: body.iv,
      ceremonyId: body.ceremonyId,
      deviceGrantId,
      createdAt,
    })
    if (!completed) return context.json({ error: 'DEVICE_GRANT_CONSUMED' }, 409)

    await finalizeSession(context, {
      userId: claimed.ceremony.vault_id,
      credentialId: credential.id,
    })
    return context.json({ ok: true }, 200)
  })
}
