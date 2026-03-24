import { create } from 'zustand'
import { createNotesSlice } from './notes'
import {
  applyStoredAppearance,
  bindSystemAppearanceListener,
  createPreferencesSlice,
} from './preferences'
import { createSessionSlice } from './session'
import type { InkryptState } from './types'

export type { DecryptedNote, InkryptState, ModeId, ThemeId } from './types'

export const useInkryptStore = create<InkryptState>()((...args) => ({
  ...createSessionSlice(...args),
  ...createPreferencesSlice(...args),
  ...createNotesSlice(...args),
}))

applyStoredAppearance()
bindSystemAppearanceListener(() => useInkryptStore.getState())
