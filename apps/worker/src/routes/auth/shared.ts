import type { Context } from 'hono'
import type { AppEnv } from '../../env'
import { loadSingleVaultUser } from '../../services/auth/vault'
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
