import {
  advancePocketState,
  createStarterPocketState,
  dispatchPocketAction,
  loadSavedPocketState,
  savePocketState,
  type PocketState,
} from './pocketAquariumBridge'

type PocketAction = Readonly<{ type: string } & Record<string, unknown>>
type Listener = (state: PocketState) => void

/**
 * The single boundary that owns mutable Pocket Aquarium state for the 3D app. The root
 * deterministic reducer/economy/validation remain the source of truth — this controller
 * only sequences load/advance/dispatch/save so the scene and HUD project one authoritative
 * state and can never diverge.
 */
export interface PocketGameController {
  getState(): PocketState
  dispatch(action: PocketAction): void
  advance(realSeconds: number): void
  subscribe(listener: Listener): () => void
  load(): void
  save(): void
}

const SAVE_INTERVAL_MS = 2000

export function createPocketGameController(options?: {
  readonly monotonicNow?: () => number
  readonly wallClockNow?: () => number
  readonly storage?: Storage
}): PocketGameController {
  const monotonicNow = options?.monotonicNow
    ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0))
  const wallClockNow = options?.wallClockNow
    ?? (() => (typeof Date !== 'undefined' ? Date.now() : 0))
  const storage = options?.storage
  const listeners = new Set<Listener>()
  let lastSaveAt = 0

  // Migrate an existing shared save, else start a fresh feedable starter tank.
  let state: PocketState = loadSavedPocketState(wallClockNow(), storage) ?? createStarterPocketState()

  const notify = () => { for (const listener of listeners) listener(state) }
  const save = () => { savePocketState(state, wallClockNow(), storage); lastSaveAt = monotonicNow() }

  // Persist the authoritative starting state so a reload restores this exact tank.
  save()

  return {
    getState: () => state,
    dispatch(action) {
      state = dispatchPocketAction(state, action)
      save()
      notify()
    },
    advance(realSeconds) {
      if (!(realSeconds > 0)) return
      state = advancePocketState(state, realSeconds)
      if (monotonicNow() - lastSaveAt >= SAVE_INTERVAL_MS) save()
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load() {
      state = loadSavedPocketState(wallClockNow(), storage) ?? createStarterPocketState()
      save()
      notify()
    },
    save,
  }
}
