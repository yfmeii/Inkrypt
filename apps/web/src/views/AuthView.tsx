import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { postJSON } from '../lib/api'
import { type Bytes, base64UrlToBytes, bytesToBase64Url, randomBytes, unwrapMasterKey, wrapMasterKey } from '../lib/crypto'
import { decryptMasterKeyFromTransfer, deriveSharedSecretBits, exportPublicKeyJwk, generateEphemeralEcdhKeyPair, generateSasEmoji } from '../lib/pairing'
import { formatErrorZh } from '../lib/errors'
import {
  PAIRING_SECRET_WORD_COUNT,
  PAIRING_WORDLIST,
  extractPairingSecretFromText,
  normalizePairingSecret,
  resolvePairingWord,
  splitPairingSecretWords,
} from '../lib/pairingSecret'
import { startAuthenticationWithPrf, startRegistrationWithPrf } from '../lib/webauthn'
import { Toast, ToastStack } from '../components/Toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useInkryptStore } from '../state/store'

type Mode = 'unlock' | 'setup' | 'pair'

const TAB_ORDER: Mode[] = ['unlock', 'setup', 'pair']
const TAB_IDS: Record<Mode, string> = {
  unlock: 'auth-tab-unlock',
  setup: 'auth-tab-setup',
  pair: 'auth-tab-pair',
}
const PANEL_IDS: Record<Mode, string> = {
  unlock: 'auth-panel-unlock',
  setup: 'auth-panel-setup',
  pair: 'auth-panel-pair',
}

type HandshakeStatus = {
  status: 'waiting_join' | 'waiting_confirm' | 'finished'
  expiresAt: number
  alicePublicKey: any
  encryptedPayload: string | null
  iv: string | null
}

const LS_CREDENTIAL_ID = 'inkrypt_credential_id'
const LS_REMEMBER_UNLOCK = 'inkrypt_remember_unlock_pref'

function normalizePairWordInput(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z]/g, '')
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function AuthView() {
  const setSession = useInkryptStore((s) => s.setSession)
  const brandName = useInkryptStore((s) => s.brandName)
  const pairingPrefillSecret = useInkryptStore((s) => s.pairingPrefillSecret)
  const consumePairingPrefillSecret = useInkryptStore((s) => s.consumePairingPrefillSecret)

  const [mode, setMode] = useState<Mode>('unlock')
  const [deviceName, setDeviceName] = useState('')
  const [pairWords, setPairWords] = useState<string[]>(() => Array.from({ length: PAIRING_SECRET_WORD_COUNT }, () => ''))
  const [activePairWordIdx, setActivePairWordIdx] = useState<number | null>(null)
  const [rememberUnlock, setRememberUnlock] = useState(() => {
    try {
      const v = localStorage.getItem(LS_REMEMBER_UNLOCK)
      if (v === null) return false
      return v === '1'
    } catch {
      return false
    }
  })
  const [confirmRememberUnlock, setConfirmRememberUnlock] = useState(false)

  const [prepared, setPrepared] = useState<any | null>(null)
  const [preparedPrfSalt, setPreparedPrfSalt] = useState<string | null>(null)

  const [pairingSharedSecret, setPairingSharedSecret] = useState<ArrayBuffer | null>(null)
  const [pairingSas, setPairingSas] = useState<string | null>(null)
  const [pairingExpiresAt, setPairingExpiresAt] = useState<number | null>(null)
  const [pairingMasterKey, setPairingMasterKey] = useState<Bytes | null>(null)
  const pairingSecretRef = useRef<string | null>(null)
  const pairingKeyPairRef = useRef<CryptoKeyPair | null>(null)
  const pairingRunIdRef = useRef(0)
  const pairWordRefs = useRef<Array<HTMLInputElement | null>>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const scanVideoRef = useRef<HTMLVideoElement | null>(null)

  const title = useMemo(() => {
    switch (mode) {
      case 'setup':
        return '创建保险库（首台设备）'
      case 'pair':
        return '添加新设备'
      default:
        return '解锁'
    }
  }, [mode])

  const pairingTicketValid = useMemo(() => {
    try {
      normalizePairingSecret(pairWords.join(' '))
      return true
    } catch {
      return false
    }
  }, [pairWords])

  const activePairWordPrefix = useMemo(() => {
    if (mode !== 'pair') return ''
    if (activePairWordIdx === null) return ''
    return normalizePairWordInput(pairWords[activePairWordIdx] ?? '')
  }, [activePairWordIdx, mode, pairWords])

  const activePairWordSuggestions = useMemo(() => {
    const prefix = activePairWordPrefix
    if (mode !== 'pair') return []
    if (activePairWordIdx === null) return []
    if (prefix.length < 2) return []
    if (!prefix) return []
    if (resolvePairingWord(prefix) === prefix) return []

    const out: string[] = []
    for (const w of PAIRING_WORDLIST) {
      if (w.startsWith(prefix)) out.push(w)
      if (out.length >= 8) break
    }
    return out
  }, [activePairWordIdx, activePairWordPrefix, mode])

  const canScanQr = useMemo(() => {
    if (typeof window === 'undefined') return false
    return Boolean(navigator.mediaDevices?.getUserMedia)
  }, [])

  function focusTab(next: Mode): void {
    const el = document.getElementById(TAB_IDS[next])
    if (!el) return
    try {
      ;(el as HTMLButtonElement).focus()
    } catch {
      // ignore
    }
  }

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>): void {
    const idx = TAB_ORDER.indexOf(mode)
    if (idx < 0) return

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const delta = e.key === 'ArrowRight' ? 1 : -1
      const next = TAB_ORDER[(idx + delta + TAB_ORDER.length) % TAB_ORDER.length]
      setMode(next)
      requestAnimationFrame(() => focusTab(next))
      return
    }

    if (e.key === 'Home') {
      e.preventDefault()
      setMode(TAB_ORDER[0])
      requestAnimationFrame(() => focusTab(TAB_ORDER[0]))
      return
    }

    if (e.key === 'End') {
      e.preventDefault()
      const last = TAB_ORDER[TAB_ORDER.length - 1]
      setMode(last)
      requestAnimationFrame(() => focusTab(last))
    }
  }

  useEffect(() => {
    return () => {
      pairingRunIdRef.current += 1
    }
  }, [])

  function resetTransientState() {
    setPrepared(null)
    setPreparedPrfSalt(null)
    setError(null)
    setBusy(false)

    setPairingSharedSecret(null)
    setPairingSas(null)
    setPairingExpiresAt(null)
    setPairingMasterKey(null)
    pairingSecretRef.current = null
    pairingKeyPairRef.current = null
    pairingRunIdRef.current += 1
  }

  useEffect(() => {
    resetTransientState()
    if (mode === 'unlock' || mode === 'setup') {
      void prepare()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  useEffect(() => {
    if (!pairingPrefillSecret) return
    const secret = consumePairingPrefillSecret()
    if (!secret) return

    setScanOpen(false)
    setMode('pair')
    setPairWords(splitPairingSecretWords(secret))

    requestAnimationFrame(() => {
      pairWordRefs.current[0]?.focus()
    })
  }, [consumePairingPrefillSecret, pairingPrefillSecret])

  useEffect(() => {
    if (!scanOpen) return
    if (!canScanQr) {
      setError('当前浏览器不支持扫码，请手动输入或粘贴配对口令。')
      setScanOpen(false)
      return
    }

    let alive = true
    let scanner: { start: () => Promise<void>; stop: () => void; destroy: () => void } | null = null

    void (async () => {
      const video = scanVideoRef.current
      if (!video) {
        setError('扫码初始化失败，请重试或改为手动输入。')
        setScanOpen(false)
        return
      }

      try {
        const [{ default: QrScanner }, { default: workerUrl }] = await Promise.all([
          import('qr-scanner'),
          import('qr-scanner/qr-scanner-worker.min.js?url'),
        ])

        QrScanner.WORKER_PATH = workerUrl
        if (!alive) return

        const s = new QrScanner(
          video,
          (result: any) => {
            const rawValue =
              typeof result === 'string' ? result : typeof result?.data === 'string' ? result.data : null
            if (!rawValue || !alive) return

            const secret = extractPairingSecretFromText(rawValue)
            if (!secret) return

            setPairWords(splitPairingSecretWords(secret))
            setScanOpen(false)
          },
          {
            preferredCamera: 'environment',
            highlightScanRegion: true,
            highlightCodeOutline: true,
            returnDetailedScanResult: true,
            onDecodeError: () => null,
          },
        ) as any

        scanner = s
        await s.start()
      } catch {
        if (!alive) return
        setError('无法打开摄像头，请检查权限或改为手动输入。')
        setScanOpen(false)
      }
    })()

    return () => {
      alive = false
      if (!scanner) return
      try {
        scanner.stop()
      } catch {
        // ignore
      }
      try {
        scanner.destroy()
      } catch {
        // ignore
      }
    }
  }, [canScanQr, scanOpen])

  async function prepare() {
    setError(null)
    setPrepared(null)
    setPreparedPrfSalt(null)
    setBusy(true)
    try {
      if (mode === 'setup') {
        const resp = await postJSON<{ initialized: boolean; options?: any }>('/auth/register/start', {})
        if (resp.initialized) {
          setError('该保险库已创建；请直接在本设备“解锁”，或用“添加新设备”。')
          return
        }
        setPrepared(resp.options)
        return
      }

      if (mode === 'unlock') {
        const preferredCredentialId = localStorage.getItem(LS_CREDENTIAL_ID) || undefined
       const resp = await postJSON<{
         options: any
         prfSalt: string
         credentialId: string
         deviceName: string | null
       }>('/auth/login/start', { credentialId: preferredCredentialId })

        setPrepared(resp.options)
        setPreparedPrfSalt(resp.prfSalt)
        return
      }
    } catch (err) {
      setError(formatErrorZh(err))
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    setError(null)
    if (!prepared) {
      setError('正在准备验证参数，请稍候…')
      if (!busy) void prepare()
      return
    }

    setBusy(true)
    try {
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
          deviceName: deviceName.trim() ? deviceName.trim() : undefined,
        })

        localStorage.setItem(LS_CREDENTIAL_ID, attestation.id)
        setSession({ masterKey, credentialId: attestation.id, deviceName: deviceName.trim() || null, remember: rememberUnlock })
        return
      }

      if (mode === 'unlock') {
        if (!preparedPrfSalt) throw new Error('认证参数异常，请点击“重新准备”后再试')
        const prfSaltBytes = base64UrlToBytes(preparedPrfSalt)

        const { assertion, prfOutput } = await startAuthenticationWithPrf(prepared, prfSaltBytes)
        const resp = await postJSON<{
          wrappedKey: string
          iv: string
          credentialId: string
          deviceName: string | null
        }>('/auth/login/finish', { assertion })

        const masterKey = await unwrapMasterKey(resp.wrappedKey, resp.iv, prfOutput)
        setSession({
          masterKey,
          credentialId: resp.credentialId,
          deviceName: resp.deviceName,
          remember: rememberUnlock,
        })
        localStorage.setItem(LS_CREDENTIAL_ID, resp.credentialId)
        return
      }
    } catch (err) {
      setError(formatErrorZh(err))
    } finally {
      setBusy(false)
    }
  }

  async function startPairing() {
    setError(null)
    setBusy(true)
    setPrepared(null)
    setPreparedPrfSalt(null)
    setPairingSharedSecret(null)
    setPairingSas(null)
    setPairingExpiresAt(null)
    setPairingMasterKey(null)
    pairingKeyPairRef.current = null

    const runId = ++pairingRunIdRef.current

    try {
      const secret = normalizePairingSecret(pairWords.join(' '))

      const keyPair = await generateEphemeralEcdhKeyPair()
      pairingKeyPairRef.current = keyPair
      pairingSecretRef.current = secret
      const publicKey = await exportPublicKeyJwk(keyPair.publicKey)

      const joined = await postJSON<{ ok: true; expiresAt: number }>('/api/handshake/join', {
        sessionSecret: secret,
        publicKey,
      })
      setPairingExpiresAt(joined.expiresAt)

      let sharedSecret: ArrayBuffer | null = null
      while (runId === pairingRunIdRef.current) {
        const status = await postJSON<HandshakeStatus>('/api/handshake/status/bob', {
          sessionSecret: secret,
        })
        setPairingExpiresAt(status.expiresAt)

        if (!sharedSecret && status.alicePublicKey && keyPair.privateKey) {
          sharedSecret = await deriveSharedSecretBits(
            keyPair.privateKey,
            status.alicePublicKey as JsonWebKey,
          )
          setPairingSharedSecret(sharedSecret)
          setPairingSas(await generateSasEmoji(sharedSecret))
        }

        if (status.status === 'finished' && status.encryptedPayload && status.iv) {
          if (!sharedSecret) {
            sharedSecret = await deriveSharedSecretBits(
              keyPair.privateKey,
              status.alicePublicKey as JsonWebKey,
            )
            setPairingSharedSecret(sharedSecret)
            setPairingSas(await generateSasEmoji(sharedSecret))
          }

          const masterKey = await decryptMasterKeyFromTransfer(
            sharedSecret,
            status.encryptedPayload,
            status.iv,
          )
          if (masterKey.byteLength !== 32) throw new Error('收到的主密钥长度异常')
          setPairingMasterKey(masterKey)

          const resp = await postJSON<{ options: any }>('/auth/device/add/start', { sessionSecret: secret })
          setPrepared(resp.options)
          break
        }

        await delay(1000)
      }
    } catch (err) {
      setError(formatErrorZh(err))
    } finally {
      setBusy(false)
    }
  }

  async function finishPairing() {
    setError(null)
    if (!prepared) {
      setError('请先完成“连接旧设备”，并等待密钥传输完成。')
      return
    }
    if (!pairingMasterKey) {
      setError('尚未收到主密钥，请稍等或重新开始配对。')
      return
    }

    setBusy(true)
    try {
      const secret = pairingSecretRef.current ?? normalizePairingSecret(pairWords.join(' '))
      const prfSalt = randomBytes(32)
      const { attestation, prfOutput } = await startRegistrationWithPrf(prepared, prfSalt)
      const { wrappedKey, iv } = await wrapMasterKey(pairingMasterKey, prfOutput)

      await postJSON('/auth/device/add', {
        sessionSecret: secret,
        attestation,
        prfSalt: bytesToBase64Url(prfSalt),
        wrappedKey,
        iv,
        deviceName: deviceName.trim() ? deviceName.trim() : undefined,
      })

      localStorage.setItem(LS_CREDENTIAL_ID, attestation.id)
      setSession({ masterKey: pairingMasterKey, credentialId: attestation.id, deviceName: deviceName.trim() || null, remember: rememberUnlock })
    } catch (err) {
      setError(formatErrorZh(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <ToastStack>
        {busy && !error ? <Toast kind="loading" message={prepared ? '处理中…' : '正在准备验证…'} /> : null}
        {error ? <Toast kind="error" message={error} onClose={() => setError(null)} /> : null}
      </ToastStack>

      <header className="authHeader">
        <h1>{brandName}</h1>
        <p className="muted">用 Passkey 解锁你的保险库。笔记默认端到端加密，只在你的设备解密。</p>
      </header>

      <div className="card authCard">
        <div className="tabs" role="tablist" aria-label="认证模式">
          <button
            className={mode === 'unlock' ? 'tab active' : 'tab'}
            onClick={() => {
              setMode('unlock')
            }}
            type="button"
            title="使用本设备的 Passkey 解锁保险库"
            id={TAB_IDS.unlock}
            role="tab"
            aria-selected={mode === 'unlock'}
            aria-controls={PANEL_IDS.unlock}
            tabIndex={mode === 'unlock' ? 0 : -1}
            onKeyDown={onTabKeyDown}
          >
            解锁
          </button>
          <button
            className={mode === 'setup' ? 'tab active' : 'tab'}
            onClick={() => {
              setMode('setup')
            }}
            type="button"
            title="首次使用：创建保险库并绑定本设备 Passkey"
            id={TAB_IDS.setup}
            role="tab"
            aria-selected={mode === 'setup'}
            aria-controls={PANEL_IDS.setup}
            tabIndex={mode === 'setup' ? 0 : -1}
            onKeyDown={onTabKeyDown}
          >
            创建保险库
          </button>
          <button
            className={mode === 'pair' ? 'tab active' : 'tab'}
            onClick={() => {
              setMode('pair')
            }}
            type="button"
            title="从已登录设备添加新设备（配对口令 + Emoji 校验）"
            id={TAB_IDS.pair}
            role="tab"
            aria-selected={mode === 'pair'}
            aria-controls={PANEL_IDS.pair}
            tabIndex={mode === 'pair' ? 0 : -1}
            onKeyDown={onTabKeyDown}
          >
            添加新设备
          </button>
        </div>

        <div id={PANEL_IDS[mode]} role="tabpanel" aria-labelledby={TAB_IDS[mode]} tabIndex={0}>
          <h2 className="sectionTitle">{title}</h2>

          {mode === 'pair' ? (
            <>
              <div className="row" style={{ marginTop: 8 }}>
                {canScanQr ? (
                  <button className="btn" type="button" onClick={() => setScanOpen(true)} disabled={busy}>
                    扫码输入
                  </button>
                ) : null}
                <button
                  className="btn"
                  type="button"
                  onClick={() => setPairWords(Array.from({ length: PAIRING_SECRET_WORD_COUNT }, () => ''))}
                  disabled={busy}
                >
                  清空
                </button>
              </div>

              <label className="field">
                <span>配对口令（{PAIRING_SECRET_WORD_COUNT} 个英文单词，约 5 分钟内有效）</span>
                <div className="pairWordsGrid" role="group" aria-label="配对口令">
                  {pairWords.map((word, idx) => {
                    const resolved = resolvePairingWord(word)
                    const cleaned = normalizePairWordInput(word)
                    const invalid = Boolean(cleaned) && cleaned.length >= 4 && !resolved
                    return (
                      <input
                        // eslint-disable-next-line react/no-array-index-key
                        key={idx}
                        ref={(el) => {
                          pairWordRefs.current[idx] = el
                        }}
                        className={invalid ? 'pairWordInput invalid' : 'pairWordInput'}
                        value={word}
                        onChange={(e) => {
                          const nextWord = normalizePairWordInput(e.target.value)
                          setPairWords((prev) => {
                            const next = [...prev]
                            next[idx] = nextWord
                            return next
                          })
                        }}
                        onFocus={() => setActivePairWordIdx(idx)}
                        onBlur={() => {
                          if (!resolved || resolved === word) return
                          setPairWords((prev) => {
                            const next = [...prev]
                            next[idx] = resolved
                            return next
                          })
                        }}
                        onKeyDown={(e) => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault()
                            pairWordRefs.current[Math.min(idx + 1, PAIRING_SECRET_WORD_COUNT - 1)]?.focus()
                            return
                          }
                          if (e.key === 'Backspace' && !word && idx > 0) {
                            pairWordRefs.current[idx - 1]?.focus()
                          }
                        }}
                        onPaste={(e) => {
                          const text = e.clipboardData.getData('text')
                          if (!text) return

                          const extracted = extractPairingSecretFromText(text)
                          if (extracted) {
                            e.preventDefault()
                            setPairWords(splitPairingSecretWords(extracted))
                            requestAnimationFrame(() => {
                              pairWordRefs.current[Math.min(PAIRING_SECRET_WORD_COUNT - 1, idx + 1)]?.focus()
                            })
                            return
                          }

                          const words = splitPairingSecretWords(text)
                          if (words.length <= 1) return
                          e.preventDefault()
                          setPairWords((prev) => {
                            const next = [...prev]
                            for (let i = 0; i < words.length && idx + i < PAIRING_SECRET_WORD_COUNT; i++) {
                              next[idx + i] = words[i]
                            }
                            return next
                          })
                        }}
                        inputMode="text"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder={`单词 ${idx + 1}`}
                      />
                    )
                  })}
                </div>
                {activePairWordSuggestions.length > 0 ? (
                  <div className="pairSuggestions" role="listbox" aria-label="单词建议">
                    {activePairWordSuggestions.map((w) => (
                      <button
                        key={w}
                        className="pairSuggestionBtn"
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const idx = activePairWordIdx
                          if (idx === null) return
                          setPairWords((prev) => {
                            const next = [...prev]
                            next[idx] = w
                            return next
                          })
                          requestAnimationFrame(() => {
                            pairWordRefs.current[Math.min(idx + 1, PAIRING_SECRET_WORD_COUNT - 1)]?.focus()
                          })
                        }}
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="muted small">支持粘贴整段口令；也支持输入每个单词前 4 个字母。</div>
              </label>
              <label className="field">
                <span>设备名称（可选）</span>
                <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="例如：我的手机 / 家用电脑" />
              </label>

              {pairingSas ? (
                <div className="infoBox">
                  <strong>Emoji 指纹：</strong>
                  <span className="sasEmoji">{pairingSas}</span>
                  <div className="muted small">请和旧设备上的 Emoji 指纹核对一致，再在旧设备点击“确认一致”。</div>
                </div>
              ) : null}

              {pairingExpiresAt ? (
                <p className="muted small">有效期至：{new Date(pairingExpiresAt).toLocaleTimeString()}</p>
              ) : null}
            </>
          ) : null}

        {mode === 'setup' ? (
          <label className="field">
            <span>设备名称（可选）</span>
            <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="例如：我的手机 / 家用电脑" />
          </label>
        ) : null}

          <div className="authReminder">
            <label className="rememberRow">
              <input
                type="checkbox"
                checked={rememberUnlock}
                onChange={(e) => {
                  const next = e.target.checked
                  if (next) {
                    setConfirmRememberUnlock(true)
                    return
                  }
                  setRememberUnlock(false)
                  try {
                    localStorage.setItem(LS_REMEMBER_UNLOCK, '0')
                  } catch {
                    // ignore
                  }
                }}
              />
              <span>记住解锁（14 天，谨慎开启）</span>
            </label>

            <details className="help authHelp">
              <summary>风险说明（建议仅在个人可信设备开启）</summary>
              <div className="helpBody">
                <p className="muted small" style={{ margin: 0 }}>
                  开启后会在本机保存用于快速解锁的材料；若发生 XSS/恶意扩展等同源脚本执行，攻击者可能绕过 Passkey 解锁你的保险库。
                </p>
              </div>
            </details>
          </div>

        {mode === 'pair' ? (
          <div className="row authActions">
            <button
              className="btn"
              onClick={startPairing}
              disabled={busy || !pairingTicketValid}
              type="button"
            >
              1. 连接旧设备
            </button>
            <button className="btn primary" onClick={finishPairing} disabled={busy || !prepared || !pairingMasterKey} type="button">
              2. 创建 Passkey 并完成
            </button>
          </div>
        ) : (
          <div className="row authActions">
            <button className="btn primary" onClick={finish} disabled={busy || !prepared} type="button">
              {mode === 'unlock' ? '解锁' : '完成'}
            </button>
            <button className="btn" onClick={prepare} disabled={busy} type="button" title="重新获取验证参数">
              重新准备
            </button>
          </div>
        )}

        {mode !== 'pair' ? (
          <p className="muted small authStatus">
            {prepared ? '已准备就绪。' : busy ? '正在准备验证…' : '正在准备验证…（如长时间无响应，可点击“重新准备”）'}
          </p>
        ) : null}

          <details className="help authHelp">
            <summary>使用说明</summary>
            <div className="helpBody">
            {mode === 'unlock' ? (
              <ul className="helpList">
                <li>打开页面会自动准备验证参数；若长时间无响应，可点击“重新准备”。</li>
                <li>点击“解锁”：弹出 Passkey 验证（指纹/人脸/安全钥匙）。</li>
                <li>验证通过后进入笔记库；你的内容会在本机解密。</li>
              </ul>
            ) : null}

            {mode === 'setup' ? (
              <ul className="helpList">
                <li>打开页面会自动准备注册参数；若长时间无响应，可点击“重新准备”。</li>
                <li>点击“完成”：创建 Passkey；同时在本机生成主密钥（不会上传明文）。</li>
                <li>创建完成后进入笔记库；建议尽快在“设置”里离线备份“恢复码”（用于丢失设备时恢复）。</li>
              </ul>
            ) : null}

            {mode === 'pair' ? (
              <ul className="helpList">
                <li>在已登录设备打开“设置”→“添加新设备”，获取一次性配对口令（{PAIRING_SECRET_WORD_COUNT} 个英文单词 + 二维码，有效期约 5 分钟）。</li>
                <li>新设备输入/粘贴配对口令并点击“连接旧设备”（支持只输入每个单词前 4 个字母）。</li>
                <li>两台设备会显示同一组 Emoji 指纹：请核对一致，再在旧设备点击“确认一致”。</li>
                <li>新设备收到主密钥后，点击“创建 Passkey 并完成”。</li>
              </ul>
            ) : null}

            <p className="muted small">
              兼容性：需要浏览器支持 WebAuthn（Passkey）及 PRF 扩展；若提示不支持，请更新浏览器或更换 Passkey 提供方。
            </p>
            </div>
          </details>
        </div>
      </div>

      {scanOpen ? (
        <div className="modalOverlay" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-label="扫码输入配对口令">
            <div className="row">
              <strong>扫码输入配对口令</strong>
              <button className="btn" type="button" onClick={() => setScanOpen(false)}>
                关闭
              </button>
            </div>
            <video ref={scanVideoRef} className="qrVideo" muted playsInline />
            <p className="muted small" style={{ margin: '8px 0 0' }}>
              请将二维码对准相机。
            </p>
          </div>
        </div>
      ) : null}

      {confirmRememberUnlock ? (
        <ConfirmDialog
          title="开启“记住解锁”？"
          message={
            '开启后，会在本机保存用于快速解锁的材料（有效期 14 天）。\n\n如果浏览器发生同源脚本执行（XSS/恶意扩展/供应链等），攻击者可能绕过 Passkey，直接解密得到主密钥。\n\n仅建议在个人可信设备开启。确定要继续吗？'
          }
          confirmText="我了解风险，继续开启"
          confirmVariant="danger"
          onCancel={() => setConfirmRememberUnlock(false)}
          onConfirm={() => {
            setConfirmRememberUnlock(false)
            setRememberUnlock(true)
            try {
              localStorage.setItem(LS_REMEMBER_UNLOCK, '1')
            } catch {
              // ignore
            }
          }}
        />
      ) : null}
    </div>
  )
}
