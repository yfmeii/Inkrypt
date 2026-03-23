import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { deleteJSON, getJSON, postJSON } from '../../lib/api'
import { formatErrorZh } from '../../lib/errors'
import type { DeviceItem } from './types'

export type DeviceManagementControllerArgs = {
  isOpen: boolean
  credentialId: string | null
  busy: boolean
  onSetDeviceName: (deviceName: string | null) => void
  onClose: () => void
  onLock: () => void
}

export type RevokeDeviceConfirmation = { targetId: string; isCurrent: boolean }

export type DeviceManagementController = {
  renameInputRef: RefObject<HTMLInputElement | null>
  devices: DeviceItem[] | null
  devicesBusy: boolean
  devicesError: string | null
  setDevicesError: Dispatch<SetStateAction<string | null>>
  editingId: string | null
  editingName: string
  setEditingName: Dispatch<SetStateAction<string>>
  saving: boolean
  deletingId: string | null
  confirmRevoke: RevokeDeviceConfirmation | null
  setConfirmRevoke: Dispatch<SetStateAction<RevokeDeviceConfirmation | null>>
  sortedDevices: DeviceItem[] | null
  loadDevices: () => Promise<void>
  saveRename: (targetId: string) => Promise<void>
  cancelRename: () => void
  startRename: (deviceId: string, deviceName: string | null) => void
  requestRevokeDevice: (targetId: string) => void
  revokeDevice: (targetId: string, isCurrent: boolean) => Promise<void>
  deviceControlsDisabled: boolean
}

function sortDevices(devices: DeviceItem[], credentialId: string | null): DeviceItem[] {
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
}

export function formatDeviceTimestamp(ts: number | null): string {
  if (!ts || !Number.isFinite(ts)) return '—'
  return new Date(ts).toLocaleString()
}

export function shortDeviceId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`
}

export function useDeviceManagement({
  isOpen,
  credentialId,
  busy,
  onSetDeviceName,
  onClose,
  onLock,
}: DeviceManagementControllerArgs): DeviceManagementController {
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const [devices, setDevices] = useState<DeviceItem[] | null>(null)
  const [devicesBusy, setDevicesBusy] = useState(false)
  const [devicesError, setDevicesError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<RevokeDeviceConfirmation | null>(null)

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
      setDevices((prev) =>
        prev ? prev.map((device) => (device.id === targetId ? { ...device, deviceName: next || null } : device)) : prev,
      )
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

  function startRename(deviceId: string, deviceName: string | null): void {
    setEditingId(deviceId)
    setEditingName(deviceName ?? '')
  }

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
      setDevices((prev) => (prev ? prev.filter((device) => device.id !== targetId) : prev))
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
    if (!editingId) return
    const raf = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(raf)
  }, [editingId])

  useEffect(() => {
    if (!isOpen) return
    setDevices(null)
    void loadDevices()
  }, [isOpen])

  const sortedDevices = useMemo(
    () => (devices ? sortDevices(devices, credentialId) : null),
    [credentialId, devices],
  )

  return {
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
    deviceControlsDisabled: busy || devicesBusy || saving || Boolean(deletingId),
  }
}
