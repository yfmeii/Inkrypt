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
}

export async function countCredentialsByUserId(
  db: D1Database,
  userId: string,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(1) AS c FROM credentials WHERE user_id = ?')
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
      'SELECT * FROM credentials WHERE user_id = ? ORDER BY COALESCE(last_used_at, created_at) DESC',
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
    .prepare('SELECT * FROM credentials WHERE id = ? LIMIT 1')
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
    .prepare('SELECT * FROM credentials WHERE id = ? AND user_id = ? LIMIT 1')
    .bind(credentialId, userId)
    .first<DbCredential>()

  return row ?? null
}

export async function upsertCredential(
  db: D1Database,
  credential: DbCredential,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO credentials (
        id, user_id, public_key, device_name, counter,
        prf_salt, wrapped_master_key, encryption_iv,
        last_used_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id=excluded.user_id,
        public_key=excluded.public_key,
        device_name=excluded.device_name,
        counter=excluded.counter,
        prf_salt=excluded.prf_salt,
        wrapped_master_key=excluded.wrapped_master_key,
        encryption_iv=excluded.encryption_iv,
        last_used_at=excluded.last_used_at`,
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
    )
    .run()
}

export async function updateCredentialUsage(
  db: D1Database,
  credentialId: string,
  counter: number,
  lastUsedAt: number,
): Promise<void> {
  await db
    .prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?')
    .bind(counter, lastUsedAt, credentialId)
    .run()
}

export async function updateCredentialDeviceName(
  db: D1Database,
  userId: string,
  credentialId: string,
  deviceName: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE credentials SET device_name = ? WHERE id = ? AND user_id = ?')
    .bind(deviceName, credentialId, userId)
    .run()
}

export async function deleteCredentialForUser(
  db: D1Database,
  userId: string,
  credentialId: string,
): Promise<void> {
  await db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?').bind(credentialId, userId).run()
}
