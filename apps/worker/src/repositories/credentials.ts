import type { D1Database } from '../cloudflare'

export type DbCredential = {
  id: string
  user_id: string
  public_key: string
  device_name: string | null
  counter: number | null
  prf_salt: string
  wrapped_master_key: string
  encryption_iv: string
  last_used_at: number | null
  created_at: number | null
  revoked_at?: number | null
  updated_at?: number | null
  created_by_ceremony_id?: string | null
  last_auth_ceremony_id?: string | null
}

export async function countCredentialsByUserId(
  db: D1Database,
  userId: string,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(1) AS c FROM credentials WHERE user_id = ? AND revoked_at IS NULL')
    .bind(userId)
    .first<{ c: number }>()

  return row?.c ?? 0
}

export async function listCredentialsByUserId(
  db: D1Database,
  userId: string,
): Promise<DbCredential[]> {
  const res = await db
    .prepare(
      'SELECT * FROM credentials WHERE user_id = ? AND revoked_at IS NULL ORDER BY COALESCE(last_used_at, created_at) DESC',
    )
    .bind(userId)
    .all<DbCredential>()

  return res.results ?? []
}

export async function getCredentialById(
  db: D1Database,
  credentialId: string,
): Promise<DbCredential | null> {
  const row = await db
    .prepare('SELECT * FROM credentials WHERE id = ? AND revoked_at IS NULL LIMIT 1')
    .bind(credentialId)
    .first<DbCredential>()

  return row ?? null
}

export async function getCredentialForUser(
  db: D1Database,
  userId: string,
  credentialId: string,
): Promise<DbCredential | null> {
  const row = await db
    .prepare('SELECT * FROM credentials WHERE id = ? AND user_id = ? AND revoked_at IS NULL LIMIT 1')
    .bind(credentialId, userId)
    .first<DbCredential>()

  return row ?? null
}

export async function insertCredential(
  db: D1Database,
  credential: DbCredential,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO credentials (
        id, user_id, public_key, device_name, counter,
        prf_salt, wrapped_master_key, encryption_iv,
        last_used_at, created_at, updated_at, created_by_ceremony_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      credential.id,
      credential.user_id,
      credential.public_key,
      credential.device_name,
      credential.counter ?? 0,
      credential.prf_salt,
      credential.wrapped_master_key,
      credential.encryption_iv,
      credential.last_used_at,
      credential.created_at,
      credential.updated_at ?? credential.created_at,
      credential.created_by_ceremony_id ?? null,
    )
    .run()
}

export const upsertCredential = insertCredential

export async function updateCredentialUsage(
  db: D1Database,
  credentialId: string,
  counter: number,
  lastUsedAt: number,
): Promise<void> {
  await db
    .prepare('UPDATE credentials SET counter = ?, last_used_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(counter, lastUsedAt, lastUsedAt, credentialId)
    .run()
}

export async function updateCredentialDeviceName(
  db: D1Database,
  userId: string,
  credentialId: string,
  deviceName: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE credentials SET device_name = ?, updated_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(deviceName, Date.now(), credentialId, userId)
    .run()
}

export async function deleteCredentialUnlessLast(
  db: D1Database,
  userId: string,
  credentialId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE credentials
       SET revoked_at = ?, updated_at = ?
       WHERE id = ?
         AND user_id = ?
         AND revoked_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM credentials AS other
           WHERE other.user_id = credentials.user_id
             AND other.revoked_at IS NULL
             AND other.id <> credentials.id
         )`,
    )
    .bind(Date.now(), Date.now(), credentialId, userId)
    .run()

  return (result.meta?.changes ?? 0) === 1
}
