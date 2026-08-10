import { describe, expect, it, vi } from 'vitest'
import { NoteSaveCoordinator } from './noteSaveCoordinator'

describe('NoteSaveCoordinator', () => {
  it('returns the explicit result of a save', async () => {
    const coordinator = new NoteSaveCoordinator()
    const result = await coordinator.requestSave(async () => ({
      status: 'saved' as const,
      mergedRemote: false,
      receipt: {
        noteId: 'note-1',
        version: 2,
        changeSequence: '2',
        updatedAt: 100,
        savedPayload: {
          meta: { title: 'Saved', created_at: 1, tags: [], is_favorite: false },
          content: 'saved content',
          attachments: {},
          format: 'blocknote+yjs-v1' as const,
          yjsSnapshotB64: 'saved-snapshot',
        },
      },
    }))

    expect(result.status).toBe('saved')
  })

  it('coalesces requests made while a save is running', async () => {
    const coordinator = new NoteSaveCoordinator()
    let releaseFirstSave!: () => void
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    const firstTask = vi.fn(async () => {
      await firstSaveGate
      return { status: 'skipped' as const, reason: 'not-ready' as const }
    })
    const supersededTask = vi.fn(async () => ({
      status: 'skipped' as const,
      reason: 'no-selection' as const,
    }))
    const latestTask = vi.fn(async () => ({
      status: 'failed' as const,
      error: 'network',
      canRetry: true,
    }))

    const firstPromise = coordinator.requestSave(firstTask)
    const sharedPromise = coordinator.requestSave(supersededTask)
    const latestPromise = coordinator.requestSave(latestTask)
    releaseFirstSave()

    await expect(firstPromise).resolves.toEqual({
      status: 'failed',
      error: 'network',
      canRetry: true,
    })
    await expect(sharedPromise).resolves.toEqual(await latestPromise)
    expect(firstTask).toHaveBeenCalledTimes(1)
    expect(supersededTask).not.toHaveBeenCalled()
    expect(latestTask).toHaveBeenCalledTimes(1)
  })
})
