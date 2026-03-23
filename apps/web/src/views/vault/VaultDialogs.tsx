import type { Dispatch, RefObject, SetStateAction } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { QrCode } from '../../components/QrCode'
import { buildPairingDeepLink, formatPairingSecretForDisplay } from '../../lib/pairingSecret'
import type { PairingState } from './pairing'

type AttachmentRemovalState = { name: string; refs: number } | null

export type PairingDialogController = {
  pairing: PairingState | null
  pairingBusy: boolean
  setPairing: Dispatch<SetStateAction<PairingState | null>>
  cancelPairing: () => Promise<void>
  confirmPairing: () => Promise<void>
}

export type AttachmentDialogsController = {
  confirmRemoveAttachment: AttachmentRemovalState
  setConfirmRemoveAttachment: Dispatch<SetStateAction<AttachmentRemovalState>>
  actuallyRemoveAttachment: (name: string) => void
  confirmCleanupUnusedAttachments: string[] | null
  setConfirmCleanupUnusedAttachments: Dispatch<SetStateAction<string[] | null>>
  setDraftAttachments: Dispatch<SetStateAction<Record<string, string>>>
}

export type NoteActionDialogsController = {
  confirmDeleteNote: boolean
  selectedTitle: string | null
  onCancelDeleteNote: () => void
  onConfirmDeleteNote: () => void
  confirmLock: boolean
  onCancelLock: () => void
  onConfirmLock: () => void
  confirmShowRecoveryCode: boolean
  onCancelShowRecoveryCode: () => void
  onConfirmShowRecoveryCode: () => void
}

export type RecoveryDialogController = {
  showRecoveryCode: boolean
  onCloseRecoveryCode: () => void
  recoveryCodeBase64: string
  recoveryCodeHex: string
  recoveryCodeModalRef: RefObject<HTMLDivElement | null>
}

export type HelpDialogController = {
  showHelp: boolean
  onCloseHelp: () => void
  helpModalRef: RefObject<HTMLDivElement | null>
}

export type VaultDialogsControllers = {
  pairing: PairingDialogController
  attachments: AttachmentDialogsController
  noteActions: NoteActionDialogsController
  recovery: RecoveryDialogController
  help: HelpDialogController
}

type VaultDialogsProps = VaultDialogsControllers

export function VaultDialogs({ pairing, attachments, noteActions, recovery, help }: VaultDialogsProps) {
  return (
    <>
      <PairingDialog controller={pairing} />
      <AttachmentDialogs controller={attachments} />
      <NoteActionDialogs controller={noteActions} />
      <RecoveryCodeDialog controller={recovery} />
      <HelpDialog controller={help} />
    </>
  )
}

type PairingDialogProps = { controller: PairingDialogController }

function PairingDialog({ controller }: PairingDialogProps) {
  const { pairing, pairingBusy, setPairing, cancelPairing, confirmPairing } = controller

  return (
    <AnimatePresence>
      {pairing ? (
        <motion.div
          className="modalOverlay"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pairingTitle"
            style={{ position: 'relative' }}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          >
            <button
              type="button"
              onClick={() => {
                if (pairing.stage === 'sent') setPairing(null)
                else void cancelPairing()
              }}
              style={closeButtonStyle}
              aria-label="关闭"
            >
              <X className="h-5 w-5 text-muted-foreground hover:text-foreground" />
            </button>
            <div className="row">
              <strong id="pairingTitle">添加新设备</strong>
            </div>
            <p className="muted small">
              配对口令已复制到剪贴板（有效期至 {new Date(pairing.expiresAt).toLocaleTimeString()}）。请在新设备输入/粘贴该口令，或在移动端扫码。
            </p>
            <div className="pairTicket">
              <QrCode
                text={
                  typeof window === 'undefined'
                    ? pairing.sessionSecret
                    : buildPairingDeepLink(pairing.sessionSecret, window.location.href)
                }
                size={220}
                className="pairingQr"
                alt="配对口令二维码"
              />
              <div className="pairPhraseBox" aria-label="配对口令">
                <pre className="pairPhraseText">{formatPairingSecretForDisplay(pairing.sessionSecret)}</pre>
              </div>
            </div>
            <div className="row">
              <button
                className="btn"
                type="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(buildPairingDeepLink(pairing.sessionSecret, window.location.href))
                    .catch(() => null)
                }
              >
                复制配对链接
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => void navigator.clipboard.writeText(pairing.sessionSecret).catch(() => null)}
              >
                复制配对口令
              </button>
              {pairing.stage !== 'sent' ? (
                <button className="btn danger" type="button" onClick={() => void cancelPairing()} disabled={pairingBusy}>
                  取消
                </button>
              ) : null}
            </div>
            {pairing.sas ? (
              <div className="infoBox" style={{ marginTop: 10 }}>
                <strong>Emoji 指纹：</strong>
                <span className="sasEmoji">{pairing.sas}</span>
                <div className="muted small">请和新设备上的 Emoji 指纹核对一致。</div>
              </div>
            ) : (
              <p className="muted small">等待新设备加入…</p>
            )}
            {pairing.stage === 'sas' ? (
              <div className="row" style={{ marginTop: 10 }}>
                <label className="rememberRow" style={{ flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={pairing.sasConfirmed}
                    onChange={(event) => setPairing((state) => (state ? { ...state, sasConfirmed: event.target.checked } : state))}
                    disabled={pairingBusy}
                  />
                  <span>我已核对 Emoji 指纹</span>
                </label>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void confirmPairing()}
                  disabled={pairingBusy || !pairing.sasConfirmed}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  确认一致并发送密钥
                </button>
                <span className="muted small">确认后会加密发送主密钥给新设备</span>
              </div>
            ) : null}
            {pairing.stage === 'sent' ? <p className="muted small">已发送密钥，请在新设备完成 Passkey 创建。</p> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

type AttachmentDialogsProps = { controller: AttachmentDialogsController }

function AttachmentDialogs({ controller }: AttachmentDialogsProps) {
  const {
    confirmRemoveAttachment,
    setConfirmRemoveAttachment,
    actuallyRemoveAttachment,
    confirmCleanupUnusedAttachments,
    setConfirmCleanupUnusedAttachments,
    setDraftAttachments,
  } = controller

  return (
    <>
      {confirmRemoveAttachment ? (
        <ConfirmDialog
          title="删除附件？"
          message={`正文仍引用该附件 ${confirmRemoveAttachment.refs} 处。删除后，这些位置会显示为缺失图片或坏链接。\n\n仍要删除「${confirmRemoveAttachment.name}」吗？`}
          confirmText="继续删除"
          confirmVariant="danger"
          onCancel={() => setConfirmRemoveAttachment(null)}
          onConfirm={() => {
            const ctx = confirmRemoveAttachment
            setConfirmRemoveAttachment(null)
            actuallyRemoveAttachment(ctx.name)
          }}
        />
      ) : null}
      {confirmCleanupUnusedAttachments ? (
        <ConfirmDialog
          title="清理未引用附件？"
          message={buildCleanupUnusedAttachmentsMessage(confirmCleanupUnusedAttachments)}
          confirmText="清理"
          confirmVariant="danger"
          onCancel={() => setConfirmCleanupUnusedAttachments(null)}
          onConfirm={() => {
            const names = confirmCleanupUnusedAttachments
            setConfirmCleanupUnusedAttachments(null)
            setDraftAttachments((prev) => {
              const next = { ...prev }
              for (const name of names) delete next[name]
              return next
            })
          }}
        />
      ) : null}
    </>
  )
}

type NoteActionDialogsProps = { controller: NoteActionDialogsController }

function NoteActionDialogs({ controller }: NoteActionDialogsProps) {
  const {
    confirmDeleteNote,
    selectedTitle,
    onCancelDeleteNote,
    onConfirmDeleteNote,
    confirmLock,
    onCancelLock,
    onConfirmLock,
    confirmShowRecoveryCode,
    onCancelShowRecoveryCode,
    onConfirmShowRecoveryCode,
  } = controller

  return (
    <>
      {confirmDeleteNote && selectedTitle ? (
        <ConfirmDialog
          title="删除这条笔记？"
          message={`确定要删除「${selectedTitle || '未命名'}」吗？\n\n删除会同步到云端并影响所有设备，无法恢复。`}
          confirmText="删除"
          confirmVariant="danger"
          onCancel={onCancelDeleteNote}
          onConfirm={onConfirmDeleteNote}
        />
      ) : null}
      {confirmLock ? (
        <ConfirmDialog
          title="锁定并退出？"
          message={'这会清空本机解密密钥并退出。\n\n下次需要再次进行 Passkey 验证才能解锁。\n\n确定要继续吗？'}
          confirmText="锁定并退出"
          confirmVariant="danger"
          onCancel={onCancelLock}
          onConfirm={onConfirmLock}
        />
      ) : null}
      {confirmShowRecoveryCode ? (
        <ConfirmDialog
          title="显示恢复码？"
          message={'恢复码等同于主密钥。任何人获取恢复码都能解密你的所有笔记。\n\n确定要显示并复制恢复码吗？'}
          confirmText="显示并复制"
          confirmVariant="danger"
          onCancel={onCancelShowRecoveryCode}
          onConfirm={onConfirmShowRecoveryCode}
        />
      ) : null}
    </>
  )
}

type RecoveryCodeDialogProps = { controller: RecoveryDialogController }

function RecoveryCodeDialog({ controller }: RecoveryCodeDialogProps) {
  const { showRecoveryCode, onCloseRecoveryCode, recoveryCodeBase64, recoveryCodeHex, recoveryCodeModalRef } = controller

  return (
    <AnimatePresence>
      {showRecoveryCode ? (
        <motion.div
          className="modalOverlay"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recoveryCodeTitle"
            ref={recoveryCodeModalRef}
            tabIndex={-1}
            style={{ position: 'relative' }}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          >
            <button type="button" onClick={onCloseRecoveryCode} style={closeButtonStyle} aria-label="关闭">
              <X className="h-5 w-5 text-muted-foreground hover:text-foreground" />
            </button>
            <div className="row">
              <strong id="recoveryCodeTitle">恢复码（主密钥）</strong>
            </div>
            <p className="muted small">Base64 已复制到剪贴板。请离线保存，勿在公共场合展示。</p>
            <label className="field">
              <span>Base64</span>
              <textarea readOnly value={recoveryCodeBase64} rows={3} />
            </label>
            <label className="field">
              <span>Hex</span>
              <textarea readOnly value={recoveryCodeHex} rows={3} />
            </label>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

type HelpDialogProps = { controller: HelpDialogController }

function HelpDialog({ controller }: HelpDialogProps) {
  const { showHelp, onCloseHelp, helpModalRef } = controller

  return (
    <AnimatePresence>
      {showHelp ? (
        <motion.div
          className="modalOverlay"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="helpTitle"
            ref={helpModalRef}
            tabIndex={-1}
            style={{ position: 'relative' }}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          >
            <button type="button" onClick={onCloseHelp} style={closeButtonStyle} aria-label="关闭">
              <X className="h-5 w-5 text-muted-foreground hover:text-foreground" />
            </button>
            <div className="row">
              <strong id="helpTitle">使用帮助</strong>
            </div>
            <div className="helpBody">
              <h3 className="helpTitle">快速入口</h3>
              <ul className="helpList">
                <li>设置（右上角齿轮）：管理设备、同步、恢复码和帮助。</li>
                <li>锁定（右上角红色按钮）：清空本机解密密钥并退出当前会话。</li>
                <li>新建：桌面端在左侧「+ 新建」；移动端在列表页右下角「+」悬浮按钮。</li>
                <li>移动端导航：点列表中的笔记进入编辑；点左上角返回箭头回到列表。</li>
              </ul>
              <h3 className="helpTitle">编辑与同步</h3>
              <ul className="helpList">
                <li>编辑会自动加密保存在本地（无需手动保存）。</li>
                <li>右下角显示“未上传”时，点击“上传”把修改同步到云端（Ctrl/Cmd+S）。</li>
                <li>想获取云端最新内容，点击右上角「从云端同步」（不会上传本地修改）。</li>
                <li>标签用逗号分隔（例如：工作, 日记）；搜索会同时匹配标题/内容/标签。</li>
              </ul>
              <h3 className="helpTitle">附件</h3>
              <ul className="helpList">
                <li>点击回形针打开附件面板；支持拖拽文件添加。</li>
                <li>图片也可以直接拖到正文编辑区，自动插入引用。</li>
                <li>附件会随笔记一起加密并同步（建议单个文件 &lt; 1MB）。</li>
                <li>移除附件后，记得点击“上传”同步到云端。</li>
              </ul>
              <p className="muted small">
                安全提示：恢复码等同于主密钥，务必离线保存；任何人获取恢复码都能解密你的所有笔记。
              </p>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

const closeButtonStyle = {
  position: 'absolute',
  top: '0.75rem',
  right: '0.75rem',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: '0.25rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const

function buildCleanupUnusedAttachmentsMessage(names: string[]) {
  return `将删除 ${names.length} 个未被正文引用的附件。\n\n这不会修改正文内容。\n\n清理后请点击“上传”同步到云端。\n\n${names
    .slice(0, 8)
    .map((name) => `- ${name}`)
    .join('\n')}${names.length > 8 ? `\n…以及另外 ${names.length - 8} 个附件` : ''}`
}
