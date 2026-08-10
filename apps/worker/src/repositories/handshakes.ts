import type { D1Database } from '../cloudflare'
import type { DbDeviceGrant } from './deviceGrants'

export type DbHandshake = {
  session_code: string
  user_id: string
  session_secret_hash: string | null
  alice_public_key: string
  bob_public_key: string | null
  encrypted_payload: string | null
  payload_iv: string | null
  created_at: number
  expires_at: number
  state?: 'waiting_join' | 'waiting_confirm' | 'ready' | 'consumed' | 'cancelled' | 'expired'
  device_grant_id?: string | null
  protocol_version?: number
  version?: number
}

export async function createPairingHandshake(
  db: D1Database,
  input: { handshake: DbHandshake; grant: DbDeviceGrant },
): Promise<boolean> {
  try {
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO device_grants (
            id, vault_id, source, secret_hash, state,
            issued_by_credential_id, consuming_ceremony_id, consumed_by_credential_id,
            created_at, expires_at, ready_at, consumed_at, revoked_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.grant.id,
          input.grant.vault_id,
          input.grant.source,
          input.grant.secret_hash,
          input.grant.state,
          input.grant.issued_by_credential_id,
          input.grant.consuming_ceremony_id,
          input.grant.consumed_by_credential_id,
          input.grant.created_at,
          input.grant.expires_at,
          input.grant.ready_at,
          input.grant.consumed_at,
          input.grant.revoked_at,
          input.grant.updated_at,
          input.grant.version,
        ),
      db
        .prepare(
          `INSERT INTO handshakes (
            session_code, user_id, session_secret_hash,
            alice_public_key, bob_public_key, encrypted_payload, payload_iv,
            created_at, expires_at, state, device_grant_id, protocol_version, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.handshake.session_code,
          input.handshake.user_id,
          input.handshake.session_secret_hash,
          input.handshake.alice_public_key,
          input.handshake.bob_public_key,
          input.handshake.encrypted_payload,
          input.handshake.payload_iv,
          input.handshake.created_at,
          input.handshake.expires_at,
          input.handshake.state ?? 'waiting_join',
          input.grant.id,
          input.handshake.protocol_version ?? 2,
          input.handshake.version ?? 0,
        ),
    ])
    return results.every((result) => (result.meta?.changes ?? 0) === 1)
  } catch {
    return false
  }
}

export async function getHandshakeByCode(
  db: D1Database,
  sessionCode: string,
): Promise<DbHandshake | null> {
  const row = await db
    .prepare('SELECT * FROM handshakes WHERE session_code = ? LIMIT 1')
    .bind(sessionCode)
    .first<DbHandshake>()

  return row ?? null
}

export async function getHandshakeBySecretHash(
  db: D1Database,
  sessionSecretHash: string,
): Promise<DbHandshake | null> {
  const row = await db
    .prepare('SELECT * FROM handshakes WHERE session_secret_hash = ? LIMIT 1')
    .bind(sessionSecretHash)
    .first<DbHandshake>()

  return row ?? null
}

export async function createHandshake(
  db: D1Database,
  handshake: DbHandshake,
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO handshakes (
        session_code, user_id,
        session_secret_hash,
        alice_public_key, bob_public_key,
        encrypted_payload, payload_iv,
        created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      handshake.session_code,
      handshake.user_id,
      handshake.session_secret_hash,
      handshake.alice_public_key,
      handshake.bob_public_key,
      handshake.encrypted_payload,
      handshake.payload_iv,
      handshake.created_at,
      handshake.expires_at,
    )
    .run()

  return (res.meta?.changes ?? 0) > 0
}

export async function updateHandshakeJoin(
  db: D1Database,
  sessionCode: string,
  bobPublicKey: string,
  expiresAt: number,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE handshakes
       SET bob_public_key = ?, expires_at = ?, state = 'waiting_confirm', version = version + 1
       WHERE session_code = ?
         AND bob_public_key IS NULL
         AND encrypted_payload IS NULL
         AND payload_iv IS NULL
         AND expires_at > ?`,
    )
    .bind(bobPublicKey, expiresAt, sessionCode, now)
    .run()

  return (result.meta?.changes ?? 0) === 1
}

export async function updateHandshakePayload(
  db: D1Database,
  sessionCode: string,
  encryptedPayload: string,
  payloadIv: string,
  expiresAt: number,
  userId: string,
  now: number,
): Promise<boolean> {
  const results = await db.batch([
    db.prepare(
      `UPDATE handshakes
       SET encrypted_payload = ?, payload_iv = ?, expires_at = ?, state = 'ready', version = version + 1
       WHERE session_code = ?
         AND user_id = ?
         AND bob_public_key IS NOT NULL
         AND encrypted_payload IS NULL
         AND payload_iv IS NULL
         AND expires_at > ?`,
    ).bind(encryptedPayload, payloadIv, expiresAt, sessionCode, userId, now),
    db.prepare(
      `UPDATE device_grants
       SET state = 'ready', ready_at = ?, expires_at = ?, updated_at = ?, version = version + 1
       WHERE id = (
         SELECT device_grant_id FROM handshakes
         WHERE session_code = ? AND state = 'ready'
       )
         AND state = 'pending'`,
    ).bind(now, expiresAt, now, sessionCode),
  ])

  return (results[0]?.meta?.changes ?? 0) === 1
}

export async function deleteHandshake(db: D1Database, sessionCode: string): Promise<void> {
  await db.prepare('DELETE FROM handshakes WHERE session_code = ?').bind(sessionCode).run()
}

export async function cancelPairingHandshake(
  db: D1Database,
  sessionCode: string,
  now: number,
): Promise<void> {
  await db.batch([
    db.prepare(
      `UPDATE device_grants
       SET state = 'revoked', revoked_at = ?, updated_at = ?, version = version + 1
       WHERE id = (SELECT device_grant_id FROM handshakes WHERE session_code = ?)
         AND state NOT IN ('consumed', 'revoked')`,
    ).bind(now, now, sessionCode),
    db.prepare('DELETE FROM handshakes WHERE session_code = ?').bind(sessionCode),
  ])
}
