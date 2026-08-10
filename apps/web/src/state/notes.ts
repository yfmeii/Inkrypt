import type { StateCreator } from 'zustand'
import type { InkryptState, NotesSlice } from './types'

export const createNotesSlice: StateCreator<InkryptState, [], [], NotesSlice> = (set, get) => ({
  notes: [],
  noteVersionWatermarks: {},
  selectedNoteId: null,

  setNotes: (notes) =>
    set((state) => {
      const noteVersionWatermarks = { ...state.noteVersionWatermarks }
      const acceptedNotes = notes.filter((note) => {
        const versionWatermark = noteVersionWatermarks[note.id] ?? 0
        const currentlyVisible = state.notes.some((candidate) => candidate.id === note.id)
        return note.version > versionWatermark || (currentlyVisible && note.version === versionWatermark)
      })

      for (const note of acceptedNotes) {
        noteVersionWatermarks[note.id] = Math.max(
          noteVersionWatermarks[note.id] ?? 0,
          note.version,
        )
      }

      return {
        notes: acceptedNotes,
        noteVersionWatermarks,
        selectedNoteId:
          state.selectedNoteId && acceptedNotes.some((note) => note.id === state.selectedNoteId)
            ? state.selectedNoteId
            : null,
      }
    }),

  upsertNote: (note) =>
    set((state) => {
      const versionWatermark = state.noteVersionWatermarks[note.id] ?? 0
      if (note.version <= versionWatermark) return state

      const index = state.notes.findIndex((candidate) => candidate.id === note.id)
      const next = index >= 0 ? [...state.notes] : [note, ...state.notes]
      if (index >= 0) next[index] = note
      return {
        notes: next,
        noteVersionWatermarks: {
          ...state.noteVersionWatermarks,
          [note.id]: note.version,
        },
      }
    }),

  removeNote: (id, version) =>
    set((state) => {
      const currentVersion = state.noteVersionWatermarks[id] ?? 0
      const removalVersion = version ?? currentVersion
      if (removalVersion < currentVersion) return state

      return {
        notes: state.notes.filter((note) => note.id !== id),
        noteVersionWatermarks: {
          ...state.noteVersionWatermarks,
          [id]: Math.max(currentVersion, removalVersion),
        },
        selectedNoteId: state.selectedNoteId === id ? null : state.selectedNoteId,
      }
    }),

  selectNote: (id) => {
    const state = get()
    if (id && !state.notes.some((note) => note.id === id)) return
    set({ selectedNoteId: id })
  },
})
