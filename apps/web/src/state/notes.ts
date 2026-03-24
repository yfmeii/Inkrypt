import type { StateCreator } from 'zustand'
import type { InkryptState, NotesSlice } from './types'

export const createNotesSlice: StateCreator<InkryptState, [], [], NotesSlice> = (set, get) => ({
  notes: [],
  selectedNoteId: null,

  setNotes: (notes) =>
    set((state) => ({
      notes,
      selectedNoteId:
        state.selectedNoteId && notes.some((note) => note.id === state.selectedNoteId)
          ? state.selectedNoteId
          : null,
    })),

  upsertNote: (note) =>
    set((state) => {
      const index = state.notes.findIndex((candidate) => candidate.id === note.id)
      const next = index >= 0 ? [...state.notes] : [note, ...state.notes]
      if (index >= 0) next[index] = note
      return { notes: next }
    }),

  removeNote: (id) =>
    set((state) => ({
      notes: state.notes.filter((note) => note.id !== id),
      selectedNoteId: state.selectedNoteId === id ? null : state.selectedNoteId,
    })),

  selectNote: (id) => {
    const state = get()
    if (id && !state.notes.some((note) => note.id === id)) return
    set({ selectedNoteId: id })
  },
})
