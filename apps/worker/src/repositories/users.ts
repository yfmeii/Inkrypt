import type { D1Database } from '../cloudflare'

export type DbUser = {
  id: string
  username: string
  current_challenge: string | null
  created_at: number
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

export async function getUserById(db: D1Database, userId: string): Promise<DbUser | null> {
  const row = await db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').bind(userId).first<DbUser>()
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
  await db.prepare('UPDATE users SET current_challenge = ? WHERE id = ?').bind(challenge, userId).run()
}

export async function getSingleVaultUser(db: D1Database): Promise<DbUser | null> {
  const res = await db.prepare('SELECT * FROM users ORDER BY created_at ASC LIMIT 2').all<DbUser>()
  const users = res.results ?? []
  if (users.length > 1) throw new Error('MULTI_USER_UNSUPPORTED')
  return users[0] ?? null
}
