import { useRef, useState } from 'react'
import { postJSON } from '../../lib/api'
import { type Bytes, bytesToBase64Url, randomBytes, wrapMasterKey } from '../../lib/crypto'
import { formatErrorZh } from '../../lib/errors'
import {
  decryptMasterKeyFromTransfer,
  exportPublicKeyJwk,
  generateEphemeralEcdhKeyPair,
} from '../../lib/pairing'
import { normalizePairingSecret } from '../../lib/pairingSecret'
import { startRegistrationWithPrf } from '../../lib/webauthn'
import { ensureSharedSecretAndSas, pollHandshake, useHandshakeRunState } from '../handshakeSession'

type HandshakeStatus = {
  status: 'waiting_join' | 'waiting_confirm' | 'finished'
  expiresAt: number
  alicePublicKey: any
  encryptedPayload: string | null
  iv: string | null
}

type SessionPayload = {
  masterKey: Bytes
  credentialId: string
  deviceName: string | null
  remember: boolean
}

type UseAuthPairingArgs = {
  deviceName: string
  pairWords: string[]
  rememberUnlock: boolean
  credentialStorageKey: string
  onSessionReady: (session: SessionPayload) => void
}

export function getFinishPairingError(
  pairingPrepared: unknown | null,
  pairingMasterKey: Bytes | null,
): string | null {
  if (!pairingPrepared) {
    return '请先完成"连接旧设备"，并等待密钥传输完成。'
  }
  if (!pairingMasterKey) {
    return '尚未收到主密钥，请稍等或重新开始配对。'
  }

  return null
}

export function normalizePairingDeviceName(deviceName: string): string | null {
  const trimmed = deviceName.trim()
  return trimmed || null
}

export function useAuthPairing({
  deviceName,
  pairWords,
  rememberUnlock,
  credentialStorageKey,
  onSessionReady,
}: UseAuthPairingArgs) {
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingError, setPairingError] = useState<string | null>(null)
  const [pairingPrepared, setPairingPrepared] = useState<any | null>(null)
  const [pairingSas, setPairingSas] = useState<string | null>(null)
  const [pairingExpiresAt, setPairingExpiresAt] = useState<number | null>(null)
  const [pairingMasterKey, setPairingMasterKey] = useState<Bytes | null>(null)

  const pairingSecretRef = useRef<string | null>(null)
  const { beginRun, setKeyPair, cancelRun, isCurrentRun } = useHandshakeRunState()

  function resetPairingState() {
    setPairingError(null)
    setPairingBusy(false)
    setPairingPrepared(null)
    setPairingSas(null)
    setPairingExpiresAt(null)
    setPairingMasterKey(null)
    pairingSecretRef.current = null
    cancelRun()
  }

  async function startPairing() {
    setPairingError(null)
    setPairingBusy(true)
    setPairingPrepared(null)
    setPairingSas(null)
    setPairingExpiresAt(null)
    setPairingMasterKey(null)

    const runId = beginRun()

    try {
      const secret = normalizePairingSecret(pairWords.join(' '))

      const keyPair = await generateEphemeralEcdhKeyPair()
      setKeyPair(keyPair)
      pairingSecretRef.current = secret
      const publicKey = await exportPublicKeyJwk(keyPair.publicKey)

      const joined = await postJSON<{ ok: true; expiresAt: number }>('/api/handshake/join', {
        sessionSecret: secret,
        publicKey,
      })
      setPairingExpiresAt(joined.expiresAt)

      let sharedSecret: ArrayBuffer | null = null
      await pollHandshake({
        runId,
        isCurrentRun,
        poll: () =>
          postJSON<HandshakeStatus>('/api/handshake/status/bob', {
            sessionSecret: secret,
          }),
        onStatus: async (status) => {
          setPairingExpiresAt(status.expiresAt)

          if (status.alicePublicKey && keyPair.privateKey) {
            sharedSecret = await ensureSharedSecretAndSas({
              sharedSecret,
              localPrivateKey: keyPair.privateKey,
              remotePublicKey: status.alicePublicKey as JsonWebKey,
              onDerived: (_nextSharedSecret, sas) => {
                setPairingSas(sas)
              },
            })
          }

          if (!sharedSecret || status.status !== 'finished' || !status.encryptedPayload || !status.iv) {
            return false
          }

          const masterKey = await decryptMasterKeyFromTransfer(sharedSecret, status.encryptedPayload, status.iv)
          if (masterKey.byteLength !== 32) throw new Error('收到的主密钥长度异常')
          setPairingMasterKey(masterKey)

          const resp = await postJSON<{ options: any }>('/auth/device/add/start', { sessionSecret: secret })
          setPairingPrepared(resp.options)
          return true
        },
      })
    } catch (err) {
      setPairingError(formatErrorZh(err))
    } finally {
      setPairingBusy(false)
    }
  }

  async function finishPairing() {
    setPairingError(null)
    const preconditionError = getFinishPairingError(pairingPrepared, pairingMasterKey)
    if (preconditionError) {
      setPairingError(preconditionError)
      return
    }

    setPairingBusy(true)
    try {
      const prepared = pairingPrepared
      const masterKey = pairingMasterKey
      if (!prepared || !masterKey) {
        throw new Error('配对状态已失效，请重新开始配对。')
      }

      const secret = pairingSecretRef.current ?? normalizePairingSecret(pairWords.join(' '))
      const normalizedDeviceName = normalizePairingDeviceName(deviceName)
      const prfSalt = randomBytes(32)
      const { attestation, prfOutput } = await startRegistrationWithPrf(prepared, prfSalt)
      const { wrappedKey, iv } = await wrapMasterKey(masterKey, prfOutput)

      await postJSON('/auth/device/add', {
        sessionSecret: secret,
        attestation,
        prfSalt: bytesToBase64Url(prfSalt),
        wrappedKey,
        iv,
        deviceName: normalizedDeviceName ?? undefined,
      })

      localStorage.setItem(credentialStorageKey, attestation.id)
      onSessionReady({
        masterKey,
        credentialId: attestation.id,
        deviceName: normalizedDeviceName,
        remember: rememberUnlock,
      })
    } catch (err) {
      setPairingError(formatErrorZh(err))
    } finally {
      setPairingBusy(false)
    }
  }

  return {
    pairingBusy,
    pairingError,
    setPairingError,
    pairingPrepared,
    pairingSas,
    pairingExpiresAt,
    pairingMasterKey,
    resetPairingState,
    startPairing,
    finishPairing,
  }
}
