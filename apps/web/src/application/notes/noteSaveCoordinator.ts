import type { SaveResult } from './saveResult'

export class NoteSaveCoordinator {
  private requested = false
  private latestTask: (() => Promise<SaveResult>) | null = null
  private running = false
  private waiters: Array<{
    resolve: (result: SaveResult) => void
    reject: (error: unknown) => void
  }> = []

  requestSave(task: () => Promise<SaveResult>): Promise<SaveResult> {
    this.latestTask = task
    this.requested = true

    const resultPromise = new Promise<SaveResult>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })

    if (!this.running) void this.drain()
    return resultPromise
  }

  private async drain(): Promise<void> {
    this.running = true
    let latestResult: SaveResult = {
      status: 'skipped',
      reason: 'not-ready',
    }

    try {
      while (this.requested) {
        this.requested = false
        const task = this.latestTask
        if (task) latestResult = await task()
      }

      const completedWaiters = this.waiters.splice(0)
      this.running = false
      for (const waiter of completedWaiters) waiter.resolve(latestResult)
    } catch (error) {
      const failedWaiters = this.waiters.splice(0)
      this.running = false
      for (const waiter of failedWaiters) waiter.reject(error)
    }
  }
}
