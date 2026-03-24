import type { D1Database } from '../../cloudflare'
import { createUser, setUserChallenge, type DbUser } from '../../repositories/users'

const CHALLENGE_TTL_MS = 5 * 60_000

type StoredChallengeV1 = { v: 1; c: string; ts: number }

export function wrapChallenge(challenge: string, ts: number): string {
  const payload: StoredChallengeV1 = { v: 1, c: challenge, ts }
  return JSON.stringify(payload)
}

export function parseStoredChallenge(value: string | null): { challenge: string; ts: number | null } | null {
  if (!value) return null
  if (!value.trim()) return null
  if (value.startsWith('{')) {
    try {
      const parsed = JSON.parse(value) as StoredChallengeV1
      if (parsed && parsed.v === 1 && typeof parsed.c === 'string' && parsed.c && typeof parsed.ts === 'number' && Number.isFinite(parsed.ts)) {
        return { challenge: parsed.c, ts: parsed.ts }
      }
    } catch {
      // fall through to legacy
    }
  }
  return { challenge: value, ts: null }
}

export function isChallengeFresh(ts: number | null, now: number): boolean {
  if (ts === null) return true
  return now - ts <= CHALLENGE_TTL_MS
}

export function requireFreshChallenge(
  currentChallenge: string | null,
  now: number,
): { challenge: string } | { error: 'NO_CHALLENGE' | 'CHALLENGE_EXPIRED' } {
  const storedChallenge = parseStoredChallenge(currentChallenge)
  if (!storedChallenge) return { error: 'NO_CHALLENGE' }
  if (!isChallengeFresh(storedChallenge.ts, now)) {
    return { error: 'CHALLENGE_EXPIRED' }
  }
  return { challenge: storedChallenge.challenge }
}

export async function reuseOrPersistChallenge(
  db: D1Database,
  user: DbUser,
  challenge: string,
  now: number,
): Promise<string> {
  const existingChallenge = parseStoredChallenge(user.current_challenge)
  if (existingChallenge && isChallengeFresh(existingChallenge.ts, now)) {
    if (existingChallenge.ts === null) {
      await setUserChallenge(db, user.id, wrapChallenge(existingChallenge.challenge, now))
    }
    return existingChallenge.challenge
  }

  await setUserChallenge(db, user.id, wrapChallenge(challenge, now))
  return challenge
}

export async function createUserWithChallenge(
  db: D1Database,
  user: Pick<DbUser, 'id' | 'username'>,
  challenge: string,
  now: number,
): Promise<void> {
  await createUser(db, {
    id: user.id,
    username: user.username,
    current_challenge: wrapChallenge(challenge, now),
    created_at: now,
  })
}
