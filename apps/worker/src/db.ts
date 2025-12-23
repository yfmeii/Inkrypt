export type DbUser = {
  id: string
  username: string
  current_challenge: string | null
  created_at: number
}

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

export type DbNote = {
  id: string
  user_id: string
  version: number
  updated_at: number
  is_deleted: number
  encrypted_data: string
  data_iv: string
}

export type DbNoteConflict = {
  id: string
  note_id: string
  user_id: string
  encrypted_data: string
  data_iv: string
  device_name: string | null
  created_at: number | null
}

export type DbDeviceEnrollment = {
  token: string
  user_id: string
  expires_at: number
  created_at: number
}

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

export async function getUserByUsername(
  db: D1Database,
  username: string,
): Promise<DbUser | null> {
  const row = await db
    .prepare('SELECT * FROM users WHERE username = ? LIMIT 1')
    .bind(username)
    .first<DbUser>()
  return row ?? null
}

export async function getUserById(
  db: D1Database,
  userId: string,
): Promise<DbUser | null> {
  const row = await db
    .prepare('SELECT * FROM users WHERE id = ? LIMIT 1')
    .bind(userId)
    .first<DbUser>()
  return row ?? null
}

export async function createUser(
  db: D1Database,
  user: Pick<DbUser, 'id' | 'username' | 'current_challenge' | 'created_at'>,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO users (id, username, current_challenge, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(user.id, user.username, user.current_challenge, user.created_at)
    .run()
}

export async function setUserChallenge(
  db: D1Database,
  userId: string,
  challenge: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE users SET current_challenge = ? WHERE id = ?')
    .bind(challenge, userId)
    .run()
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
  await db
    .prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?')
    .bind(credentialId, userId)
    .run()
}

export async function getEnrollmentByToken(
  db: D1Database,
  token: string,
): Promise<DbDeviceEnrollment | null> {
  const row = await db
    .prepare('SELECT * FROM device_enrollments WHERE token = ? LIMIT 1')
    .bind(token)
    .first<DbDeviceEnrollment>()
  return row ?? null
}

export async function createEnrollment(
  db: D1Database,
  enrollment: DbDeviceEnrollment,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO device_enrollments (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(
      enrollment.token,
      enrollment.user_id,
      enrollment.expires_at,
      enrollment.created_at,
    )
    .run()
}

export async function deleteEnrollment(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM device_enrollments WHERE token = ?').bind(token).run()
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
    .prepare(
      'UPDATE handshakes SET bob_public_key = ?, expires_at = ? WHERE session_code = ?',
    )
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
