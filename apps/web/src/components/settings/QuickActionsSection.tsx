import { Cloud, HelpCircle, Key, Smartphone } from 'lucide-react'
import { ActionItem, SectionHeader } from './shared'

export type QuickActionsController = {
  busy: boolean
  pairingBusy: boolean
  masterKey: Uint8Array | null
  onClose: () => void
  onSync: () => void
  onStartPairing: () => void
  onShowRecoveryCode: () => void
  onShowHelp: () => void
}

type QuickActionsSectionProps = QuickActionsController

export function QuickActionsSection({
  busy,
  pairingBusy,
  masterKey,
  onClose,
  onSync,
  onStartPairing,
  onShowRecoveryCode,
  onShowHelp,
}: QuickActionsSectionProps) {
  return (
    <section className="space-y-5">
      <SectionHeader title="快捷操作" />
      <div className="rounded-xl border border-border/50 overflow-hidden divide-y divide-border/50">
        <ActionItem
          icon={Smartphone}
          label="添加新设备"
          description="通过扫码配对新设备"
          onClick={() => {
            onStartPairing()
            onClose()
          }}
          disabled={busy || pairingBusy}
        />
        <ActionItem
          icon={Cloud}
          label="从云端同步"
          description="拉取最新数据"
          onClick={() => {
            onSync()
            onClose()
          }}
          disabled={busy}
        />
        <ActionItem
          icon={Key}
          label="恢复码"
          description="查看账户恢复码"
          onClick={() => {
            onShowRecoveryCode()
            onClose()
          }}
          disabled={!masterKey}
        />
        <ActionItem
          icon={HelpCircle}
          label="帮助"
          description="使用说明和常见问题"
          onClick={() => {
            onShowHelp()
            onClose()
          }}
          disabled={busy}
        />
      </div>
    </section>
  )
}
