import type { D1Database } from '../cloudflare'

export type DeviceGrantSource = 'pairing' | 'enrollment' | 'authenticated'
export type DeviceGrantState = 'pending' | 'ready' | 'consuming' | 'consumed' | 'revoked' | 'expired'

export type DbDeviceGrant = {
  id: string
  vault_id: string
  source: DeviceGrantSource
  secret_hash: string
  state: DeviceGrantState
  issued_by_credential_id: string | null
  consuming_ceremony_id: string | null
  consumed_by_credential_id: string | null
  created_at: number
  expires_at: number
  ready_at: number | null
  consumed_at: number | null
  revoked_at: number | null
  updated_at: number
  version: number
}

export async function createDeviceGrant(
  db: D1Database,
  grant: DbDeviceGrant,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO device_grants (
        id, vault_id, source, secret_hash, state,
        issued_by_credential_id, consuming_ceremony_id, consumed_by_credential_id,
        created_at, expires_at, ready_at, consumed_at, revoked_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      grant.id,
      grant.vault_id,
      grant.source,
      grant.secret_hash,
      grant.state,
      grant.issued_by_credential_id,
      grant.consuming_ceremony_id,
      grant.consumed_by_credential_id,
      grant.created_at,
      grant.expires_at,
      grant.ready_at,
      grant.consumed_at,
      grant.revoked_at,
      grant.updated_at,
      grant.version,
    )
    .run()
}

export async function getDeviceGrantById(
  db: D1Database,
  grantId: string,
): Promise<DbDeviceGrant | null> {
  const row = await db
    .prepare('SELECT * FROM device_grants WHERE id = ? LIMIT 1')
    .bind(grantId)
    .first<DbDeviceGrant>()
  return row ?? null
}

export async function getDeviceGrantBySecretHash(
  db: D1Database,
  secretHash: string,
): Promise<DbDeviceGrant | null> {
  const row = await db
    .prepare('SELECT * FROM device_grants WHERE secret_hash = ? LIMIT 1')
    .bind(secretHash)
    .first<DbDeviceGrant>()
  return row ?? null
}

export async function claimDeviceGrant(
  db: D1Database,
  input: { grantId: string; ceremonyId: string; now: number },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE device_grants
       SET state = 'consuming', consuming_ceremony_id = ?, updated_at = ?, version = version + 1
       WHERE id = ?
         AND expires_at > ?
         AND (
           state = 'ready'
           OR (state = 'consuming' AND consuming_ceremony_id = ?)
         )`,
    )
    .bind(input.ceremonyId, input.now, input.grantId, input.now, input.ceremonyId)
    .run()
  return (result.meta?.changes ?? 0) === 1
}

export async function revokeDeviceGrant(
  db: D1Database,
  grantId: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE device_grants
       SET state = 'revoked', revoked_at = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND state NOT IN ('consumed', 'revoked')`,
    )
    .bind(now, now, grantId)
    .run()
}
