import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { deleteJSON, getJSON, postJSON } from '../lib/api'
import { formatErrorZh } from '../lib/errors'
import { useFocusTrap } from '../lib/focusTrap'
import { useBodyScrollLock } from '../lib/scrollLock'
import type { ModeId, ThemeId } from '../state/store'
import { THEME_META } from '../lib/themes'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Card, CardContent } from './ui/card'
import { ScrollArea } from './ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'
import {
  X,
  RefreshCw,
  Pencil,
  Trash2,
  Smartphone,
  Cloud,
  Key,
  HelpCircle,
  Check,
  Sun,
  Moon,
  Monitor,
  Loader2,
  ChevronRight,
} from 'lucide-react'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  brandName: string
  onSetBrandName: (brandName: string) => void
  theme: ThemeId
  onSetTheme: (theme: ThemeId) => void
  mode: ModeId
  onSetMode: (mode: ModeId) => void
  credentialId: string | null
  onSetDeviceName: (deviceName: string | null) => void
  onLock: () => void
  busy: boolean
  pairingBusy: boolean
  masterKey: Uint8Array | null
  onSync: () => void
  onStartPairing: () => void
  onShowRecoveryCode: () => void
  onShowHelp: () => void
}

const MODE_OPTIONS: Array<{ id: ModeId; label: string; icon: React.ReactNode }> = [
  { id: 'light', label: '浅色', icon: <Sun className="h-4 w-4" /> },
  { id: 'dark', label: '深色', icon: <Moon className="h-4 w-4" /> },
  { id: 'system', label: '跟随系统', icon: <Monitor className="h-4 w-4" /> },
]

function useIsDark(mode: ModeId): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false
    if (mode === 'dark') return true
    if (mode === 'light') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    if (mode === 'dark') {
      setIsDark(true)
      return
    }
    if (mode === 'light') {
      setIsDark(false)
      return
    }
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    setIsDark(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [mode])

  return isDark
}

// Section Header Component
function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}

// Action Item Component
function ActionItem({
  icon: Icon,
  label,
  description,
  onClick,
  disabled,
}: {
  icon: React.ElementType
  label: string
  description?: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-4 p-4 rounded-xl transition-colors text-left',
        'hover:bg-accent/50 active:bg-accent',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      )}
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground truncate">{description}</div>}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
    </button>
  )
}

export function SettingsPanel({
  isOpen,
  onClose,
  brandName,
  onSetBrandName,
  theme,
  onSetTheme,
  mode,
  onSetMode,
  credentialId,
  onSetDeviceName,
  onLock,
  busy,
  pairingBusy,
  masterKey,
  onSync,
  onStartPairing,
  onShowRecoveryCode,
  onShowHelp,
}: SettingsPanelProps) {
  const [mounted, setMounted] = useState(isOpen)
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const themeOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const isDark = useIsDark(mode)
  const [showThemes, setShowThemes] = useState(false)

  useEffect(() => {
    if (isOpen) setMounted(true)
  }, [isOpen])

  const [brandDraft, setBrandDraft] = useState(brandName)
  useEffect(() => setBrandDraft(brandName), [brandName, isOpen])
  const normalizedBrandDraft = brandDraft.trim().slice(0, 32)
  const brandBaseline = brandName.trim().slice(0, 32)
  const brandDirty = normalizedBrandDraft !== brandBaseline

  type DeviceItem = {
    id: string
    deviceName: string | null
    lastUsedAt: number | null
    createdAt: number | null
  }

  const [devices, setDevices] = useState<DeviceItem[] | null>(null)
  const [devicesBusy, setDevicesBusy] = useState(false)
  const [devicesError, setDevicesError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<{ targetId: string; isCurrent: boolean } | null>(null)

  useFocusTrap(panelRef, Boolean(isOpen) && !confirmRevoke)
  useBodyScrollLock(mounted)

  function formatTs(ts: number | null): string {
    if (!ts || !Number.isFinite(ts)) return '—'
    return new Date(ts).toLocaleString()
  }

  function shortId(id: string): string {
    return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`
  }

  async function loadDevices(): Promise<void> {
    setDevicesBusy(true)
    setDevicesError(null)
    try {
      const res = await getJSON<{ credentials: DeviceItem[] }>('/auth/device/list')
      setDevices(res.credentials)
    } catch (err) {
      setDevicesError(formatErrorZh(err))
    } finally {
      setDevicesBusy(false)
    }
  }

  async function saveRename(targetId: string): Promise<void> {
    if (saving) return
    const next = editingName.trim()
    setSaving(true)
    try {
      await postJSON('/auth/device/rename', { credentialId: targetId, deviceName: next })
      setDevices((prev) => (prev ? prev.map((d) => (d.id === targetId ? { ...d, deviceName: next || null } : d)) : prev))
      if (credentialId && targetId === credentialId) onSetDeviceName(next || null)
      setEditingId(null)
      setEditingName('')
    } catch (err) {
      setDevicesError(formatErrorZh(err))
    } finally {
      setSaving(false)
    }
  }

  function cancelRename(): void {
    setEditingId(null)
    setEditingName('')
  }

  useEffect(() => {
    if (!editingId) return
    const raf = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(raf)
  }, [editingId])

  function requestRevokeDevice(targetId: string): void {
    if (deletingId) return
    const isCurrent = Boolean(credentialId && targetId === credentialId)
    setConfirmRevoke({ targetId, isCurrent })
  }

  async function revokeDevice(targetId: string, isCurrent: boolean): Promise<void> {
    if (deletingId) return
    setDeletingId(targetId)
    setDevicesError(null)
    try {
      await deleteJSON(`/auth/device/${encodeURIComponent(targetId)}`)
      setDevices((prev) => (prev ? prev.filter((d) => d.id !== targetId) : prev))
      if (isCurrent) {
        onClose()
        onLock()
      }
    } catch (err) {
      setDevicesError(formatErrorZh(err))
    } finally {
      setDeletingId(null)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (confirmRevoke) return
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmRevoke, isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    setDevices(null)
    void loadDevices()
  }, [isOpen])

  const sortedDevices = useMemo(() => {
    if (!devices) return null
    const next = [...devices]
    next.sort((a, b) => {
      const aCurrent = Boolean(credentialId && a.id === credentialId)
      const bCurrent = Boolean(credentialId && b.id === credentialId)
      if (aCurrent !== bCurrent) return aCurrent ? -1 : 1
      const aLast = a.lastUsedAt ?? 0
      const bLast = b.lastUsedAt ?? 0
      if (aLast !== bLast) return bLast - aLast
      const aCreated = a.createdAt ?? 0
      const bCreated = b.createdAt ?? 0
      if (aCreated !== bCreated) return bCreated - aCreated
      return a.id.localeCompare(b.id)
    })
    return next
  }, [credentialId, devices])

  const currentThemeMeta = THEME_META.find((t) => t.id === theme)

  if (!mounted) return null

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              if (confirmRevoke) return
              onClose()
            }}
            role="presentation"
          />

          {/* Panel */}
          <motion.div
            className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-background shadow-2xl flex flex-col"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            ref={panelRef}
            tabIndex={-1}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-border/50">
              <h2 id={titleId} className="text-xl font-semibold">设置</h2>
              <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 rounded-xl" aria-label="关闭设置">
                <X className="h-5 w-5" />
              </Button>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-6 space-y-8">
                {/* Appearance Section */}
                <section className="space-y-5">
                  <SectionHeader title="外观" description="自定义应用的视觉风格" />

                  {/* Mode Picker */}
                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground">主题模式</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {MODE_OPTIONS.map((option) => (
                        <Button
                          key={option.id}
                          variant={mode === option.id ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => onSetMode(option.id)}
                          className="h-10 gap-2"
                        >
                          {option.icon}
                          <span className="text-xs">{option.label}</span>
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Theme Picker Toggle */}
                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground">配色方案</Label>
                    <button
                      type="button"
                      onClick={() => setShowThemes(!showThemes)}
                      className="w-full flex items-center gap-4 p-4 rounded-xl border border-border/50 hover:bg-accent/30 transition-colors"
                    >
                      <div className="flex-shrink-0 w-10 h-10 rounded-xl overflow-hidden border border-border/50">
                        {currentThemeMeta && (
                          <div
                            className="w-full h-full flex items-center justify-center gap-1"
                            style={{ backgroundColor: (isDark ? currentThemeMeta.swatch.dark : currentThemeMeta.swatch.light).background }}
                          >
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: (isDark ? currentThemeMeta.swatch.dark : currentThemeMeta.swatch.light).primary }} />
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: (isDark ? currentThemeMeta.swatch.dark : currentThemeMeta.swatch.light).foreground }} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-medium">{currentThemeMeta?.label || '默认'}</div>
                        <div className="text-xs text-muted-foreground">{THEME_META.length} 款主题可选</div>
                      </div>
                      <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', showThemes && 'rotate-90')} />
                    </button>

                    {/* Theme Grid */}
                    <AnimatePresence>
                      {showThemes && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="max-h-64 overflow-y-auto pt-2 pr-1">
                          <div
                            className="grid grid-cols-4 gap-2"
                            role="radiogroup"
                            aria-label="主题配色"
                            onKeyDown={(e) => {
                              if (!THEME_META.length) return
                              const currentIndex = THEME_META.findIndex((t) => t.id === theme)
                              if (currentIndex < 0) return
                              const lastIndex = THEME_META.length - 1
                              let nextIndex = currentIndex
                              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1
                              else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1
                              else if (e.key === 'Home') nextIndex = 0
                              else if (e.key === 'End') nextIndex = lastIndex
                              else return
                              e.preventDefault()
                              const nextTheme = THEME_META[nextIndex]
                              onSetTheme(nextTheme.id)
                              window.requestAnimationFrame(() => themeOptionRefs.current[nextIndex]?.focus())
                            }}
                          >
                            {THEME_META.map((themeMeta, idx) => {
                              const isActive = theme === themeMeta.id
                              const swatchColors = isDark ? themeMeta.swatch.dark : themeMeta.swatch.light
                              return (
                                <button
                                  key={themeMeta.id}
                                  className={cn(
                                    'group relative cursor-pointer rounded-xl border transition-all overflow-hidden',
                                    isActive ? 'border-primary ring-2 ring-primary/20' : 'border-border/50 hover:border-border hover:shadow-sm'
                                  )}
                                  type="button"
                                  role="radio"
                                  aria-checked={isActive}
                                  tabIndex={isActive ? 0 : -1}
                                  onClick={() => onSetTheme(themeMeta.id)}
                                  ref={(el) => { themeOptionRefs.current[idx] = el }}
                                >
                                  <div className="h-9 w-full relative" style={{ backgroundColor: swatchColors.background }}>
                                    <div className="flex h-full items-center justify-center gap-1">
                                      <div className="h-4 w-4 rounded" style={{ backgroundColor: swatchColors.primary }} />
                                      <div className="h-4 w-4 rounded" style={{ backgroundColor: swatchColors.foreground }} />
                                    </div>
                                    {isActive && (
                                      <div className="absolute top-1 right-1 rounded-full p-0.5" style={{ backgroundColor: swatchColors.primary }}>
                                        <Check className="h-2 w-2" style={{ color: swatchColors.background }} />
                                      </div>
                                    )}
                                  </div>
                                  <div className="px-1.5 py-1 border-t border-border/30 bg-card">
                                    <div className={cn('text-[10px] font-medium text-center truncate', isActive ? 'text-primary' : 'text-muted-foreground')}>
                                      {themeMeta.label}
                                    </div>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Brand Name */}
                  <div className="space-y-3">
                    <Label htmlFor="brand-name" className="text-xs text-muted-foreground">显示名称</Label>
                    <div className="flex gap-2">
                      <Input
                        id="brand-name"
                        value={brandDraft}
                        onChange={(e) => setBrandDraft(e.target.value)}
                        placeholder="例如：私人笔记库"
                        maxLength={32}
                        className="h-10"
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            setBrandDraft(brandName)
                            window.requestAnimationFrame(() => e.currentTarget.select())
                            return
                          }
                          if (e.key !== 'Enter') return
                          if (!brandDirty) return
                          e.preventDefault()
                          onSetBrandName(normalizedBrandDraft)
                        }}
                      />
                      <Button onClick={() => onSetBrandName(normalizedBrandDraft)} disabled={!brandDirty} size="sm" className="h-10 px-4">
                        保存
                      </Button>
                    </div>
                  </div>
                </section>

                {/* Devices Section */}
                <section className="space-y-5">
                  <div className="flex items-center justify-between">
                    <SectionHeader title="设备管理" description="管理已授权的设备" />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void loadDevices()}
                      disabled={devicesBusy}
                      className="h-8 w-8 rounded-lg"
                      aria-label={devicesBusy ? '正在刷新' : '刷新'}
                    >
                      <RefreshCw className={cn('h-4 w-4', devicesBusy && 'animate-spin')} />
                    </Button>
                  </div>

                  {devicesError && (
                    <Card className="border-destructive/50 bg-destructive/5">
                      <CardContent className="p-3 flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-destructive">加载失败</p>
                          <p className="text-xs text-destructive/80">{devicesError}</p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => setDevicesError(null)} className="h-6 w-6" aria-label="关闭">
                          <X className="h-3 w-3" />
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  <div className="space-y-2">
                    {devicesBusy && !devices && (
                      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        加载中…
                      </div>
                    )}

                    {!devicesBusy && devices && devices.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-8">暂无设备</p>
                    )}

                    {sortedDevices?.map((d) => {
                      const isCurrent = Boolean(credentialId && d.id === credentialId)
                      const isEditing = editingId === d.id
                      const renameDirty = editingName.trim() !== (d.deviceName ?? '')
                      const deviceControlsDisabled = busy || devicesBusy || saving || Boolean(deletingId)

                      return (
                        <Card key={d.id} className={cn('py-0 gap-0 transition-all', isCurrent && 'ring-2 ring-primary/20')}>
                          <CardContent className="px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-sm font-medium">{d.deviceName || '未命名设备'}</span>
                                  {isCurrent && (
                                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">本机</span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  <span title={d.id}>ID: {shortId(d.id)}</span>
                                  <span className="mx-1.5">·</span>
                                  <span>上次: {formatTs(d.lastUsedAt)}</span>
                                </div>

                                {isEditing && (
                                  <div className="mt-3 flex gap-2">
                                    <Input
                                      ref={renameInputRef}
                                      value={editingName}
                                      onChange={(e) => setEditingName(e.target.value)}
                                      placeholder="设备名称"
                                      maxLength={64}
                                      className="h-8 text-sm"
                                      disabled={deviceControlsDisabled}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Escape') { e.preventDefault(); cancelRename(); return }
                                        if (e.key !== 'Enter' || !renameDirty || deviceControlsDisabled) return
                                        e.preventDefault()
                                        void saveRename(d.id)
                                      }}
                                    />
                                    <Button size="sm" onClick={() => void saveRename(d.id)} disabled={!renameDirty || deviceControlsDisabled} className="h-8">
                                      {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}保存
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={cancelRename} disabled={saving} className="h-8">取消</Button>
                                  </div>
                                )}
                              </div>

                              <div className="flex shrink-0 gap-1">
                                <Button
                                  variant={isEditing ? 'secondary' : 'ghost'}
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => { if (isEditing) { cancelRename(); return } setEditingId(d.id); setEditingName(d.deviceName ?? '') }}
                                  disabled={deviceControlsDisabled}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                  onClick={() => requestRevokeDevice(d.id)}
                                  disabled={deviceControlsDisabled}
                                >
                                  {deletingId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </section>

                {/* Quick Actions */}
                <section className="space-y-5">
                  <SectionHeader title="快捷操作" />
                  <div className="rounded-xl border border-border/50 overflow-hidden divide-y divide-border/50">
                    <ActionItem
                      icon={Smartphone}
                      label="添加新设备"
                      description="通过扫码配对新设备"
                      onClick={() => { onStartPairing(); onClose() }}
                      disabled={busy || pairingBusy}
                    />
                    <ActionItem
                      icon={Cloud}
                      label="从云端同步"
                      description="拉取最新数据"
                      onClick={() => { onSync(); onClose() }}
                      disabled={busy}
                    />
                    <ActionItem
                      icon={Key}
                      label="恢复码"
                      description="查看账户恢复码"
                      onClick={() => { onShowRecoveryCode(); onClose() }}
                      disabled={!masterKey}
                    />
                    <ActionItem
                      icon={HelpCircle}
                      label="帮助"
                      description="使用说明和常见问题"
                      onClick={() => { onShowHelp(); onClose() }}
                      disabled={busy}
                    />
                  </div>
                </section>
              </div>
            </ScrollArea>
          </motion.div>

          {/* Confirm Dialog */}
          <AlertDialog open={!!confirmRevoke} onOpenChange={(open) => !open && setConfirmRevoke(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmRevoke?.isCurrent ? '移除当前设备？' : '移除设备？'}</AlertDialogTitle>
                <AlertDialogDescription className="whitespace-pre-line">
                  {confirmRevoke?.isCurrent
                    ? '你将移除本机的 Passkey。\n\n移除后会立即退出；之后需要用其他设备重新加入/解锁。\n\n确定要继续吗？'
                    : '确定要移除该设备的 Passkey 吗？\n\n移除后，该设备将无法再解锁此保险库。'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => { const ctx = confirmRevoke; setConfirmRevoke(null); if (ctx) void revokeDevice(ctx.targetId, ctx.isCurrent) }}
                >
                  移除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </AnimatePresence>
  )
}
