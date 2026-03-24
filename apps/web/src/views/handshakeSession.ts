import { useEffect, useRef } from 'react'
import { deriveSharedSecretBits, generateSasEmoji } from '../lib/pairing'

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function useHandshakeRunState() {
  const runIdRef = useRef(0)
  const keyPairRef = useRef<CryptoKeyPair | null>(null)

  useEffect(() => {
    return () => {
      runIdRef.current += 1
      keyPairRef.current = null
    }
  }, [])

  function beginRun(): number {
    keyPairRef.current = null
    return ++runIdRef.current
  }

  function setKeyPair(keyPair: CryptoKeyPair): void {
    keyPairRef.current = keyPair
  }

  function cancelRun(): void {
    runIdRef.current += 1
    keyPairRef.current = null
  }

  function isCurrentRun(runId: number): boolean {
    return runId === runIdRef.current
  }

  return {
    keyPairRef,
    beginRun,
    setKeyPair,
    cancelRun,
    isCurrentRun,
  }
}

type EnsureSharedSecretAndSasArgs = {
  sharedSecret: ArrayBuffer | null
  localPrivateKey: CryptoKey
  remotePublicKey: JsonWebKey
  onDerived: (sharedSecret: ArrayBuffer, sas: string) => void
}

export async function ensureSharedSecretAndSas({
  sharedSecret,
  localPrivateKey,
  remotePublicKey,
  onDerived,
}: EnsureSharedSecretAndSasArgs): Promise<ArrayBuffer> {
  if (sharedSecret) return sharedSecret

  const nextSharedSecret = await deriveSharedSecretBits(localPrivateKey, remotePublicKey)
  const sas = await generateSasEmoji(nextSharedSecret)
  onDerived(nextSharedSecret, sas)
  return nextSharedSecret
}

type PollHandshakeArgs<TStatus> = {
  runId: number
  isCurrentRun: (runId: number) => boolean
  poll: () => Promise<TStatus>
  onStatus: (status: TStatus) => Promise<boolean> | boolean
  intervalMs?: number
}

export async function pollHandshake<TStatus>({
  runId,
  isCurrentRun,
  poll,
  onStatus,
  intervalMs = 1000,
}: PollHandshakeArgs<TStatus>): Promise<void> {
  while (isCurrentRun(runId)) {
    const status = await poll()
    if (await onStatus(status)) break
    await delay(intervalMs)
  }
}
