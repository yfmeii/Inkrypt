import type { Context } from 'hono'
import type { AppEnv } from '../../env'
import type { DbDeviceGrant } from '../../repositories/deviceGrants'
import { issueDeviceGrant, resolveReadyDeviceGrant } from './deviceGrants'
import { tryGetSession } from './session'

export type DeviceAccessInput = {
  enrollmentToken?: string
  grantSecret?: string
  sessionSecret?: string
}

export type DeviceAccessResult = {
  userId: string
  deviceGrant: DbDeviceGrant
}

export async function resolveDeviceAddAccess(
  context: Context<AppEnv>,
  input: DeviceAccessInput,
): Promise<DeviceAccessResult | Response> {
  const session = await tryGetSession(context)
  if (session) {
    const issued = await issueDeviceGrant(context.env.DB, {
      vaultId: session.userId,
      source: 'authenticated',
      issuedByCredentialId: session.credentialId ?? null,
      state: 'ready',
    })
    return { userId: session.userId, deviceGrant: issued.grant }
  }

  const grantSecret = input.grantSecret ?? input.sessionSecret ?? input.enrollmentToken
  if (!grantSecret) return context.json({ error: 'UNAUTHORIZED' }, 401)

  const deviceGrant = await resolveReadyDeviceGrant(context.env.DB, grantSecret)
  if (!deviceGrant) return context.json({ error: 'INVALID_TOKEN' }, 401)
  return { userId: deviceGrant.vault_id, deviceGrant }
}
