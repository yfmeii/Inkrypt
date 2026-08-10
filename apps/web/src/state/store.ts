import { create } from 'zustand'
import { createApiSessionSlice } from './apiSession'
import { createKeyringSessionSlice } from './keyringSession'
import { createNotesSlice } from './notes'
import {
  applyStoredAppearance,
  bindSystemAppearanceListener,
  createPreferencesSlice,
} from './preferences'
import { createSessionCommandsSlice } from './session'
import type { InkryptState } from './types'

export type { DecryptedNote, InkryptState, ModeId, ThemeId } from './types'

export const useInkryptStore = create<InkryptState>()((...args) => ({
  ...createKeyringSessionSlice(...args),
  ...createApiSessionSlice(...args),
  ...createSessionCommandsSlice(...args),
  ...createPreferencesSlice(...args),
  ...createNotesSlice(...args),
}))

applyStoredAppearance()
bindSystemAppearanceListener(() => useInkryptStore.getState())
