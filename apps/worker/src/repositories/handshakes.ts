import type { D1Database } from '../cloudflare'

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
): Promise<void> {
  await db
    .prepare('UPDATE handshakes SET bob_public_key = ?, expires_at = ? WHERE session_code = ?')
    .bind(bobPublicKey, expiresAt, sessionCode)
    .run()
}

export async function updateHandshakePayload(
  db: D1Database,
  sessionCode: string,
  encryptedPayload: string,
  payloadIv: string,
  expiresAt: number,
): Promise<void> {
  await db
    .prepare(
      'UPDATE handshakes SET encrypted_payload = ?, payload_iv = ?, expires_at = ? WHERE session_code = ?',
    )
    .bind(encryptedPayload, payloadIv, expiresAt, sessionCode)
    .run()
}

export async function deleteHandshake(db: D1Database, sessionCode: string): Promise<void> {
  await db.prepare('DELETE FROM handshakes WHERE session_code = ?').bind(sessionCode).run()
}
