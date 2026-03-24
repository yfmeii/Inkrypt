import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
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
import {
  PAIRING_SECRET_WORD_COUNT,
  extractPairingSecretFromText,
  normalizePairingSecret,
  splitPairingSecretWords,
} from '../lib/pairingSecret'
import { Toast, ToastStack } from '../components/Toast'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useInkryptStore } from '../state/store'
import { PairingWordFields, type PairingWordFieldsHandle } from './auth/PairingWordFields'
import { useAuthFlowController } from './auth/useAuthFlowController'
import { useAuthPairing } from './auth/useAuthPairing'

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

const LS_CREDENTIAL_ID = 'inkrypt_credential_id'
const LS_REMEMBER_UNLOCK = 'inkrypt_remember_unlock_pref'

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
  const pairWordFieldsRef = useRef<PairingWordFieldsHandle | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const scanVideoRef = useRef<HTMLVideoElement | null>(null)

  const {
    authBusy,
    authError,
    prepared,
    setAuthError,
    clearAuthError,
    resetAuthFlowState,
    prepare,
    finish,
  } = useAuthFlowController({
    mode,
    deviceName,
    rememberUnlock,
    credentialStorageKey: LS_CREDENTIAL_ID,
    onSessionReady: setSession,
  })

  const {
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
  } = useAuthPairing({
    deviceName,
    pairWords,
    rememberUnlock,
    credentialStorageKey: LS_CREDENTIAL_ID,
    onSessionReady: setSession,
  })

  const busy = authBusy || pairingBusy
  const error = authError ?? pairingError

  function clearError() {
    clearAuthError()
    setPairingError(null)
  }

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

  const canScanQr = useMemo(() => {
    if (typeof window === 'undefined') return false
    return Boolean(navigator.mediaDevices?.getUserMedia)
  }, [])

  function resetTransientState() {
    resetAuthFlowState()
    resetPairingState()
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
      pairWordFieldsRef.current?.focusWord(0)
    })
  }, [consumePairingPrefillSecret, pairingPrefillSecret])

  useEffect(() => {
    if (!scanOpen) return
    if (!canScanQr) {
      setAuthError('当前浏览器不支持扫码，请手动输入或粘贴配对口令。')
      setScanOpen(false)
      return
    }

    let alive = true
    let scanner: { start: () => Promise<void>; stop: () => void; destroy: () => void } | null = null

    void (async () => {
      const video = scanVideoRef.current
      if (!video) {
        setAuthError('扫码初始化失败，请重试或改为手动输入。')
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
        setAuthError('无法打开摄像头，请检查权限或改为手动输入。')
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
          {busy && !error ? <Toast kind="loading" message={prepared || pairingPrepared ? '处理中…' : '正在准备验证…'} /> : null}
          {error ? <Toast kind="error" message={error} onClose={clearError} /> : null}
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
                  <PairingWordFields ref={pairWordFieldsRef} pairWords={pairWords} onPairWordsChange={setPairWords} />

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
                  <Button onClick={finishPairing} disabled={busy || !pairingPrepared || !pairingMasterKey} className="flex-1 rounded-full shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all active:scale-95">
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

      <QrScannerModal open={scanOpen} videoRef={scanVideoRef} onClose={() => setScanOpen(false)} />

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

function QrScannerModal({
  open,
  videoRef,
  onClose,
}: {
  open: boolean
  videoRef: Ref<HTMLVideoElement>
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
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
                <Button variant="outline" size="sm" onClick={onClose} className="rounded-full">
                  关闭
                </Button>
              </CardHeader>
              <CardContent>
                <video ref={videoRef} className="w-full max-h-[60vh] rounded-lg bg-black" muted playsInline />
                <p className="mt-2 text-xs text-muted-foreground">请将二维码对准相机。</p>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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
