import type { Context } from 'hono'
import type { AppEnv } from '../../env'
import { getSingleVaultUser, type DbUser } from '../../repositories/users'

export const DEFAULT_VAULT_USERNAME = 'vault'

export async function loadSingleVaultUser(
  c: Context<AppEnv>,
): Promise<DbUser | null | Response> {
  try {
    return await getSingleVaultUser(c.env.DB)
  } catch {
    return c.json({ error: 'MULTI_USER_UNSUPPORTED' }, 400)
  }
}

export function validateUsernameMatch(
  c: Context<AppEnv>,
  actualUsername: string,
  providedUsername?: string,
): Response | null {
  if (providedUsername && providedUsername !== actualUsername) {
    return c.json({ error: 'USERNAME_MISMATCH' }, 400)
  }
  return null
}
