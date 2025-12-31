import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ScanLineIcon,
  TrashIcon,
  KeyIcon,
  PlusIcon,
  LinkIcon,
  ChevronDownIcon,
  InfoIcon,
} from 'lucide-react'
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

// shadcn UI components
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { AuroraBackground } from '@/components/animate-ui/aurora-background'
import { Spinner } from '@/components/ui/spinner'

type Mode = 'unlock' | 'setup' | 'pair'

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

  // 更新浏览器标题为自定义显示名称
  useEffect(() => {
    document.title = brandName
  }, [brandName])

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
          setError('该保险库已创建；请直接在本设备"解锁"，或用"添加新设备"。')
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
          setPairingSas(await generateSasEmoji(sharedSecret))
        }

        if (status.status === 'finished' && status.encryptedPayload && status.iv) {
          if (!sharedSecret) {
            sharedSecret = await deriveSharedSecretBits(
              keyPair.privateKey,
              status.alicePublicKey as JsonWebKey,
            )
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
      setError('请先完成"连接旧设备"，并等待密钥传输完成。')
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
    <AuroraBackground>
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{
          delay: 0.3,
          duration: 0.8,
          ease: "easeInOut",
        }}
        className="relative z-10 w-full max-w-lg px-4"
      >
        <ToastStack>
          {busy && !error ? <Toast kind="loading" message={prepared ? '处理中…' : '正在准备验证…'} /> : null}
          {error ? <Toast kind="error" message={error} onClose={() => setError(null)} /> : null}
        </ToastStack>

        {/* Header */}
        <header className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2 text-foreground">
            {brandName.includes('Credit') ? (
              <>
                {brandName.replace('Credit', '')}
                <span className="font-serif italic text-primary">Credit</span>
              </>
            ) : (
              brandName
            )}
          </h1>
          <p className="text-sm text-muted-foreground font-light">
            用 Passkey 解锁你的保险库。笔记默认端到端加密，只在你的设备解密。
          </p>
        </header>

        {/* Auth Card */}
        <Card className="shadow-lg backdrop-blur-sm bg-background/95">
          <CardContent className="pt-6">
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-6">
                <TabsTrigger value="unlock" className="text-xs sm:text-sm">
                  <KeyIcon className="size-4 mr-1.5 hidden sm:inline" />
                  解锁
                </TabsTrigger>
                <TabsTrigger value="setup" className="text-xs sm:text-sm">
                  <PlusIcon className="size-4 mr-1.5 hidden sm:inline" />
                  创建保险库
                </TabsTrigger>
                <TabsTrigger value="pair" className="text-xs sm:text-sm">
                  <LinkIcon className="size-4 mr-1.5 hidden sm:inline" />
                  添加新设备
                </TabsTrigger>
              </TabsList>

              {/* Unlock Tab */}
              <TabsContent value="unlock" className="space-y-4">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold">{title}</h2>
                  <p className="text-sm text-muted-foreground">
                    使用本设备的 Passkey 解锁保险库
                  </p>
                </div>

                {/* Remember unlock checkbox */}
                <RememberUnlockSection
                  checked={rememberUnlock}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setConfirmRememberUnlock(true)
                    } else {
                      setRememberUnlock(false)
                      try {
                        localStorage.setItem(LS_REMEMBER_UNLOCK, '0')
                      } catch {}
                    }
                  }}
                />

                <div className="flex gap-2 pt-2">
                  <Button onClick={finish} disabled={busy || !prepared} className="flex-1 rounded-full shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all active:scale-95">
                    {busy && <Spinner className="mr-1" />}
                    解锁
                  </Button>
                  <Button variant="outline" onClick={prepare} disabled={busy} className="rounded-full">
                    重新准备
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  {prepared ? '已准备就绪。' : busy ? '正在准备验证…' : '正在准备验证…（如长时间无响应，可点击"重新准备"）'}
                </p>

                <HelpSection mode={mode} />
              </TabsContent>

              {/* Setup Tab */}
              <TabsContent value="setup" className="space-y-4">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold">{title}</h2>
                  <p className="text-sm text-muted-foreground">
                    首次使用：创建保险库并绑定本设备 Passkey
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="setup-device-name">设备名称（可选）</Label>
                  <Input
                    id="setup-device-name"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    placeholder="例如：我的手机 / 家用电脑"
                  />
                </div>

                <RememberUnlockSection
                  checked={rememberUnlock}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setConfirmRememberUnlock(true)
                    } else {
                      setRememberUnlock(false)
                      try {
                        localStorage.setItem(LS_REMEMBER_UNLOCK, '0')
                      } catch {}
                    }
                  }}
                />

                <div className="flex gap-2 pt-2">
                  <Button onClick={finish} disabled={busy || !prepared} className="flex-1 rounded-full shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all active:scale-95">
                    {busy && <Spinner className="mr-1" />}
                    完成
                  </Button>
                  <Button variant="outline" onClick={prepare} disabled={busy} className="rounded-full">
                    重新准备
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  {prepared ? '已准备就绪。' : busy ? '正在准备验证…' : '正在准备验证…（如长时间无响应，可点击"重新准备"）'}
                </p>

                <HelpSection mode={mode} />
              </TabsContent>

              {/* Pair Tab */}
              <TabsContent value="pair" className="space-y-4">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold">{title}</h2>
                  <p className="text-sm text-muted-foreground">
                    从已登录设备添加新设备（配对口令 + Emoji 校验）
                  </p>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  {canScanQr && (
                    <Button variant="outline" onClick={() => setScanOpen(true)} disabled={busy} className="rounded-full">
                      <ScanLineIcon className="size-4 mr-1.5" />
                      扫码输入
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => setPairWords(Array.from({ length: PAIRING_SECRET_WORD_COUNT }, () => ''))}
                    disabled={busy}
                    className="rounded-full"
                  >
                    <TrashIcon className="size-4 mr-1.5" />
                    清空
                  </Button>
                </div>

                {/* Pair words grid */}
                <div className="space-y-2">
                  <Label>配对口令（{PAIRING_SECRET_WORD_COUNT} 个英文单词，约 5 分钟内有效）</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {pairWords.map((word, idx) => {
                      const resolved = resolvePairingWord(word)
                      const cleaned = normalizePairWordInput(word)
                      const invalid = Boolean(cleaned) && cleaned.length >= 4 && !resolved
                      return (
                        <Input
                          key={idx}
                          ref={(el) => {
                            pairWordRefs.current[idx] = el
                          }}
                          className={cn(invalid && 'border-destructive ring-destructive/20')}
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

                  {/* Suggestions */}
                  {activePairWordSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {activePairWordSuggestions.map((w) => (
                        <Button
                          key={w}
                          variant="outline"
                          size="sm"
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
                        </Button>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    支持粘贴整段口令；也支持输入每个单词前 4 个字母。
                  </p>
                </div>

                {/* Device name */}
                <div className="space-y-2">
                  <Label htmlFor="pair-device-name">设备名称（可选）</Label>
                  <Input
                    id="pair-device-name"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    placeholder="例如：我的手机 / 家用电脑"
                  />
                </div>

                {/* SAS Emoji */}
                {pairingSas && (
                  <Alert>
                    <InfoIcon className="size-4" />
                    <AlertTitle>Emoji 指纹</AlertTitle>
                    <AlertDescription>
                      <span className="text-2xl mr-2">{pairingSas}</span>
                      <span className="text-xs block mt-1">
                        请和旧设备上的 Emoji 指纹核对一致，再在旧设备点击"确认一致"。
                      </span>
                    </AlertDescription>
                  </Alert>
                )}

                {pairingExpiresAt && (
                  <p className="text-xs text-muted-foreground">
                    有效期至：{new Date(pairingExpiresAt).toLocaleTimeString()}
                  </p>
                )}

                <RememberUnlockSection
                  checked={rememberUnlock}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setConfirmRememberUnlock(true)
                    } else {
                      setRememberUnlock(false)
                      try {
                        localStorage.setItem(LS_REMEMBER_UNLOCK, '0')
                      } catch {}
                    }
                  }}
                />

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={startPairing} disabled={busy || !pairingTicketValid} className="rounded-full">
                    1. 连接旧设备
                  </Button>
                  <Button onClick={finishPairing} disabled={busy || !prepared || !pairingMasterKey} className="flex-1 rounded-full shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all active:scale-95">
                    {busy && <Spinner className="mr-1" />}
                    2. 创建 Passkey 并完成
                  </Button>
                </div>

                <HelpSection mode={mode} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="mt-8 text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} {brandName}. 版权所有
        </div>
      </motion.div>

      {/* QR Scanner Modal */}
      <AnimatePresence>
        {scanOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              className="w-full max-w-md"
            >
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>扫码输入配对口令</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => setScanOpen(false)} className="rounded-full">
                    关闭
                  </Button>
                </CardHeader>
                <CardContent>
                  <video ref={scanVideoRef} className="w-full max-h-[60vh] rounded-lg bg-black" muted playsInline />
                  <p className="text-xs text-muted-foreground mt-2">请将二维码对准相机。</p>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm remember unlock dialog */}
      {confirmRememberUnlock && (
        <ConfirmDialog
          title="开启「记住解锁」？"
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
            } catch {}
          }}
        />
      )}
    </AuroraBackground>
  )
}

function RememberUnlockSection({
  checked,
  onCheckedChange,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <Checkbox checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
        <span>记住解锁（14 天，谨慎开启）</span>
      </label>

      <button
        type="button"
        onClick={() => setDetailsOpen(!detailsOpen)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDownIcon className={cn('size-3 transition-transform', detailsOpen && 'rotate-180')} />
        风险说明（建议仅在个人可信设备开启）
      </button>

      <AnimatePresence initial={false}>
        {detailsOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden text-xs text-muted-foreground bg-muted p-3 rounded-md"
          >
            开启后会在本机保存用于快速解锁的材料；若发生 XSS/恶意扩展等同源脚本执行，攻击者可能绕过 Passkey 解锁你的保险库。
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function HelpSection({ mode }: { mode: Mode }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDownIcon className={cn('size-3 transition-transform', open && 'rotate-180')} />
        使用说明
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden text-xs text-muted-foreground bg-muted p-3 rounded-md mt-2 space-y-2"
          >
            {mode === 'unlock' && (
              <ul className="list-disc list-inside space-y-1">
                <li>打开页面会自动准备验证参数；若长时间无响应，可点击"重新准备"。</li>
                <li>点击"解锁"：弹出 Passkey 验证（指纹/人脸/安全钥匙）。</li>
                <li>验证通过后进入笔记库；你的内容会在本机解密。</li>
              </ul>
            )}

            {mode === 'setup' && (
              <ul className="list-disc list-inside space-y-1">
                <li>打开页面会自动准备注册参数；若长时间无响应，可点击"重新准备"。</li>
                <li>点击"完成"：创建 Passkey；同时在本机生成主密钥（不会上传明文）。</li>
                <li>创建完成后进入笔记库；建议尽快在"设置"里离线备份"恢复码"。</li>
              </ul>
            )}

            {mode === 'pair' && (
              <ul className="list-disc list-inside space-y-1">
                <li>在已登录设备打开"设置"→"添加新设备"，获取一次性配对口令。</li>
                <li>新设备输入/粘贴配对口令并点击"连接旧设备"。</li>
                <li>两台设备会显示同一组 Emoji 指纹：请核对一致，再在旧设备点击"确认一致"。</li>
                <li>新设备收到主密钥后，点击"创建 Passkey 并完成"。</li>
              </ul>
            )}

            <p className="mt-2">
              兼容性：需要浏览器支持 WebAuthn（Passkey）及 PRF 扩展；若提示不支持，请更新浏览器或更换 Passkey 提供方。
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
