import { useCallback, useEffect, useRef } from 'react'
import { NoteSaveCoordinator } from '../../application/notes/noteSaveCoordinator'
import type { SaveResult } from '../../application/notes/saveResult'

export type SaveSelected = (options?: { silent?: boolean }) => Promise<SaveResult>

export function useVaultSaveTriggers(args: {
  performSaveSelected: SaveSelected
  hasMasterKey: boolean
  hasSelection: boolean
  selectedBaselineReady: boolean
  dirty: boolean
  attachmentsBusy: boolean
  busy: boolean
  draftTitle: string
  draftContent: string
  draftTags: string
  draftFavorite: boolean
  draftAttachments: Record<string, string>
}): { saveSelected: SaveSelected } {
  const performSaveSelectedRef = useRef(args.performSaveSelected)
  const noteSaveCoordinatorRef = useRef(new NoteSaveCoordinator())
  performSaveSelectedRef.current = args.performSaveSelected

  const saveSelected = useCallback<SaveSelected>((options) => (
    noteSaveCoordinatorRef.current.requestSave(
      () => performSaveSelectedRef.current(options),
    )
  ), [])

  useEffect(() => {
    const autosaveReady = args.hasSelection &&
      args.hasMasterKey &&
      args.selectedBaselineReady &&
      args.dirty &&
      !args.attachmentsBusy &&
      !args.busy
    if (!autosaveReady) return

    const timer = window.setTimeout(() => {
      void saveSelected({ silent: true })
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [
    args.attachmentsBusy,
    args.busy,
    args.dirty,
    args.draftAttachments,
    args.draftContent,
    args.draftFavorite,
    args.draftTags,
    args.draftTitle,
    args.hasMasterKey,
    args.hasSelection,
    args.selectedBaselineReady,
    saveSelected,
  ])

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 's') return

      event.preventDefault()
      event.stopPropagation()
      if (args.hasSelection && !args.busy) void saveSelected()
    }

    window.addEventListener('keydown', handleSaveShortcut, true)
    return () => window.removeEventListener('keydown', handleSaveShortcut, true)
  }, [args.busy, args.hasSelection, saveSelected])

  return { saveSelected }
}
