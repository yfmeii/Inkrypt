import type { D1Database } from '../../cloudflare'
import {
  createDeviceGrant,
  getDeviceGrantBySecretHash,
  type DbDeviceGrant,
  type DeviceGrantSource,
} from '../../repositories/deviceGrants'
import { bytesToBase64Url, randomBase64Url } from '../../utils/base64'

const DEVICE_GRANT_TTL_MS = 10 * 60 * 1000

export async function hashDeviceGrantSecret(secret: string): Promise<string> {
  const normalized = secret.trim()
  const material = new TextEncoder().encode(`Inkrypt.DeviceGrant.v1\0${normalized}`)
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', material)))
}

export async function issueDeviceGrant(
  db: D1Database,
  input: {
    vaultId: string
    source: DeviceGrantSource
    issuedByCredentialId?: string | null
    state?: 'pending' | 'ready'
    secret?: string
    now?: number
  },
): Promise<{ grant: DbDeviceGrant; secret: string }> {
  const built = await buildDeviceGrant(input)
  await createDeviceGrant(db, built.grant)
  return built
}

export async function buildDeviceGrant(
  input: {
    vaultId: string
    source: DeviceGrantSource
    issuedByCredentialId?: string | null
    state?: 'pending' | 'ready'
    secret?: string
    now?: number
  },
): Promise<{ grant: DbDeviceGrant; secret: string }> {
  const now = input.now ?? Date.now()
  const secret = input.secret ?? randomBase64Url(32)
  const state = input.state ?? 'ready'
  const grant: DbDeviceGrant = {
    id: crypto.randomUUID(),
    vault_id: input.vaultId,
    source: input.source,
    secret_hash: await hashDeviceGrantSecret(secret),
    state,
    issued_by_credential_id: input.issuedByCredentialId ?? null,
    consuming_ceremony_id: null,
    consumed_by_credential_id: null,
    created_at: now,
    expires_at: now + DEVICE_GRANT_TTL_MS,
    ready_at: state === 'ready' ? now : null,
    consumed_at: null,
    revoked_at: null,
    updated_at: now,
    version: 0,
  }
  return { grant, secret }
}

export async function resolveReadyDeviceGrant(
  db: D1Database,
  secret: string,
  now = Date.now(),
): Promise<DbDeviceGrant | null> {
  const grant = await getDeviceGrantBySecretHash(db, await hashDeviceGrantSecret(secret))
  if (!grant || grant.state !== 'ready' || grant.expires_at <= now) return null
  return grant
}
