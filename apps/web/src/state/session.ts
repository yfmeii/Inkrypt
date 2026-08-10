import type { StateCreator } from 'zustand'
import {
  clearRememberedUnlockedSession,
  rememberUnlockedSession,
} from '../lib/remember'
import type { InkryptState, SessionCommandsSlice } from './types'

export const createSessionCommandsSlice: StateCreator<
  InkryptState,
  [],
  [],
  SessionCommandsSlice
> = (set) => ({
  setSession: ({ masterKey, credentialId, deviceName, remember }) => {
    set({
      masterKey,
      credentialId: credentialId ?? null,
      deviceName: deviceName ?? null,
      apiSessionStatus: 'authenticated',
    })

    if (remember) {
      void rememberUnlockedSession({
        masterKey,
        credentialId: credentialId ?? null,
        deviceName: deviceName ?? null,
      }).catch(() => null)
    } else {
      void clearRememberedUnlockedSession().catch(() => null)
    }
  },

  revokeSession: () => {
    void clearRememberedUnlockedSession().catch(() => null)
    set({
      masterKey: null,
      credentialId: null,
      deviceName: null,
      apiSessionStatus: 'revoked',
      apiSessionExpiresAt: null,
      notes: [],
      noteVersionWatermarks: {},
      selectedNoteId: null,
    })
  },

  lock: () => {
    void clearRememberedUnlockedSession().catch(() => null)
    set({
      masterKey: null,
      credentialId: null,
      deviceName: null,
      apiSessionStatus: 'anonymous',
      apiSessionExpiresAt: null,
      notes: [],
      noteVersionWatermarks: {},
      selectedNoteId: null,
    })
  },
})
