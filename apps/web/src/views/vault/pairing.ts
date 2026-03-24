import { useState } from 'react'
import type { Bytes } from '../../lib/crypto'
import { postJSON } from '../../lib/api'
import { formatErrorZh } from '../../lib/errors'
import {
  encryptMasterKeyForTransfer,
  exportPublicKeyJwk,
  generateEphemeralEcdhKeyPair,
} from '../../lib/pairing'
import { ensureSharedSecretAndSas, pollHandshake, useHandshakeRunState } from '../handshakeSession'

export type PairingState = {
  sessionCode: string
  sessionSecret: string
  expiresAt: number
  sas: string | null
  sharedSecret: ArrayBuffer | null
  stage: 'waiting_join' | 'sas' | 'sent'
  sasConfirmed: boolean
}

export function useVaultPairing(masterKey: Bytes | null) {
  const { beginRun, cancelRun, setKeyPair, isCurrentRun } = useHandshakeRunState()
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingError, setPairingError] = useState<string | null>(null)
  const [pairing, setPairing] = useState<PairingState | null>(null)

  async function startPairing() {
    if (!masterKey) return
    setPairingError(null)
    setPairingBusy(true)

    const runId = beginRun()

    try {
      const keyPair = await generateEphemeralEcdhKeyPair()
      setKeyPair(keyPair)
      const publicKey = await exportPublicKeyJwk(keyPair.publicKey)

      const resp = await postJSON<{ sessionCode: string; sessionSecret: string; expiresAt: number }>(
        '/api/handshake/init',
        { publicKey },
      )

      void navigator.clipboard.writeText(resp.sessionSecret).catch(() => null)
      setPairing({
        sessionCode: resp.sessionCode,
        sessionSecret: resp.sessionSecret,
        expiresAt: resp.expiresAt,
        sas: null,
        sharedSecret: null,
        stage: 'waiting_join',
        sasConfirmed: false,
      })

      let sharedSecret: ArrayBuffer | null = null

      await pollHandshake({
        runId,
        isCurrentRun,
        poll: () =>
          postJSON<{
          status: 'waiting_join' | 'waiting_confirm' | 'finished'
          expiresAt: number
          bobPublicKey: JsonWebKey | null
        }>('/api/handshake/status/alice', { sessionCode: resp.sessionCode, sessionSecret: resp.sessionSecret }),
        onStatus: async (status) => {
          setPairing((prev) => (prev ? { ...prev, expiresAt: status.expiresAt } : prev))

          if (!status.bobPublicKey || !keyPair.privateKey) return false

          sharedSecret = await ensureSharedSecretAndSas({
            sharedSecret,
            localPrivateKey: keyPair.privateKey,
            remotePublicKey: status.bobPublicKey,
            onDerived: (nextSharedSecret, sas) => {
              setPairing((prev) =>
                prev
                  ? { ...prev, sharedSecret: nextSharedSecret, sas, stage: 'sas', sasConfirmed: false }
                  : prev,
              )
            },
          })

          return true
        },
      })
    } catch (err) {
      setPairingError(formatErrorZh(err))
    } finally {
      setPairingBusy(false)
    }
  }

  async function cancelPairing() {
    const code = pairing?.sessionCode
    const secret = pairing?.sessionSecret
    cancelRun()
    setPairing(null)
    if (code && secret) {
      void postJSON('/api/handshake/cancel', { sessionCode: code, sessionSecret: secret }).catch(() => null)
    }
  }

  async function confirmPairing() {
    if (!pairing || !pairing.sharedSecret || !masterKey) return
    setPairingError(null)
    setPairingBusy(true)
    try {
      const { encryptedPayload, iv } = await encryptMasterKeyForTransfer(pairing.sharedSecret, masterKey)
      await postJSON('/api/handshake/confirm', {
        sessionCode: pairing.sessionCode,
        sessionSecret: pairing.sessionSecret,
        encryptedPayload,
        iv,
      })
      setPairing((prev) => (prev ? { ...prev, stage: 'sent' } : prev))
    } catch (err) {
      setPairingError(formatErrorZh(err))
    } finally {
      setPairingBusy(false)
    }
  }

  return {
    pairing,
    setPairing,
    pairingBusy,
    pairingError,
    setPairingError,
    startPairing,
    cancelPairing,
    confirmPairing,
  }
}
