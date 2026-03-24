import type { D1Database } from '../cloudflare'

export type DbDeviceEnrollment = {
  token: string
  user_id: string
  expires_at: number
  created_at: number
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
