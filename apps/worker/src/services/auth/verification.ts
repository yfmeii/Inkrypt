import type { Context } from 'hono'
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { VerifiedAuthenticationResponse, VerifiedRegistrationResponse } from '@simplewebauthn/server'
import type { AppEnv } from '../../env'
import type { DbCredential } from '../../repositories/credentials'
import { base64UrlToBytes } from '../../utils/base64'

export type VerificationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: 'VERIFY_FAILED' | 'NOT_VERIFIED'; message?: string }

type RegistrationInfo = NonNullable<VerifiedRegistrationResponse['registrationInfo']>
type AuthenticationInfo = NonNullable<VerifiedAuthenticationResponse['authenticationInfo']>

export async function verifyRegistration(
  env: AppEnv['Bindings'],
  attestation: unknown,
  expectedChallenge: string,
): Promise<VerificationResult<RegistrationInfo>> {
  let verification: VerifiedRegistrationResponse
  try {
    verification = await verifyRegistrationResponse({
      response: attestation as any,
      expectedChallenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      requireUserVerification: true,
    })
  } catch (err) {
    return { ok: false, error: 'VERIFY_FAILED', message: (err as Error).message }
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, error: 'NOT_VERIFIED' }
  }

  return { ok: true, value: verification.registrationInfo }
}

export async function verifyAuthentication(
  env: AppEnv['Bindings'],
  assertion: unknown,
  expectedChallenge: string,
  credential: DbCredential,
): Promise<VerificationResult<AuthenticationInfo>> {
  let verification: VerifiedAuthenticationResponse
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion as any,
      expectedChallenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      credential: {
        id: credential.id,
        publicKey: base64UrlToBytes(credential.public_key),
        counter: credential.counter ?? 0,
        transports: [],
      },
      requireUserVerification: true,
    })
  } catch (err) {
    return { ok: false, error: 'VERIFY_FAILED', message: (err as Error).message }
  }

  if (!verification.verified || !verification.authenticationInfo) {
    return { ok: false, error: 'NOT_VERIFIED' }
  }

  return { ok: true, value: verification.authenticationInfo }
}

export function verificationErrorResponse(
  c: Context<AppEnv>,
  verification: Extract<VerificationResult<unknown>, { ok: false }>,
): Response {
  return c.json(
    verification.message
      ? { error: verification.error, message: verification.message }
      : { error: verification.error },
    400,
  )
}
