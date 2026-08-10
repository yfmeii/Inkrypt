import type { Context } from 'hono'
import type { D1Database } from '../../cloudflare'
import type { AppEnv } from '../../env'
import {
  claimAuthCeremony,
  completeAuthCeremony,
  createAuthCeremony,
  failAuthCeremony,
  getAuthCeremony,
  type AuthCeremonyPurpose,
  type DbAuthCeremony,
} from '../../repositories/authCeremonies'
import { bytesToBase64Url } from '../../utils/base64'

export const AUTH_CEREMONY_TTL_MS = 5 * 60 * 1000

async function hashResponsePayload(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

export async function startAuthCeremony(
  db: D1Database,
  input: {
    vaultId: string
    purpose: AuthCeremonyPurpose
    challenge: string
    preferredCredentialId?: string | null
    deviceGrantId?: string | null
    clientRequestId?: string | null
    now?: number
  },
): Promise<DbAuthCeremony> {
  const createdAt = input.now ?? Date.now()
  const ceremony: DbAuthCeremony = {
    id: crypto.randomUUID(),
    vault_id: input.vaultId,
    purpose: input.purpose,
    challenge: input.challenge,
    preferred_credential_id: input.preferredCredentialId ?? null,
    device_grant_id: input.deviceGrantId ?? null,
    client_request_id: input.clientRequestId ?? null,
    response_hash: null,
    state: 'pending',
    result_credential_id: null,
    failure_code: null,
    created_at: createdAt,
    expires_at: createdAt + AUTH_CEREMONY_TTL_MS,
    claimed_at: null,
    completed_at: null,
    updated_at: createdAt,
  }
  await createAuthCeremony(db, ceremony)
  return ceremony
}

export async function claimCeremonyForVerification(
  c: Context<AppEnv>,
  input: {
    ceremonyId: string
    vaultId: string
    purpose: AuthCeremonyPurpose
    response: unknown
  },
): Promise<{ ceremony: DbAuthCeremony; responseHash: string } | Response> {
  const now = Date.now()
  const responseHash = await hashResponsePayload(input.response)
  const ceremony = await claimAuthCeremony(c.env.DB, {
    ceremonyId: input.ceremonyId,
    vaultId: input.vaultId,
    purpose: input.purpose,
    responseHash,
    now,
  })
  if (ceremony) return { ceremony, responseHash }

  const existing = await getAuthCeremony(c.env.DB, input.ceremonyId)
  if (!existing) return c.json({ error: 'CEREMONY_NOT_FOUND' }, 404)
  if (existing.expires_at <= now) return c.json({ error: 'CEREMONY_EXPIRED' }, 400)
  return c.json({ error: 'CEREMONY_REPLAYED' }, 409)
}

export async function markCeremonySucceeded(
  db: D1Database,
  input: { ceremonyId: string; responseHash: string; credentialId: string },
): Promise<boolean> {
  return completeAuthCeremony(db, { ...input, now: Date.now() })
}

export async function markCeremonyFailed(
  db: D1Database,
  input: { ceremonyId: string; responseHash: string; failureCode: string },
): Promise<void> {
  await failAuthCeremony(db, { ...input, now: Date.now() })
}
