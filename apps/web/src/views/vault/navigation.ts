import { useEffect, useState } from 'react'
import { readInkryptNavState, withInkryptNavState } from '../../lib/navigation'
import type { DecryptedNote } from '../../state/store'

function ensureHistoryIsListEntry(): void {
  if (typeof window === 'undefined') return
  const nav = readInkryptNavState(history.state)
  if (nav) return
  history.replaceState(withInkryptNavState(history.state, { v: 1, page: 'list' }), '')
}

export function useVaultNavigation({
  isNarrow,
  notes,
  selectedNoteId,
  selectNote,
}: {
  isNarrow: boolean
  notes: DecryptedNote[]
  selectedNoteId: string | null
  selectNote: (id: string | null) => void
}) {
  const [mobilePane, setMobilePane] = useState<'list' | 'editor'>('list')

  function navigateToNote(noteId: string): void {
    selectNote(noteId)
    if (isNarrow) setMobilePane('editor')

    if (typeof window === 'undefined' || !isNarrow) return
    ensureHistoryIsListEntry()

    const currentNav = readInkryptNavState(history.state)
    const next = withInkryptNavState(history.state, { v: 1, page: 'note', noteId })

    if (currentNav?.page === 'note') history.replaceState(next, '')
    else history.pushState(next, '')
  }

  function navigateToList(): void {
    if (!isNarrow) return
    if (typeof window === 'undefined') {
      setMobilePane('list')
      return
    }

    const currentNav = readInkryptNavState(history.state)
    if (currentNav?.page === 'note') {
      history.back()
      return
    }

    ensureHistoryIsListEntry()
    setMobilePane('list')
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    ensureHistoryIsListEntry()

    const applyNav = (state: unknown) => {
      const nav = readInkryptNavState(state)
      if (!nav || nav.page === 'list') {
        if (isNarrow) setMobilePane('list')
        return
      }

      const noteId = nav.noteId
      if (!noteId || !notes.some((note) => note.id === noteId)) {
        history.replaceState(withInkryptNavState(history.state, { v: 1, page: 'list' }), '')
        if (isNarrow) setMobilePane('list')
        return
      }

      selectNote(noteId)
      if (isNarrow) setMobilePane('editor')
    }

    applyNav(history.state)
    const onPopState = (event: PopStateEvent) => applyNav(event.state)

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [isNarrow, notes, selectNote])

  useEffect(() => {
    if (!isNarrow) return
    if (!selectedNoteId) {
      navigateToList()
      return
    }

    if (mobilePane !== 'editor') return
    const nav = readInkryptNavState(history.state)
    if (nav?.page !== 'note' || nav.noteId !== selectedNoteId) {
      navigateToNote(selectedNoteId)
    }
  }, [isNarrow, mobilePane, selectedNoteId])

  return {
    mobilePane,
    navigateToNote,
    navigateToList,
  }
}
