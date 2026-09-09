import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReefRenderSettings, ReefRenderTelemetry } from './contracts'
import {
  advancePocketState,
  advancePocketStateDevSafe,
  createPocketNewGame,
  createPocketFreshwaterDevTank,
  createPocketReefShowcase,
  DEV_FRESHWATER_50_TANK_ID,
  devSafeSaveKey,
  dispatchPocketAction,
  isDevSafeActive,
  pocketActions,
  pocketSaveKey,
  projectPocketState,
  restorePocketGame,
  restorePocketGameDevSafe,
  savedRecordSupersedes,
  serializePocketGame,
  type PocketPreventedDeath,
  type PocketRockView,
  type PocketState,
} from './integration/pocketAquariumBridge'
import {
  createPocketTankRepository,
  type PocketActiveTank,
  type PocketTankRepositorySnapshot,
} from './integration/pocketTankRepository'
import { ReefScene } from './scene/ReefScene'
import type { CoralPlacementCandidate } from './scene/CoralPlacement'
import { FeedingProvider, type FeedingApi } from './scene/feeding'
import { createAcceptedShowcaseCatalog, SpecimenRosterProvider, type SpecimenHover } from './scene/SpecimenFish'
import { PocketGameHUD } from './ui/PocketGameHUD'
import { changedRockTransform, RockscapeEditor, type RockTransformPatch } from './ui/RockscapeEditor'
import {
  advanceCoralDraft,
  beginCoralDraft,
  CoralInventoryTray,
  lockableCoralDraft,
  type CoralDraftState,
} from './ui/CoralInventoryTray'
import { SpecimenWorkbench } from './workbench/SpecimenWorkbench'
import type { AquariumLibraryModel } from './ui/AquariumLibraryPanel'

const UPDATE_INTERVAL_MS = 250
const MAX_ELAPSED_REAL_SECONDS = 0.5
const RENDER_TELEMETRY_INTERVAL_MS = 250
const DEFAULT_RENDER_SETTINGS: ReefRenderSettings = {
  quality: 'balanced',
  diagnosticView: 'beauty',
  brightness: 1,
}
const SEARCH_PARAMS = new URLSearchParams(window.location.search)
const WORKBENCH_SPECIES = SEARCH_PARAMS.get('workbench')
const SHOWCASE_MODE = SEARCH_PARAMS.get('showcase') === '1'
const DEV_SAFE = isDevSafeActive()
const SAVE_KEY = DEV_SAFE ? devSafeSaveKey : pocketSaveKey
const LEGACY_GOD_MODE_KEY = `${devSafeSaveKey}:god-mode`
const DEV_TANK = DEV_SAFE ? SEARCH_PARAMS.get('devTank') : null
const TANK_STORAGE = WORKBENCH_SPECIES !== null || SHOWCASE_MODE ? null : (() => {
  try { return window.localStorage } catch { return null }
})()
const TANK_REPOSITORY = TANK_STORAGE ? createPocketTankRepository({
  storage: TANK_STORAGE,
  baseKey: SAVE_KEY,
}) : null
const TANK_INDEX_KEY = `${SAVE_KEY}:tank-index-v1`
const MAX_PREVENTED = 20
const ACCEPTED_SHOWCASE_CATALOG = SHOWCASE_MODE ? createAcceptedShowcaseCatalog() : undefined
const ROCK_SCENE_HALF_WIDTH = 2.76
const ROCK_SCENE_HALF_DEPTH = 1.18

function bounded(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function cloneRockView(rock: PocketRockView): PocketRockView {
  return { ...rock,
    position: [...rock.position] as PocketRockView['position'],
    rotation: [...rock.rotation] as PocketRockView['rotation'],
    scale: [...rock.scale] as PocketRockView['scale'],
    biology: { ...rock.biology } }
}

/** The dev shell's persisted God Mode preference. Protection defaults on and only an explicit
 *  opt-out disables it, and the toggle writes this key synchronously, so this is the live answer.
 *  Component initialization and saved-state restore both read it here, so they cannot disagree
 *  about whether protection is active. Outside the dev shell the value is unused: every caller
 *  gates on `DEV_SAFE` first, so production keeps taking the unmodified simulator. */
function godModePreferred() {
  if (!DEV_SAFE) return true
  try { return window.localStorage.getItem(LEGACY_GOD_MODE_KEY) !== '0' } catch { return true }
}

function tankGodModeKey(tankId: string) {
  return `${devSafeSaveKey}:god-mode:${tankId}`
}

function tankGodModePreferred(tankId: string) {
  if (!DEV_SAFE) return true
  try {
    const key = tankGodModeKey(tankId)
    const stored = window.localStorage.getItem(key)
    if (stored !== null) return stored !== '0'
    if (tankId === 'legacy') {
      const legacy = window.localStorage.getItem(LEGACY_GOD_MODE_KEY)
      if (legacy !== null) {
        const preferred = legacy !== '0'
        window.localStorage.setItem(key, preferred ? '1' : '0')
        return preferred
      }
    }
  } catch { /* storage is optional */ }
  return true
}

function repositoryActiveState(active: PocketActiveTank) {
  if (!DEV_SAFE || !tankGodModePreferred(active.id) || !TANK_STORAGE) return active.state
  try {
    const raw = TANK_STORAGE.getItem(active.storageKey)
    return raw === null ? active.state : restorePocketGameDevSafe(JSON.parse(raw)).state
  } catch { return active.state }
}

function initializeTankRepository() {
  if (!TANK_REPOSITORY) return null
  try {
    let snapshot = TANK_REPOSITORY.getSnapshot()
    if (DEV_TANK !== 'freshwater-50') return snapshot
    const exists = snapshot.index.tanks.some(({ id }) => id === DEV_FRESHWATER_50_TANK_ID)
    if (!exists) {
      snapshot = TANK_REPOSITORY.createTank({
        name: 'Freshwater 50',
        state: createPocketFreshwaterDevTank(),
        reservedId: DEV_FRESHWATER_50_TANK_ID,
      })
      try { window.localStorage.setItem(tankGodModeKey(DEV_FRESHWATER_50_TANK_ID), '1') } catch { /* storage is optional */ }
      return snapshot
    }
    return snapshot.index.activeTankId === DEV_FRESHWATER_50_TANK_ID
      ? snapshot : TANK_REPOSITORY.activateTank(DEV_FRESHWATER_50_TANK_ID)
  } catch {
    return null
  }
}

function earnedCreditsIn(log: PocketState['log']) {
  return log.reduce((total, entry) => {
    const compactAward = entry.message.match(/\(\+(\d+)c(?:\s|\))/)
    const rankAward = entry.message.match(/\(\+(\d+) tank credits\)/)
    return total + Number(compactAward?.[1] ?? rankAward?.[1] ?? 0)
  }, 0)
}

/**
 * Multi-view save coherence. Every write stamps a monotonic `saveSeq` next to the state, and this
 * view remembers the highest record it has written or adopted. A periodic/pagehide writer that
 * finds a higher `saveSeq` in storage is holding stale state, so it yields and adopts instead of
 * overwriting. A player action never overwrites either: it rebases onto that newer save first and
 * then writes one above it, so it becomes authoritative without discarding the peer action it
 * arrived after. Wall-clock stamps cannot do this job — every view stamps
 * `lastRealTimestamp` with its own `now`, so a stale view looks newer than the action that beat it.
 * `saveSeq` is save-envelope metadata only: the root sanitizer keeps just the fields it knows, so
 * it never reaches simulation state, and a save written without it still restores unchanged.
 */
interface SaveRecord {
  readonly raw: string
  readonly parsed: unknown
  /** null for a legacy or foreign save written without this metadata. */
  readonly seq: number | null
}

let seenSeq = 0
let seenRaw: string | null = null

function readSaveRecord(): SaveRecord | null {
  if (SHOWCASE_MODE) return null
  let raw: string | null = null
  try { raw = window.localStorage.getItem(SAVE_KEY) } catch { return null } // storage is optional
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { saveSeq?: unknown } | null
    const seq = parsed?.saveSeq
    return { raw, parsed, seq: typeof seq === 'number' && Number.isFinite(seq) ? seq : null }
  } catch { return null }
}

/** True when storage holds a save this view has not accounted for. The ordering rule itself lives
 *  with the save contract in the bridge, so both routes that share this key agree on it. */
function holdsNewerSave(record: SaveRecord) {
  return savedRecordSupersedes(record, { seq: seenSeq, raw: seenRaw })
}

/** Restore a stored record and mark it as seen, so this view stops treating its own state as newer. */
function restoreSaveRecord(record: SaveRecord): PocketState {
  seenSeq = record.seq ?? seenSeq
  seenRaw = record.raw
  // Away time is applied before the state is used, so protected play needs the protected restore.
  // God Mode off must resume the unmodified simulator here too, or a reload or cross-view save
  // adoption would silently hand an opted-out player death-protected catch-up.
  return DEV_SAFE && godModePreferred()
    ? restorePocketGameDevSafe(record.parsed).state : restorePocketGame(record.parsed)
}

/**
 * The state an intentional action must apply to. This view can be holding an aquarium a peer view
 * has already superseded — a rename committed in the other route, with no adoption sweep run here
 * yet. Applying the action to that stale copy and stamping the result one sequence above storage
 * would erase the peer's action instead of ordering after it, so the action is rebased onto the
 * restored newer save first. The action still wins: it lands on top of the peer's aquarium, keeping
 * fields like `customName`, and persists one sequence above it. Exported because the commit path is
 * what the cross-view tests drive; this module's component cannot be mounted without a DOM.
 */
export function rebaseOnStoredSave(local: PocketState): PocketState {
  const record = readSaveRecord()
  return record && holdsNewerSave(record) ? restoreSaveRecord(record) : local
}

/** The one local save writer: showcase stays nonpersistent and storage stays optional. The new
 *  sequence clears both this view's and storage's high mark. Callers reach here only after yielding
 *  to or rebasing onto anything newer, so this always writes rather than losing a race. */
export function persistPocketState(state: PocketState) {
  if (SHOWCASE_MODE) return
  const stamped = { ...state, saveSeq: Math.max(readSaveRecord()?.seq ?? 0, seenSeq) + 1 }
  const payload = serializePocketGame(stamped)
  try { window.localStorage.setItem(SAVE_KEY, payload) } catch { return } // storage is optional
  seenSeq = stamped.saveSeq
  seenRaw = payload
}

if (WORKBENCH_SPECIES !== null) {
  const icon = document.createElement('link')
  icon.rel = 'icon'
  icon.href = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%23e87528'/%3E%3Cpath d='M10 4v24M21 4v24' stroke='white' stroke-width='5'/%3E%3C/svg%3E"
  document.head.append(icon)
}

function AquariumApp() {
  const [initial] = useState(() => {
    if (SHOWCASE_MODE) return {
      snapshot: null,
      state: createPocketReefShowcase(),
      protectionOn: godModePreferred(),
    }
    const snapshot = initializeTankRepository()
    const active = snapshot?.active
    return {
      snapshot,
      state: active ? repositoryActiveState(active) : createPocketNewGame(),
      protectionOn: active ? tankGodModePreferred(active.id) : true,
    }
  })
  const [tankSnapshot, setTankSnapshot] = useState<PocketTankRepositorySnapshot | null>(initial.snapshot)
  const tankSnapshotRef = useRef(tankSnapshot)
  const [pocketState, setPocketState] = useState(initial.state)
  const pocketStateRef = useRef(pocketState)
  const [prevented, setPrevented] = useState<readonly PocketPreventedDeath[]>([])
  // Death protection defaults on inside the gated dev shell; toggling only changes future ticks
  // and persists as a dev-only preference, so a deliberate opt-out survives a refresh.
  const [protectionOn, setProtectionOn] = useState(initial.protectionOn)
  const protectionRef = useRef(protectionOn)
  protectionRef.current = protectionOn
  const [creatingTank, setCreatingTank] = useState(false)
  const [hoveredSpecimen, setHoveredSpecimen] = useState<SpecimenHover | null>(null)
  const [renderSettings, setRenderSettings] = useState(DEFAULT_RENDER_SETTINGS)
  const [renderTelemetry, setRenderTelemetry] = useState<ReefRenderTelemetry>()
  const [activeCoralId, setActiveCoralId] = useState<number | null>(null)
  const [coralDraft, setCoralDraft] = useState<CoralDraftState<CoralPlacementCandidate> | null>(null)
  const [rockscapeDraft, setRockscapeDraft] = useState<readonly PocketRockView[] | null>(null)
  const rockscapeBase = useRef<readonly PocketRockView[] | null>(null)
  const [selectedRockId, setSelectedRockId] = useState<number | null>(null)
  const clearTankTransientState = useCallback(() => {
    setPrevented([])
    setHoveredSpecimen(null)
    setActiveCoralId(null)
    setCoralDraft(null)
    rockscapeBase.current = null
    setRockscapeDraft(null)
    setSelectedRockId(null)
  }, [])
  const adoptTankSnapshot = useCallback((snapshot: PocketTankRepositorySnapshot) => {
    const previousTankId = tankSnapshotRef.current?.active?.id ?? null
    const active = snapshot.active
    const nextState = active ? repositoryActiveState(active) : createPocketNewGame()
    const nextSnapshot = active ? { ...snapshot, active: { ...active, state: nextState } } : snapshot
    const nextProtection = active ? tankGodModePreferred(active.id) : true
    tankSnapshotRef.current = nextSnapshot
    pocketStateRef.current = nextState
    protectionRef.current = nextProtection
    setTankSnapshot(nextSnapshot)
    setPocketState(nextState)
    setProtectionOn(nextProtection)
    if (previousTankId !== (active?.id ?? null)) clearTankTransientState()
  }, [clearTankTransientState])
  const refreshTankIndex = useCallback((snapshot: PocketTankRepositorySnapshot) => {
    const current = tankSnapshotRef.current?.active
    if (!current || snapshot.active?.id !== current.id) {
      adoptTankSnapshot(snapshot)
      return
    }
    const next = { ...snapshot, active: { ...snapshot.active, state: pocketStateRef.current } }
    tankSnapshotRef.current = next
    setTankSnapshot(next)
  }, [adoptTankSnapshot])
  const previewCandidate = coralDraft?.candidate ?? null
  const lastTelemetryUpdate = useRef(0)
  const godModeOn = DEV_SAFE && protectionOn
  const view = projectPocketState(pocketState, { godMode: godModeOn })
  const activeCoral = view.coralInventory.find((coral) => coral.id === activeCoralId)
  const occupiedRockIds = new Set(view.placedCorals.flatMap((coral) => {
    const match = /^rock:(\d+)$/.exec(coral.placement?.surfaceId ?? '')
    return match ? [Number(match[1])] : []
  }))
  const displayedCorals = rockscapeDraft && rockscapeBase.current
    ? view.placedCorals.map((coral) => {
      const placement = coral.placement
      const match = /^rock:(\d+)$/.exec(placement?.surfaceId ?? '')
      if (!placement || !match) return coral
      const rockId = Number(match[1])
      const base = rockscapeBase.current?.find((rock) => rock.id === rockId)
      const draft = rockscapeDraft.find((rock) => rock.id === rockId)
      if (!base || !draft) return coral
      return { ...coral, placement: { ...placement, position: [
        bounded(placement.position[0] + (draft.position[0] - base.position[0]) / ROCK_SCENE_HALF_WIDTH, -1, 1),
        placement.position[1],
        bounded(placement.position[2] + (draft.position[2] - base.position[2]) / ROCK_SCENE_HALF_DEPTH, -1, 1),
      ] as const } }
    }) : view.placedCorals
  // The ref is advanced by whichever writer produced the state (dispatch or a tick), never during
  // render, so a discarded Strict Mode/concurrent render pass cannot roll it back behind an action.

  useEffect(() => {
    let previousUpdate = performance.now()

    const timer = window.setInterval(() => {
      const currentUpdate = performance.now()
      const elapsedRealSeconds = Math.min(
        (currentUpdate - previousUpdate) / 1000,
        MAX_ELAPSED_REAL_SECONDS,
      )
      previousUpdate = currentUpdate
      if (DEV_SAFE && protectionRef.current) {
        const advanced = advancePocketStateDevSafe(pocketStateRef.current, elapsedRealSeconds)
        pocketStateRef.current = advanced.state
        setPocketState(advanced.state)
        if (advanced.prevented.length) setPrevented((log) => [...advanced.prevented, ...log].slice(0, MAX_PREVENTED))
        return
      }
      // Advance from the ref, like the protected branch above: it is the state a player action may
      // have just committed, and a Strict Mode double-invoked updater must not tick twice. Ticks
      // deliberately do not write storage — the periodic save below stays their only writer.
      const advanced = advancePocketState(pocketStateRef.current, elapsedRealSeconds)
      pocketStateRef.current = advanced
      setPocketState(advanced)
    }, UPDATE_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!TANK_REPOSITORY) return
    // Crash/offline coverage only: player actions already persisted themselves at dispatch time,
    // so this stays a one-second sweep for simulation ticks rather than a per-tick write.
    const save = () => {
      const active = tankSnapshotRef.current?.active
      if (!active) return
      try {
        const result = TANK_REPOSITORY.saveActive(active.id, pocketStateRef.current)
        if (result.status !== 'saved') adoptTankSnapshot(result.snapshot)
      } catch { /* storage is optional */ }
    }
    const timer = window.setInterval(save, 1000)
    window.addEventListener('pagehide', save)
    // Index writes can rename or switch the active tank. Active save writes can supersede this
    // view's current aquarium. Both refresh through the repository instead of writing in reply.
    const adoptPeerWrite = (event: StorageEvent) => {
      const activeStorageKey = tankSnapshotRef.current?.active?.storageKey
      if (event.key !== TANK_INDEX_KEY && event.key !== activeStorageKey) return
      try {
        const snapshot = TANK_REPOSITORY.getSnapshot()
        if (event.key === TANK_INDEX_KEY) refreshTankIndex(snapshot)
        else adoptTankSnapshot(snapshot)
      } catch { /* storage is optional */ }
    }
    window.addEventListener('storage', adoptPeerWrite)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', save)
      window.removeEventListener('storage', adoptPeerWrite)
    }
  }, [adoptTankSnapshot, refreshTankIndex])

  // A completed player action commits as one immediate unit: the ref, React state, and the active
  // save key all take the exact resulting state before control returns to the browser, so a reload
  // or background transition inside the one-second save window cannot erase it. Accepted and
  // rejected actions commit identically — a rejection's log is the state it produced. Applying the
  // action here rather than inside a state updater also keeps Strict Mode, which double-invokes
  // updaters, from executing the same gameplay action twice.
  const dispatch = useCallback((action: Parameters<typeof dispatchPocketAction>[1]) => {
    // God mode: apply the action with unlimited credits and the root's purchase gates bypassed,
    // the same bypass the Store used to paint every offer purchasable, so an enabled button is
    // never refused, then restore the real dev-save balance so purchases/refills are free. Real
    // milestone rewards earned by the action still accrue, so toggling God mode off cannot erase
    // a keeper-rank payout.
    const reduce = (current: PocketState) => {
      if (!(DEV_SAFE && protectionRef.current)) return dispatchPocketAction(current, action)
      const next = dispatchPocketAction({ ...current, credits: Number.MAX_SAFE_INTEGER }, action, { godMode: true })
      next.credits = current.credits + earnedCreditsIn(next.log.slice(current.log.length))
      return next
    }
    const active = tankSnapshotRef.current?.active
    if (TANK_REPOSITORY && active) {
      try {
        const result = TANK_REPOSITORY.commitActiveAction(active.id, pocketStateRef.current, reduce)
        adoptTankSnapshot(result.snapshot)
      } catch { /* storage is optional */ }
      return
    }
    const next = reduce(pocketStateRef.current)
    pocketStateRef.current = next
    persistPocketState(next)
    setPocketState(next)
  }, [adoptTankSnapshot])

  const godMode = useMemo(() => DEV_SAFE ? {
    on: protectionOn,
    prevented,
    toggle: () => {
      const next = !protectionOn
      protectionRef.current = next
      setProtectionOn(next)
      const activeTankId = tankSnapshot?.active?.id
      const key = SHOWCASE_MODE ? LEGACY_GOD_MODE_KEY
        : activeTankId ? tankGodModeKey(activeTankId) : null
      if (!key) return
      try { window.localStorage.setItem(key, next ? '1' : '0') } catch { /* storage is optional */ }
    },
  } : undefined, [prevented, protectionOn, tankSnapshot?.active?.id])

  const feeding = useMemo<FeedingApi>(() => ({
    food: view.food,
    feed: (normalizedX) => dispatch({ type: 'FEED', x: normalizedX }),
    consume: (foodId, eaterId) => dispatch({ type: 'CONSUME_FOOD', foodId, eaterId }),
  }), [dispatch, view.food])

  const updateRenderTelemetry = useCallback((telemetry: ReefRenderTelemetry) => {
    const now = performance.now()
    if (now - lastTelemetryUpdate.current < RENDER_TELEMETRY_INTERVAL_MS) return
    lastTelemetryUpdate.current = now
    setRenderTelemetry(telemetry)
  }, [])

  const armCoral = useCallback((coralId: number) => {
    setActiveCoralId(coralId)
    setCoralDraft(beginCoralDraft())
  }, [])
  const cancelCoral = useCallback(() => {
    setActiveCoralId(null)
    setCoralDraft(null)
  }, [])
  const lockCoral = useCallback(() => {
    const candidate = lockableCoralDraft(coralDraft)
    if (!activeCoral || !candidate) return
    dispatch({ type: pocketActions.LOCK_CORAL_PLACEMENT, coralId: activeCoral.id,
      placement: candidate.placement })
    setActiveCoralId(null)
    setCoralDraft(null)
  }, [activeCoral, coralDraft, dispatch])
  const updateCoralDraft = useCallback((candidate: CoralPlacementCandidate | null,
    intent: 'follow' | 'freeze' = 'follow') => {
    setCoralDraft((draft) => draft ? advanceCoralDraft(draft, candidate, intent) : null)
  }, [])

  const beginRockscape = useCallback(() => {
    cancelCoral()
    const base = view.rockscape.map(cloneRockView)
    rockscapeBase.current = base
    setRockscapeDraft(base.map(cloneRockView))
    setSelectedRockId(view.rockscape[0]?.id ?? null)
  }, [cancelCoral, view.rockscape])
  const updateRockscapeDraft = useCallback((rockId: number, patch: RockTransformPatch) => {
    setSelectedRockId(rockId)
    setRockscapeDraft((rocks) => rocks?.map((rock) => rock.id === rockId ? { ...rock, ...patch } : rock) ?? null)
  }, [])
  const cancelRockscape = useCallback(() => {
    setRockscapeDraft(null)
    rockscapeBase.current = null
    setSelectedRockId(null)
  }, [])
  const lockRockscape = useCallback(() => {
    const base = rockscapeBase.current
    if (!rockscapeDraft || !base) return
    for (const rock of rockscapeDraft) {
      const original = base.find(({ id }) => id === rock.id)
      if (!original) continue
      const patch = changedRockTransform(original, rock)
      if (patch) dispatch({ type: pocketActions.UPDATE_ROCK_TRANSFORM, rockId: rock.id, ...patch })
    }
    setRockscapeDraft(null)
    rockscapeBase.current = null
    setSelectedRockId(null)
  }, [dispatch, rockscapeDraft])

  const saveCurrentTank = useCallback(() => {
    const active = tankSnapshotRef.current?.active
    if (!TANK_REPOSITORY || !active) return true
    try {
      const result = TANK_REPOSITORY.saveActive(active.id, pocketStateRef.current)
      if (result.status === 'active_changed') {
        adoptTankSnapshot(result.snapshot)
        return false
      }
      if (result.status === 'adopted') adoptTankSnapshot(result.snapshot)
      return true
    } catch { return false }
  }, [adoptTankSnapshot])

  const beginCreateTank = useCallback(() => {
    if (saveCurrentTank()) setCreatingTank(true)
  }, [saveCurrentTank])

  const activateTank = useCallback((id: string) => {
    const active = tankSnapshotRef.current?.active
    if (!TANK_REPOSITORY || active?.id === id || !saveCurrentTank()) return
    try { adoptTankSnapshot(TANK_REPOSITORY.activateTank(id)) } catch { /* keep the current tank */ }
  }, [adoptTankSnapshot, saveCurrentTank])

  const renameTank = useCallback((id: string, name: string) => {
    if (!TANK_REPOSITORY) return
    try { refreshTankIndex(TANK_REPOSITORY.renameTank(id, name)) }
    catch { /* invalid names leave the existing library unchanged */ }
  }, [refreshTankIndex])

  const chooseHabitat = useCallback((habitat: 'reef' | 'amazon') => {
    const next = dispatchPocketAction(createPocketNewGame(), {
      type: pocketActions.CHOOSE_HABITAT,
      habitat,
    })
    if (!TANK_REPOSITORY) {
      pocketStateRef.current = next
      persistPocketState(next)
      setCreatingTank(false)
      clearTankTransientState()
      setPocketState(next)
      return
    }
    try {
      let active = tankSnapshotRef.current?.active
      if (!creatingTank && active && !saveCurrentTank()) return
      active = tankSnapshotRef.current?.active
      const snapshot = creatingTank || !active
        ? TANK_REPOSITORY.createTank({
          name: habitat === 'reef' ? 'Reef Tank' : 'Freshwater Tank',
          state: next,
        })
        : TANK_REPOSITORY.resetTank(active.id, next)
      setCreatingTank(false)
      adoptTankSnapshot(snapshot)
      clearTankTransientState()
    } catch { /* leave the chooser open when storage cannot commit */ }
  }, [adoptTankSnapshot, clearTankTransientState, creatingTank, saveCurrentTank])

  const startOver = useCallback(() => {
    const next = createPocketNewGame()
    let active = tankSnapshotRef.current?.active
    if (TANK_REPOSITORY && active) {
      if (!saveCurrentTank()) return
      active = tankSnapshotRef.current?.active
      if (!active) return
      try {
        adoptTankSnapshot(TANK_REPOSITORY.resetTank(active.id, next))
        setCreatingTank(false)
        clearTankTransientState()
      } catch { /* keep the current tank when storage cannot commit */ }
      return
    }
    pocketStateRef.current = next
    persistPocketState(next)
    clearTankTransientState()
    setPocketState(next)
  }, [adoptTankSnapshot, clearTankTransientState, saveCurrentTank])

  const tankLibrary = useMemo<AquariumLibraryModel | undefined>(() => TANK_REPOSITORY && tankSnapshot ? {
    tanks: tankSnapshot.index.tanks.map((tank) => ({
      ...tank,
      active: tank.id === tankSnapshot.index.activeTankId,
    })),
    onCreate: beginCreateTank,
    onActivate: activateTank,
    onRename: renameTank,
  } : undefined, [activateTank, beginCreateTank, renameTank, tankSnapshot])
  const candidateStatus = previewCandidate ? {
    valid: previewCandidate.valid,
    frozen: coralDraft?.phase === 'frozen',
    message: coralDraft?.phase === 'frozen' ? 'Temporary position selected. Select Lock here to confirm.'
      : previewCandidate.valid ? 'Valid preview. Click sand or rock to select this temporary position.'
      : `Choose another position (${previewCandidate.reason ?? 'invalid surface'}).`,
  } : null

  if (creatingTank || !pocketState.habitat) return <main className="reef-app pocket-reef-app pocket-habitat-setup">
    <section className="pocket-habitat-chooser" aria-labelledby="pocket-habitat-title">
      <p>Build a living aquarium</p>
      <h1 id="pocket-habitat-title">Choose your water</h1>
      <span>The same physical tank simulation supports two distinct ecosystems. Your choice sets the water, cycle, equipment, and residents.</span>
      <div className="pocket-habitat-options">
        <button type="button" onClick={() => chooseHabitat('reef')}>
          <small>Saltwater</small><strong>Reef lagoon</strong>
          <span>Live rock, coral, marine fish, salinity, and reef lighting.</span>
        </button>
        <button type="button" onClick={() => chooseHabitat('amazon')}>
          <small>Freshwater</small><strong>Amazonian margin</strong>
          <span>Soft tannin water, planted cover, schooling fish, and freshwater filtration.</span>
        </button>
      </div>
      {creatingTank ? <button className="hud-button" type="button" onClick={() => setCreatingTank(false)}>Cancel</button> : null}
    </section>
  </main>

  const reef = view.reefSnapshot.namespace === 'marine_reef'

  return (
    <main key={tankSnapshot?.active?.id ?? 'showcase'} className="reef-app pocket-reef-app"
      data-aquarium={view.reefSnapshot.namespace}>
      <FeedingProvider value={feeding}>
        {/* Root `view.selection` stays the single selection authority: the tank marks whichever
          * resident it names, whether the tank or the Residents roster made that selection. */}
        <SpecimenRosterProvider specimens={view.specimens} nori={view.nori} dispatch={dispatch}
          selectedSpecimenId={view.selection?.entityType === 'livestock' ? view.selection.id : null}
          onHoverSpecimen={setHoveredSpecimen}>
          <ReefScene
            snapshot={view.reefSnapshot}
            renderSettings={renderSettings}
            onRenderTelemetry={updateRenderTelemetry}
            placedCorals={displayedCorals}
            activeCoral={activeCoral}
            previewCandidate={previewCandidate}
            onPlacementCandidate={updateCoralDraft}
            rockscape={rockscapeDraft ?? view.rockscape}
            rockscapeEditing={rockscapeDraft !== null}
            selectedRockId={selectedRockId}
            onRockSelect={setSelectedRockId}
            onRockTransformPreview={updateRockscapeDraft}
            sand={view.sand}
          />
        </SpecimenRosterProvider>
      </FeedingProvider>
      <PocketGameHUD
        view={view}
        dispatch={dispatch}
        renderSettings={renderSettings}
        renderTelemetry={renderTelemetry}
        onRenderSettingsChange={setRenderSettings}
        godMode={godMode}
        showcaseCatalog={ACCEPTED_SHOWCASE_CATALOG}
        hoveredSpecimen={hoveredSpecimen}
        tankLibrary={tankLibrary}
        onStartOver={startOver}
      />
      {!reef || rockscapeDraft ? null : <CoralInventoryTray inventory={view.coralInventory} activeId={activeCoralId}
        candidate={candidateStatus} onArm={armCoral} onPointerArm={(coralId) => armCoral(coralId)}
        onCancel={cancelCoral} onLock={lockCoral} />}
      {reef ? <RockscapeEditor active={rockscapeDraft !== null} rocks={rockscapeDraft ?? view.rockscape}
        occupiedRockIds={occupiedRockIds}
        selectedRockId={selectedRockId} onBegin={beginRockscape} onSelect={setSelectedRockId}
        onPatch={updateRockscapeDraft} onSave={lockRockscape} onCancel={cancelRockscape} /> : null}
    </main>
  )
}

export default function App() {
  // Any ?workbench=<catalog-id> opens the workbench; unknown ids fall back visibly to Ocellaris inside it.
  return WORKBENCH_SPECIES !== null ? <SpecimenWorkbench /> : <AquariumApp />
}
