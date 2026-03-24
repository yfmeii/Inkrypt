import { useState } from 'react'
import { postJSON } from '../../lib/api'
import {
  type Bytes,
  base64UrlToBytes,
  bytesToBase64Url,
  randomBytes,
  unwrapMasterKey,
  wrapMasterKey,
} from '../../lib/crypto'
import { formatErrorZh } from '../../lib/errors'
import { startAuthenticationWithPrf, startRegistrationWithPrf } from '../../lib/webauthn'

export type AuthFlowMode = 'unlock' | 'setup' | 'pair'

type SessionPayload = {
  masterKey: Bytes
  credentialId: string
  deviceName: string | null
  remember: boolean
}

type UseAuthFlowControllerArgs = {
  mode: AuthFlowMode
  deviceName: string
  rememberUnlock: boolean
  credentialStorageKey: string
  onSessionReady: (session: SessionPayload) => void
}

function normalizeAuthDeviceName(deviceName: string): string | null {
  const trimmed = deviceName.trim()
  return trimmed || null
}

export function useAuthFlowController({
  mode,
  deviceName,
  rememberUnlock,
  credentialStorageKey,
  onSessionReady,
}: UseAuthFlowControllerArgs) {
  const [prepared, setPrepared] = useState<any | null>(null)
  const [preparedPrfSalt, setPreparedPrfSalt] = useState<string | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  function clearAuthError() {
    setAuthError(null)
  }

  function resetAuthFlowState() {
    setPrepared(null)
    setPreparedPrfSalt(null)
    setAuthError(null)
    setAuthBusy(false)
  }

  async function prepare() {
    if (mode === 'pair') return

    setAuthError(null)
    setPrepared(null)
    setPreparedPrfSalt(null)
    setAuthBusy(true)

    try {
      if (mode === 'setup') {
        const resp = await postJSON<{ initialized: boolean; options?: any }>('/auth/register/start', {})
        if (resp.initialized) {
          setAuthError('该保险库已创建；请直接在本设备"解锁"，或用"添加新设备"。')
          return
        }

        setPrepared(resp.options)
        return
      }

      const preferredCredentialId = localStorage.getItem(credentialStorageKey) || undefined
      const resp = await postJSON<{
        options: any
        prfSalt: string
        credentialId: string
        deviceName: string | null
      }>('/auth/login/start', { credentialId: preferredCredentialId })

      setPrepared(resp.options)
      setPreparedPrfSalt(resp.prfSalt)
    } catch (err) {
      setAuthError(formatErrorZh(err))
    } finally {
      setAuthBusy(false)
    }
  }

  async function finish() {
    if (mode === 'pair') return

    setAuthError(null)
    if (!prepared) {
      setAuthError('正在准备验证参数，请稍候…')
      if (!authBusy) void prepare()
      return
    }

    setAuthBusy(true)

    try {
      const normalizedDeviceName = normalizeAuthDeviceName(deviceName)

      if (mode === 'setup') {
        const masterKey = randomBytes(32)
        const prfSalt = randomBytes(32)

        const { attestation, prfOutput } = await startRegistrationWithPrf(prepared, prfSalt)
        const { wrappedKey, iv } = await wrapMasterKey(masterKey, prfOutput)

        await postJSON('/auth/register/finish', {
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
        return
      }

      if (!preparedPrfSalt) throw new Error('认证参数异常，请点击"重新准备"后再试')
      const prfSaltBytes = base64UrlToBytes(preparedPrfSalt)

      const { assertion, prfOutput } = await startAuthenticationWithPrf(prepared, prfSaltBytes)
      const resp = await postJSON<{
        wrappedKey: string
        iv: string
        credentialId: string
        deviceName: string | null
      }>('/auth/login/finish', { assertion })

      const masterKey = await unwrapMasterKey(resp.wrappedKey, resp.iv, prfOutput)
      onSessionReady({
        masterKey,
        credentialId: resp.credentialId,
        deviceName: resp.deviceName,
        remember: rememberUnlock,
      })
      localStorage.setItem(credentialStorageKey, resp.credentialId)
    } catch (err) {
      setAuthError(formatErrorZh(err))
    } finally {
      setAuthBusy(false)
    }
  }

  return {
    authBusy,
    authError,
    prepared,
    setAuthError,
    clearAuthError,
    resetAuthFlowState,
    prepare,
    finish,
  }
}

export { normalizeAuthDeviceName }
