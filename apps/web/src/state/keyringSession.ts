import type { StateCreator } from 'zustand'
import {
  clearRememberedUnlockedSession,
  loadRememberedUnlockedSession,
} from '../lib/remember'
import type { InkryptState, KeyringSessionSlice } from './types'

export const createKeyringSessionSlice: StateCreator<
  InkryptState,
  [],
  [],
  KeyringSessionSlice
> = (set, get) => ({
  masterKey: null,
  pairingPrefillSecret: null,

  setPairingPrefillSecret: (pairingPrefillSecret) => set({ pairingPrefillSecret }),

  consumePairingPrefillSecret: () => {
    const pairingPrefillSecret = get().pairingPrefillSecret
    if (!pairingPrefillSecret) return null
    set({ pairingPrefillSecret: null })
    return pairingPrefillSecret
  },

  hydrateRememberedSession: async () => {
    if (get().masterKey) return

    try {
      const rememberedSession = await loadRememberedUnlockedSession()
      if (rememberedSession) set({ masterKey: rememberedSession.masterKey })
    } catch {
      void clearRememberedUnlockedSession().catch(() => null)
    }
  },
})
