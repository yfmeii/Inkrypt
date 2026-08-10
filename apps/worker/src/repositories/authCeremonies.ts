import type { D1Database } from '../cloudflare'

export type AuthCeremonyPurpose = 'vault_create' | 'login' | 'device_add'
export type AuthCeremonyState = 'pending' | 'verifying' | 'succeeded' | 'failed' | 'expired' | 'cancelled'

export type DbAuthCeremony = {
  id: string
  vault_id: string
  purpose: AuthCeremonyPurpose
  challenge: string
  preferred_credential_id: string | null
  device_grant_id: string | null
  client_request_id: string | null
  response_hash: string | null
  state: AuthCeremonyState
  result_credential_id: string | null
  failure_code: string | null
  created_at: number
  expires_at: number
  claimed_at: number | null
  completed_at: number | null
  updated_at: number
}

export async function createAuthCeremony(
  db: D1Database,
  ceremony: DbAuthCeremony,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auth_ceremonies (
        id, vault_id, purpose, challenge,
        preferred_credential_id, device_grant_id, client_request_id,
        response_hash, state, result_credential_id, failure_code,
        created_at, expires_at, claimed_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ceremony.id,
      ceremony.vault_id,
      ceremony.purpose,
      ceremony.challenge,
      ceremony.preferred_credential_id,
      ceremony.device_grant_id,
      ceremony.client_request_id,
      ceremony.response_hash,
      ceremony.state,
      ceremony.result_credential_id,
      ceremony.failure_code,
      ceremony.created_at,
      ceremony.expires_at,
      ceremony.claimed_at,
      ceremony.completed_at,
      ceremony.updated_at,
    )
    .run()
}

export async function getAuthCeremony(
  db: D1Database,
  ceremonyId: string,
): Promise<DbAuthCeremony | null> {
  const row = await db
    .prepare('SELECT * FROM auth_ceremonies WHERE id = ? LIMIT 1')
    .bind(ceremonyId)
    .first<DbAuthCeremony>()
  return row ?? null
}

export async function claimAuthCeremony(
  db: D1Database,
  input: {
    ceremonyId: string
    vaultId: string
    purpose: AuthCeremonyPurpose
    responseHash: string
    now: number
  },
): Promise<DbAuthCeremony | null> {
  const results = await db.batch<DbAuthCeremony>([
    db
      .prepare(
        `UPDATE auth_ceremonies
         SET state = 'verifying', response_hash = ?, claimed_at = ?, updated_at = ?
         WHERE id = ?
           AND vault_id = ?
           AND purpose = ?
           AND state = 'pending'
           AND expires_at > ?`,
      )
      .bind(
        input.responseHash,
        input.now,
        input.now,
        input.ceremonyId,
        input.vaultId,
        input.purpose,
        input.now,
      ),
    db.prepare('SELECT * FROM auth_ceremonies WHERE id = ? LIMIT 1').bind(input.ceremonyId),
  ])

  if ((results[0]?.meta?.changes ?? 0) !== 1) return null
  return results[1]?.results?.[0] ?? null
}

export async function completeAuthCeremony(
  db: D1Database,
  input: {
    ceremonyId: string
    responseHash: string
    credentialId: string
    now: number
  },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE auth_ceremonies
       SET state = 'succeeded', result_credential_id = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND state = 'verifying' AND response_hash = ?`,
    )
    .bind(input.credentialId, input.now, input.now, input.ceremonyId, input.responseHash)
    .run()
  return (result.meta?.changes ?? 0) === 1
}

export async function failAuthCeremony(
  db: D1Database,
  input: { ceremonyId: string; responseHash: string; failureCode: string; now: number },
): Promise<void> {
  await db
    .prepare(
      `UPDATE auth_ceremonies
       SET state = 'failed', failure_code = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND state = 'verifying' AND response_hash = ?`,
    )
    .bind(input.failureCode, input.now, input.now, input.ceremonyId, input.responseHash)
    .run()
}
