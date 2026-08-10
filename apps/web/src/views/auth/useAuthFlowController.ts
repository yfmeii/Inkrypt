import { useState } from 'react'
import {
  loginFinishResponseSchema,
  loginStartResponseSchema,
  okResponseSchema,
  registerStartResponseSchema,
} from '@inkrypt/contracts/auth'
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
import {
  startAuthenticationWithCredentialPrf,
  startAuthenticationWithPrf,
  startRegistrationWithPrf,
} from '../../lib/webauthn'

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
  setupToken: string
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
  setupToken,
  rememberUnlock,
  credentialStorageKey,
  onSessionReady,
}: UseAuthFlowControllerArgs) {
  const [prepared, setPrepared] = useState<any | null>(null)
  const [preparedPrfSalt, setPreparedPrfSalt] = useState<string | null>(null)
  const [preparedPrfSaltsByCredential, setPreparedPrfSaltsByCredential] = useState<Record<string, string> | null>(null)
  const [preparedCeremonyId, setPreparedCeremonyId] = useState<string | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  function clearAuthError() {
    setAuthError(null)
  }

  function resetAuthFlowState() {
    setPrepared(null)
    setPreparedPrfSalt(null)
    setPreparedPrfSaltsByCredential(null)
    setPreparedCeremonyId(null)
    setAuthError(null)
    setAuthBusy(false)
  }

  async function prepare() {
    if (mode === 'pair') return

    setAuthError(null)
    setPrepared(null)
    setPreparedPrfSalt(null)
    setPreparedPrfSaltsByCredential(null)
    setPreparedCeremonyId(null)
    setAuthBusy(true)

    try {
      if (mode === 'setup') {
        const normalizedSetupToken = setupToken.trim()
        if (!normalizedSetupToken) {
          setAuthError('请输入部署时配置的一次性初始化口令')
          return
        }
        const resp = await postJSON('/auth/register/start', {
          setupToken: normalizedSetupToken,
          clientRequestId: crypto.randomUUID(),
        }, registerStartResponseSchema)
        if (resp.initialized) {
          setAuthError('该保险库已创建；请直接在本设备"解锁"，或用"添加新设备"。')
          return
        }

        setPrepared(resp.options)
        setPreparedCeremonyId(resp.ceremonyId)
        return
      }

      const preferredCredentialId = localStorage.getItem(credentialStorageKey) || undefined
      const resp = await postJSON('/auth/login/start', {
        credentialId: preferredCredentialId,
        clientRequestId: crypto.randomUUID(),
        capabilities: { prfEvalByCredential: true },
      }, loginStartResponseSchema)

      setPrepared(resp.options)
      setPreparedPrfSalt(resp.prfSalt ?? null)
      setPreparedPrfSaltsByCredential(resp.credentialPrfSalts ?? null)
      setPreparedCeremonyId(resp.ceremonyId)
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
    if (!preparedCeremonyId) {
      setAuthError('认证会话已失效，请点击“重新准备”后再试')
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
          ceremonyId: preparedCeremonyId,
          attestation,
          prfSalt: bytesToBase64Url(prfSalt),
          wrappedKey,
          iv,
          deviceName: normalizedDeviceName ?? undefined,
        }, okResponseSchema)

        localStorage.setItem(credentialStorageKey, attestation.id)
        onSessionReady({
          masterKey,
          credentialId: attestation.id,
          deviceName: normalizedDeviceName,
          remember: rememberUnlock,
        })
        return
      }

      const authentication = preparedPrfSaltsByCredential
        ? await startAuthenticationWithCredentialPrf(
            prepared,
            Object.fromEntries(
              Object.entries(preparedPrfSaltsByCredential).map(([credentialId, prfSalt]) => [
                credentialId,
                base64UrlToBytes(prfSalt),
              ]),
            ),
          )
        : preparedPrfSalt
          ? await startAuthenticationWithPrf(prepared, base64UrlToBytes(preparedPrfSalt))
          : null
      if (!authentication) throw new Error('认证参数异常，请点击"重新准备"后再试')
      const { assertion, prfOutput } = authentication
      const resp = await postJSON(
        '/auth/login/finish',
        { ceremonyId: preparedCeremonyId, assertion },
        loginFinishResponseSchema,
      )

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
