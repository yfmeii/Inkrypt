import { Loader2, Pencil, RefreshCw, Trash2, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Input } from '../ui/input'
import { SectionHeader } from './shared'
import { formatDeviceTimestamp, shortDeviceId, type DeviceManagementController } from './useDeviceManagement'

type DeviceManagementSectionProps = Pick<
  DeviceManagementController,
  | 'devices'
  | 'devicesBusy'
  | 'devicesError'
  | 'editingId'
  | 'editingName'
  | 'saving'
  | 'deletingId'
  | 'sortedDevices'
  | 'renameInputRef'
  | 'setDevicesError'
  | 'setEditingName'
  | 'loadDevices'
  | 'saveRename'
  | 'cancelRename'
  | 'startRename'
  | 'requestRevokeDevice'
> & {
  credentialId: string | null
  busy: boolean
}

export function DeviceManagementSection({
  credentialId,
  busy,
  devices,
  devicesBusy,
  devicesError,
  editingId,
  editingName,
  saving,
  deletingId,
  sortedDevices,
  renameInputRef,
  setDevicesError,
  setEditingName,
  loadDevices,
  saveRename,
  cancelRename,
  startRename,
  requestRevokeDevice,
}: DeviceManagementSectionProps) {
  return (
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

        {sortedDevices?.map((device) => {
          const isCurrent = Boolean(credentialId && device.id === credentialId)
          const isEditing = editingId === device.id
          const renameDirty = editingName.trim() !== (device.deviceName ?? '')
          const deviceControlsDisabled = busy || devicesBusy || saving || Boolean(deletingId)

          return (
            <Card key={device.id} className={cn('py-0 gap-0 transition-all', isCurrent && 'ring-2 ring-primary/20')}>
              <CardContent className="px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{device.deviceName || '未命名设备'}</span>
                      {isCurrent && (
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">本机</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span title={device.id}>ID: {shortDeviceId(device.id)}</span>
                      <span className="mx-1.5">·</span>
                      <span>上次: {formatDeviceTimestamp(device.lastUsedAt)}</span>
                    </div>

                    {isEditing && (
                      <div className="mt-3 flex gap-2">
                        <Input
                          ref={renameInputRef}
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          placeholder="设备名称"
                          maxLength={64}
                          className="h-8 text-sm"
                          disabled={deviceControlsDisabled}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelRename()
                              return
                            }
                            if (event.key !== 'Enter' || !renameDirty || deviceControlsDisabled) return
                            event.preventDefault()
                            void saveRename(device.id)
                          }}
                        />
                        <Button size="sm" onClick={() => void saveRename(device.id)} disabled={!renameDirty || deviceControlsDisabled} className="h-8">
                          {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          保存
                        </Button>
                        <Button variant="outline" size="sm" onClick={cancelRename} disabled={saving} className="h-8">
                          取消
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant={isEditing ? 'secondary' : 'ghost'}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        if (isEditing) {
                          cancelRename()
                          return
                        }
                        startRename(device.id, device.deviceName)
                      }}
                      disabled={deviceControlsDisabled}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                      onClick={() => requestRevokeDevice(device.id)}
                      disabled={deviceControlsDisabled}
                    >
                      {deletingId === device.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
