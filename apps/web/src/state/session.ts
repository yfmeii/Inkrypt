import type { StateCreator } from 'zustand'
import {
  clearRememberedUnlockedSession,
  loadRememberedUnlockedSession,
  rememberUnlockedSession,
} from '../lib/remember'
import type { InkryptState, SessionSlice } from './types'

export const createSessionSlice: StateCreator<InkryptState, [], [], SessionSlice> = (set, get) => ({
  masterKey: null,
  credentialId: null,
  deviceName: null,
  pairingPrefillSecret: null,

  setSession: ({ masterKey, credentialId, deviceName, remember }) => {
    set({
      masterKey,
      credentialId: credentialId ?? null,
      deviceName: deviceName ?? null,
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

  setDeviceName: (deviceName) => set({ deviceName }),

  setPairingPrefillSecret: (secret) => set({ pairingPrefillSecret: secret }),

  consumePairingPrefillSecret: () => {
    const secret = get().pairingPrefillSecret
    if (!secret) return null
    set({ pairingPrefillSecret: null })
    return secret
  },

  hydrateRememberedSession: async () => {
    const state = get()
    if (state.masterKey) return
    try {
      const remembered = await loadRememberedUnlockedSession()
      if (!remembered) return

      set({
        masterKey: remembered.masterKey,
        credentialId: remembered.credentialId,
        deviceName: remembered.deviceName,
      })
    } catch {
      void clearRememberedUnlockedSession().catch(() => null)
    }
  },

  lock: () => {
    void clearRememberedUnlockedSession().catch(() => null)
    set({
      masterKey: null,
      credentialId: null,
      deviceName: null,
      notes: [],
      selectedNoteId: null,
    })
  },
})
