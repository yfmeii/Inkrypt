import {
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser'
import type { Bytes } from './crypto'

function toBytes(value: unknown): Bytes | null {
  if (!value) return null
  if (value instanceof ArrayBuffer) return new Uint8Array(value) as Bytes
  if (ArrayBuffer.isView(value)) {
    const out = new Uint8Array(value.byteLength)
    out.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    return out as Bytes
  }
  return null
}

export function extractPrfResultFirst(clientExtensionResults: unknown): Bytes | null {
  const prf = (clientExtensionResults as any)?.prf
  const candidate =
    prf?.results?.first ??
    prf?.result?.first ??
    prf?.results?.[0] ??
    prf?.first ??
    null
  const bytes = toBytes(candidate)
  if (!bytes || bytes.byteLength !== 32) return null
  return bytes
}

export async function startRegistrationWithPrf(
  optionsJSON: any,
  prfSalt: Uint8Array,
): Promise<{ attestation: RegistrationResponseJSON; prfOutput: Bytes }> {
  const options = {
    ...optionsJSON,
    extensions: {
      ...(optionsJSON?.extensions ?? {}),
      prf: {
        eval: { first: prfSalt },
      },
    },
  }

  const attestation = await startRegistration({ optionsJSON: options })
  const prfOutput = extractPrfResultFirst(attestation.clientExtensionResults)
  if (!prfOutput) throw new Error('当前浏览器或 Passkey 不支持 PRF 扩展。请更新浏览器或更换 Passkey 提供方后重试')

  return { attestation, prfOutput }
}

export async function startAuthenticationWithPrf(
  optionsJSON: any,
  prfSalt: Uint8Array,
): Promise<{ assertion: AuthenticationResponseJSON; prfOutput: Bytes }> {
  const options = {
    ...optionsJSON,
    extensions: {
      ...(optionsJSON?.extensions ?? {}),
      prf: {
        eval: { first: prfSalt },
      },
    },
  }

  const assertion = await startAuthentication({ optionsJSON: options })
  const prfOutput = extractPrfResultFirst(assertion.clientExtensionResults)
  if (!prfOutput) throw new Error('当前浏览器或 Passkey 不支持 PRF 扩展。请更新浏览器或更换 Passkey 提供方后重试')

  return { assertion, prfOutput }
}
