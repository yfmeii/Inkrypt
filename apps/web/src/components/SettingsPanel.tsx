import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { deleteJSON, getJSON, postJSON } from '../lib/api'
import { formatErrorZh } from '../lib/errors'
import { useFocusTrap } from '../lib/focusTrap'
import { useBodyScrollLock } from '../lib/scrollLock'
import type { ThemeId } from '../state/store'
import { ConfirmDialog } from './ConfirmDialog'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  brandName: string
  onSetBrandName: (brandName: string) => void
  theme: ThemeId
  onSetTheme: (theme: ThemeId) => void
  credentialId: string | null
  deviceName: string | null
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

export function SettingsPanel({
  isOpen,
  onClose,
  brandName,
  onSetBrandName,
  theme,
  onSetTheme,
  credentialId,
  deviceName,
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
  const [active, setActive] = useState(false)
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const themeOptionRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (isOpen) {
      setMounted(true)
      const raf = requestAnimationFrame(() => setActive(true))
      return () => cancelAnimationFrame(raf)
    }
    setActive(false)
  }, [isOpen])

  useEffect(() => {
    if (!mounted || isOpen) return
    if (!('matchMedia' in window)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setMounted(false)
    }
  }, [isOpen, mounted])

  useEffect(() => {
    if (!mounted || isOpen) return
    const t = window.setTimeout(() => setMounted(false), 260)
    return () => window.clearTimeout(t)
  }, [isOpen, mounted])

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

  const themeOptions = useMemo(
    () =>
      [
        { id: 'ocean' as const, label: '海洋蓝（默认）' },
        { id: 'violet' as const, label: '柔紫' },
        { id: 'emerald' as const, label: '翡翠绿' },
        { id: 'rose' as const, label: '玫瑰粉' },
        { id: 'amber' as const, label: '琥珀橙' },
      ] satisfies Array<{ id: ThemeId; label: string }>,
    [],
  )

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

  // Close on Escape key
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

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    setDevices(null)
    void loadDevices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (!mounted) return null

  return (
    <div
      className={active ? 'settingsOverlay open' : 'settingsOverlay'}
      onClick={() => {
        if (confirmRevoke) return
        onClose()
      }}
      role="presentation"
    >
      <div
        className="settingsPanel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
        onTransitionEnd={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.propertyName !== 'transform') return
          if (!isOpen) setMounted(false)
        }}
      >
        <div className="settingsHeader">
          <strong id={titleId}>设置</strong>
          <button className="iconBtn" onClick={onClose} type="button" title="关闭" aria-label="关闭设置">
            <svg viewBox="0 0 24 24">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="settingsItems">
          <div className="settingsSection">
            <div className="settingsSectionTitle">外观</div>

            <label className="field settingsField">
              <span>左上角显示名称</span>
              <div className="settingsInlineRow">
                <input
                  value={brandDraft}
                  onChange={(e) => setBrandDraft(e.target.value)}
                  placeholder="例如：私人笔记库"
                  maxLength={32}
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
                 <button
                   className="btn primary"
                   type="button"
                   onClick={() => onSetBrandName(normalizedBrandDraft)}
                   disabled={!brandDirty}
                   title="保存"
                 >
                   保存
                 </button>
              </div>
              {brandDirty ? <div className="muted small">已修改，点击“保存”后生效。</div> : null}
            </label>

            <label className="field settingsField">
              <span>主题配色</span>
              <div
                className="themePicker"
                role="radiogroup"
                aria-label="主题配色"
                aria-orientation="vertical"
                onKeyDown={(e) => {
                  if (!themeOptions.length) return
                  const currentIndex = themeOptions.findIndex((t) => t.id === theme)
                  if (currentIndex < 0) return

                  const lastIndex = themeOptions.length - 1
                  let nextIndex = currentIndex

                  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1
                  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1
                  else if (e.key === 'Home') nextIndex = 0
                  else if (e.key === 'End') nextIndex = lastIndex
                  else return

                  e.preventDefault()
                  const nextTheme = themeOptions[nextIndex]
                  onSetTheme(nextTheme.id)
                  window.requestAnimationFrame(() => themeOptionRefs.current[nextIndex]?.focus())
                }}
              >
                {themeOptions.map((t, idx) => (
                  <button
                    key={t.id}
                    className={theme === t.id ? 'themeOption active' : 'themeOption'}
                    type="button"
                    role="radio"
                    aria-checked={theme === t.id}
                    tabIndex={theme === t.id ? 0 : -1}
                    onClick={() => onSetTheme(t.id)}
                    ref={(el) => {
                      themeOptionRefs.current[idx] = el
                    }}
                  >
                    <span className="themeSwatch" aria-hidden="true" style={{ background: `var(--inkrypt-swatch-${t.id})` }} />
                    <span className="themeLabel">{t.label}</span>
                    <span className="themeCheck" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                      </svg>
                    </span>
                  </button>
                ))}
              </div>
            </label>
          </div>

          <div className="settingsDivider" />

          <div className="settingsSection">
            <div className="settingsSectionHeader">
              <div className="settingsSectionTitle">设备</div>
              <button
                className="iconBtn"
                onClick={() => void loadDevices()}
                type="button"
                title={devicesBusy ? '正在刷新…' : '刷新'}
                aria-label={devicesBusy ? '正在刷新设备列表' : '刷新设备列表'}
                aria-busy={devicesBusy ? true : undefined}
                disabled={devicesBusy}
              >
                {devicesBusy ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
                  </svg>
                )}
              </button>
            </div>

            {devicesError ? (
              <div className="settingsError errorBox" role="alert">
                <div className="settingsErrorHeader">
                  <strong>加载失败</strong>
                  <button className="iconBtn" type="button" onClick={() => setDevicesError(null)} aria-label="关闭错误提示" title="关闭">
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </div>
                <div className="settingsErrorText small">{devicesError}</div>
              </div>
            ) : null}

            <div className="settingsDeviceList">
              {devicesBusy ? (
                <div className="muted small" role="status" aria-live="polite">
                  加载中…
                </div>
              ) : null}

              {!devicesBusy && devices && devices.length === 0 ? (
                <div className="muted small">暂无设备</div>
              ) : null}

              {sortedDevices?.map((d) => {
                const isCurrent = Boolean(credentialId && d.id === credentialId)
                const isEditing = editingId === d.id
                const renameDirty = editingName.trim() !== (d.deviceName ?? '')
                const deviceControlsDisabled = busy || devicesBusy || saving || Boolean(deletingId)
                return (
                  <div key={d.id} className="settingsDeviceRow">
                    <div className="settingsDeviceMain">
                      <div className="settingsDeviceNameRow">
                        <div className="settingsDeviceName">{d.deviceName || '未命名设备'}</div>
                        {isCurrent ? <span className="settingsPill">本机</span> : null}
                      </div>
                      <div className="settingsDeviceInfo muted small">
                        <div className="settingsDeviceId" title={d.id}>
                          设备 ID：{shortId(d.id)}
                        </div>
                        <div>
                          <span>上次使用：{formatTs(d.lastUsedAt)}</span>
                          {d.createdAt ? (
                            <>
                              <span className="settingsDot">·</span>
                              <span>创建：{formatTs(d.createdAt)}</span>
                            </>
                          ) : null}
                        </div>
                      </div>

                      {editingId === d.id ? (
                        <div className="settingsInlineRow settingsInlineRowTight">
                          <input
                            ref={renameInputRef}
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            placeholder="设备名称（可留空）"
                            maxLength={64}
                            aria-label="设备名称"
                            disabled={deviceControlsDisabled}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                cancelRename()
                                return
                              }
                              if (e.key !== 'Enter') return
                              if (!renameDirty) return
                              if (deviceControlsDisabled) return
                              e.preventDefault()
                              void saveRename(d.id)
                            }}
                          />
                          <button
                            className="btn primary"
                            type="button"
                            onClick={() => void saveRename(d.id)}
                            disabled={!renameDirty || deviceControlsDisabled}
                            aria-busy={saving ? true : undefined}
                          >
                            {saving ? <span className="spinner" aria-hidden="true" /> : null}
                            保存
                          </button>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => {
                              cancelRename()
                            }}
                            disabled={saving}
                          >
                            取消
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="settingsDeviceActions">
                      <button
                        className={isEditing ? 'iconBtn active' : 'iconBtn'}
                        type="button"
                        title={isEditing ? '取消重命名' : '重命名'}
                        aria-label={isEditing ? '取消重命名' : '重命名'}
                        aria-pressed={isEditing}
                        onClick={() => {
                          if (isEditing) {
                            cancelRename()
                            return
                          }
                          setEditingId(d.id)
                          setEditingName(d.deviceName ?? '')
                        }}
                        disabled={deviceControlsDisabled}
                      >
                        <svg viewBox="0 0 24 24">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z" />
                        </svg>
                      </button>
                      <button
                        className="iconBtn danger"
                        type="button"
                        title="移除"
                        aria-label="移除"
                        onClick={() => requestRevokeDevice(d.id)}
                        disabled={deviceControlsDisabled}
                        aria-busy={deletingId === d.id ? true : undefined}
                      >
                        {deletingId === d.id ? (
                          <span className="spinner" aria-hidden="true" />
                        ) : (
                          <svg viewBox="0 0 24 24">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {deviceName ? (
              <div className="settingsHint muted small">当前设备名称：{deviceName}</div>
            ) : (
              <div className="settingsHint muted small">本机名称未设置（可在上方重命名）。</div>
            )}
          </div>

          <button
            className="settingsItem"
            onClick={() => {
              onStartPairing()
              onClose()
            }}
            disabled={busy || pairingBusy}
            type="button"
          >
            <svg viewBox="0 0 24 24">
              <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14zm-4.2-5.78v1.75l3.2-2.99L12.8 9v1.7c-3.11.43-4.35 2.56-4.8 4.7 1.11-1.5 2.58-2.18 4.8-2.18z" />
            </svg>
            <span>添加新设备</span>
          </button>

          <button
            className="settingsItem"
            onClick={() => {
              onSync()
              onClose()
            }}
            disabled={busy}
            type="button"
          >
            <svg viewBox="0 0 24 24">
              <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
            </svg>
            <span>从云端同步</span>
          </button>

          <button
            className="settingsItem"
            onClick={() => {
              onShowRecoveryCode()
              onClose()
            }}
            disabled={!masterKey}
            type="button"
          >
            <svg viewBox="0 0 24 24">
              <path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
            </svg>
            <span>恢复码</span>
          </button>

          <button
            className="settingsItem"
            onClick={() => {
              onShowHelp()
              onClose()
            }}
            disabled={busy}
            type="button"
          >
            <svg viewBox="0 0 24 24">
              <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z" />
            </svg>
            <span>帮助</span>
          </button>
        </div>
      </div>

      {confirmRevoke ? (
        <ConfirmDialog
          title={confirmRevoke.isCurrent ? '移除当前设备？' : '移除设备？'}
          message={
            confirmRevoke.isCurrent
              ? '你将移除本机的 Passkey。\n\n移除后会立即退出；之后需要用其他设备重新加入/解锁。\n\n确定要继续吗？'
              : '确定要移除该设备的 Passkey 吗？\n\n移除后，该设备将无法再解锁此保险库。'
          }
          confirmText="移除"
          confirmVariant="danger"
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={() => {
            const ctx = confirmRevoke
            setConfirmRevoke(null)
            void revokeDevice(ctx.targetId, ctx.isCurrent)
          }}
        />
      ) : null}
    </div>
  )
}
