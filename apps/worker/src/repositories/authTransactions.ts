import type { D1Database } from '../cloudflare'

export type NewCredentialRecord = {
  id: string
  vaultId: string
  publicKey: string
  deviceName: string | null
  counter: number
  prfSalt: string
  wrappedMasterKey: string
  encryptionIv: string
  ceremonyId: string
  createdAt: number
}

function createCredentialInsertStatement(
  db: D1Database,
  input: NewCredentialRecord,
  purpose: 'vault_create' | 'device_add',
) {
  const additionalPredicate = purpose === 'vault_create'
    ? `AND NOT EXISTS (
         SELECT 1 FROM credentials
         WHERE user_id = auth_ceremonies.vault_id AND revoked_at IS NULL
       )`
    : `AND EXISTS (
         SELECT 1 FROM device_grants
         WHERE device_grants.id = auth_ceremonies.device_grant_id
           AND device_grants.state = 'consuming'
           AND device_grants.consuming_ceremony_id = auth_ceremonies.id
       )`

  return db
    .prepare(
      `INSERT INTO credentials (
        id, user_id, public_key, device_name, counter,
        prf_salt, wrapped_master_key, encryption_iv,
        last_used_at, created_at, updated_at, created_by_ceremony_id
      )
      SELECT ?, auth_ceremonies.vault_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, auth_ceremonies.id
      FROM auth_ceremonies
      WHERE auth_ceremonies.id = ?
        AND auth_ceremonies.vault_id = ?
        AND auth_ceremonies.purpose = ?
        AND auth_ceremonies.state = 'verifying'
        ${additionalPredicate}`,
    )
    .bind(
      input.id,
      input.publicKey,
      input.deviceName,
      input.counter,
      input.prfSalt,
      input.wrappedMasterKey,
      input.encryptionIv,
      input.createdAt,
      input.createdAt,
      input.createdAt,
      input.ceremonyId,
      input.vaultId,
      purpose,
    )
}

function createCeremonyCompletionStatement(
  db: D1Database,
  input: Pick<NewCredentialRecord, 'ceremonyId' | 'id' | 'createdAt'>,
) {
  return db
    .prepare(
      `UPDATE auth_ceremonies
       SET state = 'succeeded', result_credential_id = ?, completed_at = ?, updated_at = ?
       WHERE id = ?
         AND state = 'verifying'
         AND EXISTS (
           SELECT 1 FROM credentials
           WHERE credentials.created_by_ceremony_id = auth_ceremonies.id
             AND credentials.id = ?
         )`,
    )
    .bind(input.id, input.createdAt, input.createdAt, input.ceremonyId, input.id)
}

export async function completeVaultRegistration(
  db: D1Database,
  input: NewCredentialRecord,
): Promise<boolean> {
  const results = await db.batch([
    createCredentialInsertStatement(db, input, 'vault_create'),
    createCeremonyCompletionStatement(db, input),
  ])
  return (results[0]?.meta?.changes ?? 0) === 1 && (results[1]?.meta?.changes ?? 0) === 1
}

export async function completeDeviceRegistration(
  db: D1Database,
  input: NewCredentialRecord & { deviceGrantId: string },
): Promise<boolean> {
  const results = await db.batch([
    createCredentialInsertStatement(db, input, 'device_add'),
    db
      .prepare(
        `UPDATE device_grants
         SET state = 'consumed', consumed_by_credential_id = ?, consumed_at = ?, updated_at = ?,
             version = version + 1
         WHERE id = ?
           AND state = 'consuming'
           AND consuming_ceremony_id = ?
           AND EXISTS (
             SELECT 1 FROM credentials
             WHERE credentials.created_by_ceremony_id = ?
               AND credentials.id = ?
           )`,
      )
      .bind(
        input.id,
        input.createdAt,
        input.createdAt,
        input.deviceGrantId,
        input.ceremonyId,
        input.ceremonyId,
        input.id,
      ),
    db
      .prepare(
        `UPDATE handshakes
         SET state = 'consumed', version = version + 1
         WHERE device_grant_id = ? AND state = 'ready'`,
      )
      .bind(input.deviceGrantId),
    createCeremonyCompletionStatement(db, input),
  ])

  return (results[0]?.meta?.changes ?? 0) === 1 &&
    (results[1]?.meta?.changes ?? 0) === 1 &&
    (results[3]?.meta?.changes ?? 0) === 1
}

export async function completeLoginCeremony(
  db: D1Database,
  input: {
    ceremonyId: string
    vaultId: string
    credentialId: string
    previousCounter: number
    newCounter: number
    responseHash: string
    now: number
  },
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE credentials
         SET counter = ?, last_used_at = ?, updated_at = ?, last_auth_ceremony_id = ?
         WHERE id = ?
           AND user_id = ?
           AND revoked_at IS NULL
           AND counter = ?`,
      )
      .bind(
        input.newCounter,
        input.now,
        input.now,
        input.ceremonyId,
        input.credentialId,
        input.vaultId,
        input.previousCounter,
      ),
    db
      .prepare(
        `UPDATE auth_ceremonies
         SET state = 'succeeded', result_credential_id = ?, completed_at = ?, updated_at = ?
         WHERE id = ?
           AND vault_id = ?
           AND purpose = 'login'
           AND state = 'verifying'
           AND response_hash = ?
           AND EXISTS (
             SELECT 1 FROM credentials
             WHERE credentials.id = ?
               AND credentials.last_auth_ceremony_id = auth_ceremonies.id
           )`,
      )
      .bind(
        input.credentialId,
        input.now,
        input.now,
        input.ceremonyId,
        input.vaultId,
        input.responseHash,
        input.credentialId,
      ),
  ])

  return (results[0]?.meta?.changes ?? 0) === 1 && (results[1]?.meta?.changes ?? 0) === 1
}
