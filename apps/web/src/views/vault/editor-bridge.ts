import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { BlockNoteComponentRef } from '../../components/BlockNote'

export type VaultEditorBridge = {
  blockNoteRef: MutableRefObject<BlockNoteComponentRef | null>
  handleBlockNoteChange: (markdown: string) => void
  handleYjsDocChange: (event: { suppressDraftUpdate: boolean }) => void
  syncDraftContentFromEditor: () => void
}

export function useVaultEditorBridge(args: {
  draftContentRef: MutableRefObject<string>
  setDraftContent: (content: string) => void
}): VaultEditorBridge {
  const blockNoteRef = useRef<BlockNoteComponentRef | null>(null)
  const yjsContentSyncTimerRef = useRef<number | null>(null)

  const updateDraftContent = useCallback((markdown: string) => {
    args.draftContentRef.current = markdown
    args.setDraftContent(markdown)
  }, [args.draftContentRef, args.setDraftContent])

  const handleBlockNoteChange = useCallback((markdown: string): void => {
    updateDraftContent(markdown)
  }, [updateDraftContent])

  const handleYjsDocChange = useCallback((event: { suppressDraftUpdate: boolean }): void => {
    if (event.suppressDraftUpdate) return

    if (yjsContentSyncTimerRef.current !== null) {
      window.clearTimeout(yjsContentSyncTimerRef.current)
    }

    yjsContentSyncTimerRef.current = window.setTimeout(() => {
      yjsContentSyncTimerRef.current = null
      const markdown = blockNoteRef.current?.getMarkdown()
      if (typeof markdown === 'string' && markdown !== args.draftContentRef.current) {
        updateDraftContent(markdown)
      }
    }, 200)
  }, [args.draftContentRef, updateDraftContent])

  const syncDraftContentFromEditor = useCallback((): void => {
    const markdown = blockNoteRef.current?.getMarkdown()
    if (typeof markdown === 'string') updateDraftContent(markdown)
  }, [updateDraftContent])

  useEffect(() => () => {
    if (yjsContentSyncTimerRef.current !== null) {
      window.clearTimeout(yjsContentSyncTimerRef.current)
      yjsContentSyncTimerRef.current = null
    }
  }, [])

  return {
    blockNoteRef,
    handleBlockNoteChange,
    handleYjsDocChange,
    syncDraftContentFromEditor,
  }
}
