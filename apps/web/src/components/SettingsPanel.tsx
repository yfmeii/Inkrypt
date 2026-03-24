import { useEffect, useId, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useOverlayPanel } from '../lib/useOverlayPanel'
import { usePresenceMount } from '../lib/usePresenceMount'
import type { ModeId, ThemeId } from '../state/store'
import { Button } from './ui/button'
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
import { X } from 'lucide-react'
import { AppearanceSettingsSection } from './settings/AppearanceSettingsSection'
import { DeviceManagementSection } from './settings/DeviceManagementSection'
import { QuickActionsSection, type QuickActionsController } from './settings/QuickActionsSection'
import { useDeviceManagement, type DeviceManagementControllerArgs } from './settings/useDeviceManagement'
import { useIsDark } from './settings/useIsDark'

type SettingsPanelProps = DeviceManagementControllerArgs & QuickActionsController & {
  isOpen: boolean
  brandName: string
  onSetBrandName: (brandName: string) => void
  theme: ThemeId
  onSetTheme: (theme: ThemeId) => void
  mode: ModeId
  onSetMode: (mode: ModeId) => void
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
  const mounted = usePresenceMount(isOpen)
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const themeOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const isDark = useIsDark(mode)
  const [showThemes, setShowThemes] = useState(false)

  const [brandDraft, setBrandDraft] = useState(brandName)
  useEffect(() => setBrandDraft(brandName), [brandName, isOpen])
  const normalizedBrandDraft = brandDraft.trim().slice(0, 32)
  const brandBaseline = brandName.trim().slice(0, 32)
  const brandDirty = normalizedBrandDraft !== brandBaseline

  const {
    renameInputRef,
    devices,
    devicesBusy,
    devicesError,
    setDevicesError,
    editingId,
    editingName,
    setEditingName,
    saving,
    deletingId,
    confirmRevoke,
    setConfirmRevoke,
    sortedDevices,
    loadDevices,
    saveRename,
    cancelRename,
    startRename,
    requestRevokeDevice,
    revokeDevice,
  } = useDeviceManagement({
    isOpen,
    credentialId,
    busy,
    onSetDeviceName,
    onClose,
    onLock,
  })

  useOverlayPanel(panelRef, {
    focusActive: Boolean(isOpen) && !confirmRevoke,
    lockScroll: mounted,
    onEscape: isOpen && !confirmRevoke ? onClose : null,
  })

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
                <AppearanceSettingsSection
                  brandName={brandName}
                  brandDraft={brandDraft}
                  normalizedBrandDraft={normalizedBrandDraft}
                  brandDirty={brandDirty}
                  setBrandDraft={setBrandDraft}
                  onSetBrandName={onSetBrandName}
                  theme={theme}
                  onSetTheme={onSetTheme}
                  mode={mode}
                  onSetMode={onSetMode}
                  isDark={isDark}
                  showThemes={showThemes}
                  setShowThemes={setShowThemes}
                  themeOptionRefs={themeOptionRefs}
                />

                <DeviceManagementSection
                  credentialId={credentialId}
                  busy={busy}
                  devices={devices}
                  devicesBusy={devicesBusy}
                  devicesError={devicesError}
                  editingId={editingId}
                  editingName={editingName}
                  saving={saving}
                  deletingId={deletingId}
                  sortedDevices={sortedDevices}
                  renameInputRef={renameInputRef}
                  setDevicesError={setDevicesError}
                  setEditingName={setEditingName}
                  loadDevices={loadDevices}
                  saveRename={saveRename}
                  cancelRename={cancelRename}
                  startRename={startRename}
                  requestRevokeDevice={requestRevokeDevice}
                />

                <QuickActionsSection
                  busy={busy}
                  pairingBusy={pairingBusy}
                  masterKey={masterKey}
                  onClose={onClose}
                  onSync={onSync}
                  onStartPairing={onStartPairing}
                  onShowRecoveryCode={onShowRecoveryCode}
                  onShowHelp={onShowHelp}
                />
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
