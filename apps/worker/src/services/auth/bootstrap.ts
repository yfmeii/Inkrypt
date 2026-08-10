import type { AppEnv } from '../../env'

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
}

export async function verifySetupToken(
  env: AppEnv['Bindings'],
  providedToken: string | undefined,
): Promise<'valid' | 'invalid' | 'misconfigured'> {
  const configuredToken = env.SETUP_TOKEN?.trim()
  if (!configuredToken) return 'misconfigured'
  if (!providedToken) return 'invalid'

  const [configuredDigest, providedDigest] = await Promise.all([
    digest(configuredToken),
    digest(providedToken),
  ])
  if (configuredDigest.byteLength !== providedDigest.byteLength) return 'invalid'

  let difference = 0
  for (let index = 0; index < configuredDigest.byteLength; index += 1) {
    difference |= configuredDigest[index] ^ providedDigest[index]
  }
  return difference === 0 ? 'valid' : 'invalid'
}
