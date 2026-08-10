import { authSessionResponseSchema } from '@inkrypt/contracts/auth'
import type { StateCreator } from 'zustand'
import { ApiError, getJSON } from '../lib/api'
import type { ApiSessionSlice, InkryptState } from './types'

function isDeviceRevokedError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) return false
  const payload = error.payload as { error?: unknown } | null
  return payload?.error === 'DEVICE_REVOKED'
}

export const createApiSessionSlice: StateCreator<
  InkryptState,
  [],
  [],
  ApiSessionSlice
> = (set, get) => ({
  credentialId: null,
  deviceName: null,
  apiSessionStatus: 'checking',
  apiSessionExpiresAt: null,

  setDeviceName: (deviceName) => set({ deviceName }),

  refreshApiSession: async () => {
    set({ apiSessionStatus: 'checking' })

    try {
      const session = await getJSON('/auth/session', authSessionResponseSchema)
      if (!session.authenticated) {
        get().markApiSessionAnonymous()
        return
      }

      set({
        apiSessionStatus: 'authenticated',
        apiSessionExpiresAt: session.expiresAt,
        credentialId: session.credentialId,
        deviceName: session.deviceName,
      })
    } catch (error) {
      if (isDeviceRevokedError(error)) {
        get().revokeSession()
        return
      }
      get().markApiSessionAnonymous()
    }
  },

  markApiSessionAnonymous: () => set({
    apiSessionStatus: 'anonymous',
    apiSessionExpiresAt: null,
    credentialId: null,
    deviceName: null,
  }),
})
