import type { Context } from 'hono'
import type { AppEnv } from '../../env'
import { requireFreshChallenge } from '../../services/auth/challenge'
import {
  loadSingleVaultUser,
  validateUsernameMatch,
} from '../../services/auth/vault'
import { jsonError, parseJsonBody } from '../shared'

export { jsonError, parseJsonBody } from '../shared'

export async function loadOptionalVaultUser(
  c: Context<AppEnv>,
) {
  return loadSingleVaultUser(c)
}

export async function loadInitializedVaultUser(
  c: Context<AppEnv>,
) {
  const user = await loadSingleVaultUser(c)
  if (user instanceof Response) return user
  if (!user) return jsonError(c, 'VAULT_NOT_INITIALIZED', 404)
  return user
}

export function ensureUsernameMatches(
  c: Context<AppEnv>,
  actualUsername: string,
  providedUsername?: string,
): Response | null {
  return validateUsernameMatch(c, actualUsername, providedUsername)
}

export function requireFreshChallengeValue(
  c: Context<AppEnv>,
  currentChallenge: string | null,
  now: number,
): string | Response {
  const challenge = requireFreshChallenge(currentChallenge, now)
  if ('error' in challenge) return jsonError(c, challenge.error, 400)
  return challenge.challenge
}
