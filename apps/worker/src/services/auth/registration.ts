import { generateRegistrationOptions } from '@simplewebauthn/server'
import { isoUint8Array } from '@simplewebauthn/server/helpers'
import type { D1Database } from '../../cloudflare'
import type { AppEnv } from '../../env'
import { persistCredential } from './credentials'
import type { VerificationResult } from './verification'
import { verifyRegistration } from './verification'

type GenerateRegistrationOptionsInput = {
  userId: string
  username: string
  excludeCredentialIds?: string[]
}

type PersistVerifiedRegistrationInput = {
  userId: string
  attestation: unknown
  expectedChallenge: string
  prfSalt: string
  wrappedKey: string
  iv: string
  deviceName?: string
  createdAt: number
}

export async function generatePasskeyRegistrationOptions(
  env: AppEnv['Bindings'],
  input: GenerateRegistrationOptionsInput,
) {
  return generateRegistrationOptions({
    rpName: env.RP_NAME,
    rpID: env.RP_ID,
    userName: input.username,
    userDisplayName: input.username,
    userID: isoUint8Array.fromUTF8String(input.userId),
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    excludeCredentials: (input.excludeCredentialIds ?? []).map((id) => ({ id })),
  })
}

export async function verifyAndPersistRegistration(
  db: D1Database,
  env: AppEnv['Bindings'],
  input: PersistVerifiedRegistrationInput,
): Promise<VerificationResult<{ credential: { id: string; publicKey: Uint8Array; counter: number } }>> {
  const verification = await verifyRegistration(env, input.attestation, input.expectedChallenge)
  if (!verification.ok) return verification

  await persistCredential(db, {
    userId: input.userId,
    credential: verification.value.credential,
    deviceName: input.deviceName,
    prfSalt: input.prfSalt,
    wrappedKey: input.wrappedKey,
    iv: input.iv,
    createdAt: input.createdAt,
  })

  return {
    ok: true,
    value: {
      credential: verification.value.credential,
    },
  }
}
