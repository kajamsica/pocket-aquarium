export function createPublicSaveNoticeTracker() {
  let manualTick: number | null = null
  return {
    queueManual(tick: number): string | null {
      if (manualTick !== null) return null
      manualTick = tick
      return `Manual save queued at tick ${tick}. Saving on this device…`
    },
    completed(manual: boolean, version: string, revision: number, tick: number,
      queuedDuringManual = false): string | null {
      if (!manual && (manualTick !== null || queuedDuringManual)) return null
      if (manual) {
        manualTick = null
        return `Manual ${version} save #${revision} completed at tick ${tick} on this device.`
      }
      return version === 'v7'
        ? `Public v7 save #${revision} completed on this device. Older saves remain untouched.`
        : `Public ${version} save #${revision} completed at tick ${tick} on this device. Older sources remain untouched.`
    },
    failed() { manualTick = null },
    get manualPending() { return manualTick !== null },
  }
}

export interface PublicSaveRequest<T> {
  snapshot: T
  manual: boolean
  queuedDuringManual: boolean
  savedTravelVersion: number
}

export function createPublicSaveScheduler<T>(write: (request: PublicSaveRequest<T>) => Promise<boolean>) {
  let active = false
  let waitingManual: PublicSaveRequest<T> | null = null
  let waitingAutomatic: PublicSaveRequest<T> | null = null
  let idleWaiters: Array<() => void> = []
  const drain = async () => {
    active = true
    while (waitingManual || waitingAutomatic) {
      const request = waitingManual ?? waitingAutomatic!
      if (request.manual) waitingManual = null
      else waitingAutomatic = null
      let saved = false
      try { saved = await write(request) } catch { /* The caller reports write errors. */ }
      if (!saved) { waitingManual = null; waitingAutomatic = null; break }
    }
    active = false
    const settled = idleWaiters
    idleWaiters = []
    settled.forEach((resolve) => resolve())
  }
  return {
    enqueue(request: PublicSaveRequest<T>) {
      if (request.manual) {
        if (waitingManual) return
        waitingAutomatic = null
        waitingManual = request
      } else waitingAutomatic = request
      if (!active) void drain()
    },
    whenIdle(): Promise<void> {
      return active ? new Promise((resolve) => idleWaiters.push(resolve)) : Promise.resolve()
    },
  }
}
