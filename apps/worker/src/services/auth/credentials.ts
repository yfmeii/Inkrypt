import type { D1Database } from '../../cloudflare'
import type { DbCredential } from '../../repositories/credentials'
import { upsertCredential } from '../../repositories/credentials'
import { bytesToBase64Url } from '../../utils/base64'

type PersistCredentialInput = {
  userId: string
  credential: {
    id: string
    publicKey: Uint8Array
    counter: number
  }
  prfSalt: string
  wrappedKey: string
  iv: string
  deviceName?: string
  createdAt: number
}

export async function persistCredential(
  db: D1Database,
  input: PersistCredentialInput,
): Promise<DbCredential> {
  const record: DbCredential = {
    id: input.credential.id,
    user_id: input.userId,
    public_key: bytesToBase64Url(input.credential.publicKey),
    device_name: input.deviceName ?? null,
    counter: input.credential.counter,
    prf_salt: input.prfSalt,
    wrapped_master_key: input.wrappedKey,
    encryption_iv: input.iv,
    last_used_at: input.createdAt,
    created_at: input.createdAt,
  }

  await upsertCredential(db, record)
  return record
}

export function buildLoginStartResponse<TOptions>(
  options: TOptions,
  credential: Pick<DbCredential, 'id' | 'prf_salt' | 'device_name'>,
): {
  options: TOptions
  prfSalt: string
  credentialId: string
  deviceName: string | null
} {
  return {
    options,
    prfSalt: credential.prf_salt,
    credentialId: credential.id,
    deviceName: credential.device_name,
  }
}

export function buildLoginFinishResponse(
  credential: Pick<DbCredential, 'wrapped_master_key' | 'encryption_iv' | 'id' | 'device_name'>,
): {
  wrappedKey: string
  iv: string
  credentialId: string
  deviceName: string | null
} {
  return {
    wrappedKey: credential.wrapped_master_key,
    iv: credential.encryption_iv,
    credentialId: credential.id,
    deviceName: credential.device_name,
  }
}
