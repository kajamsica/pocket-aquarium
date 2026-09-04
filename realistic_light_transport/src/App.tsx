import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ReefRenderSettings, ReefRenderTelemetry } from './contracts'
import {
  advancePocketState,
  advancePocketStateDevSafe,
  createPocketNewGame,
  createPocketReefShowcase,
  devSafeSaveKey,
  dispatchPocketAction,
  isDevSafeActive,
  pocketActions,
  pocketSaveKey,
  projectPocketState,
  restorePocketGame,
  restorePocketGameDevSafe,
  serializePocketGame,
  type PocketPreventedDeath,
  type PocketState,
} from './integration/pocketAquariumBridge'
import { ReefScene } from './scene/ReefScene'
import type { CoralPlacementCandidate } from './scene/CoralPlacement'
import { FeedingProvider, type FeedingApi } from './scene/feeding'
import { createAcceptedShowcaseCatalog, SpecimenRosterProvider } from './scene/SpecimenFish'
import { PocketGameHUD } from './ui/PocketGameHUD'
import { CoralInventoryTray } from './ui/CoralInventoryTray'
import { SpecimenWorkbench } from './workbench/SpecimenWorkbench'

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
const GOD_MODE_KEY = `${devSafeSaveKey}:god-mode`
const MAX_PREVENTED = 20
const ACCEPTED_SHOWCASE_CATALOG = SHOWCASE_MODE ? createAcceptedShowcaseCatalog() : undefined

/** The dev shell's persisted God Mode preference. Protection defaults on and only an explicit
 *  opt-out disables it, and the toggle writes this key synchronously, so this is the live answer.
 *  Component initialization and saved-state restore both read it here, so they cannot disagree
 *  about whether protection is active. Outside the dev shell the value is unused: every caller
 *  gates on `DEV_SAFE` first, so production keeps taking the unmodified simulator. */
function godModePreferred() {
  if (!DEV_SAFE) return true
  try { return window.localStorage.getItem(GOD_MODE_KEY) !== '0' } catch { return true }
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
 * overwriting; a player action always writes, one above whatever is stored, and so becomes
 * authoritative immediately. Wall-clock stamps cannot do this job — every view stamps
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

/** True when storage holds a save this view has not accounted for. An unsequenced save is only
 *  safe to overwrite while it is still the exact bytes this view read or wrote. */
function holdsNewerSave(record: SaveRecord) {
  return record.seq === null ? record.raw !== seenRaw : record.seq > seenSeq
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

/** The one local save writer: showcase stays nonpersistent and storage stays optional. Callers pass
 *  the record they just read so the new sequence clears both this view's and storage's high mark. */
function persistPocketState(state: PocketState, record: SaveRecord | null) {
  if (SHOWCASE_MODE) return
  const stamped = { ...state, saveSeq: Math.max(record?.seq ?? 0, seenSeq) + 1 }
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
  const [pocketState, setPocketState] = useState(() => {
    if (SHOWCASE_MODE) return createPocketReefShowcase()
    try {
      const record = readSaveRecord()
      return record ? restoreSaveRecord(record) : createPocketNewGame()
    } catch {
      return createPocketNewGame()
    }
  })
  const pocketStateRef = useRef(pocketState)
  const [prevented, setPrevented] = useState<readonly PocketPreventedDeath[]>([])
  // Death protection defaults on inside the gated dev shell; toggling only changes future ticks
  // and persists as a dev-only preference, so a deliberate opt-out survives a refresh.
  const [protectionOn, setProtectionOn] = useState(godModePreferred)
  const protectionRef = useRef(protectionOn)
  protectionRef.current = protectionOn
  const [renderSettings, setRenderSettings] = useState(DEFAULT_RENDER_SETTINGS)
  const [renderTelemetry, setRenderTelemetry] = useState<ReefRenderTelemetry>()
  const [activeCoralId, setActiveCoralId] = useState<number | null>(null)
  const [previewCandidate, setPreviewCandidate] = useState<CoralPlacementCandidate | null>(null)
  const lastTelemetryUpdate = useRef(0)
  const godModeOn = DEV_SAFE && protectionOn
  const view = projectPocketState(pocketState, { godMode: godModeOn })
  const activeCoral = view.coralInventory.find((coral) => coral.id === activeCoralId)
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

  // Adopting a newer save replaces this view's state wholesale — the record is the whole aquarium —
  // and the ref moves with it so the next tick advances the adopted state instead of the old one.
  const adoptSave = useCallback((record: SaveRecord) => {
    const next = restoreSaveRecord(record)
    pocketStateRef.current = next
    setPocketState(next)
  }, [])

  useEffect(() => {
    if (SHOWCASE_MODE) return
    // Crash/offline coverage only: player actions already persisted themselves at dispatch time,
    // so this stays a one-second sweep for simulation ticks rather than a per-tick write. The sweep
    // reads before it writes, so a view whose state is behind the stored save adopts it rather than
    // rolling a newer action back — the durable guard even when a `storage` event never arrives.
    const save = () => {
      const record = readSaveRecord()
      if (record && holdsNewerSave(record)) { adoptSave(record); return }
      persistPocketState(pocketStateRef.current, record)
    }
    const timer = window.setInterval(save, 1000)
    window.addEventListener('pagehide', save)
    // Any other same-origin view of this key (second tab, device preview) adopts a newer save the
    // moment it lands, so one view's action shows up in the others without a reload. Adopt-only:
    // answering a peer's write with a write of our own would ping-pong between views.
    const adoptPeerWrite = (event: StorageEvent) => {
      if (event.key !== SAVE_KEY) return
      const record = readSaveRecord()
      if (record && holdsNewerSave(record)) adoptSave(record)
    }
    window.addEventListener('storage', adoptPeerWrite)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', save)
      window.removeEventListener('storage', adoptPeerWrite)
    }
  }, [adoptSave])

  useEffect(() => {
    const tray = document.querySelector<HTMLDetailsElement>('.coral-tray-disclosure')
    if (!tray) return
    const mobile = window.matchMedia('(max-width: 860px)')
    const syncTray = () => { tray.open = !mobile.matches }
    syncTray()
    mobile.addEventListener('change', syncTray)
    return () => mobile.removeEventListener('change', syncTray)
  }, [view.coralInventory.length])

  // A completed player action commits as one immediate unit: the ref, React state, and the active
  // save key all take the exact resulting state before control returns to the browser, so a reload
  // or background transition inside the one-second save window cannot erase it. Accepted and
  // rejected actions commit identically — a rejection's log is the state it produced. Applying the
  // action here rather than inside a state updater also keeps Strict Mode, which double-invokes
  // updaters, from executing the same gameplay action twice.
  const dispatch = useCallback((action: Parameters<typeof dispatchPocketAction>[1]) => {
    const current = pocketStateRef.current
    // God mode: apply the action with unlimited credits and the root's purchase gates bypassed —
    // the same bypass the Store used to paint every offer purchasable, so an enabled button is
    // never refused — then restore the real dev-save balance so purchases/refills are free. Real
    // milestone rewards earned by the action still accrue, so toggling God mode off cannot erase
    // a keeper-rank payout.
    let next: PocketState
    if (DEV_SAFE && protectionRef.current) {
      next = dispatchPocketAction({ ...current, credits: Number.MAX_SAFE_INTEGER }, action, { godMode: true })
      next.credits = current.credits + earnedCreditsIn(next.log.slice(current.log.length))
    } else {
      next = dispatchPocketAction(current, action)
    }
    pocketStateRef.current = next
    // Unguarded on purpose: the action was taken on what this view showed, so it wins over whatever
    // is stored and lands one sequence above it, where every other view will adopt it.
    persistPocketState(next, readSaveRecord())
    setPocketState(next)
  }, [])

  const godMode = useMemo(() => DEV_SAFE ? {
    on: protectionOn,
    prevented,
    toggle: () => {
      const next = !protectionOn
      setProtectionOn(next)
      try { window.localStorage.setItem(GOD_MODE_KEY, next ? '1' : '0') } catch { /* storage is optional */ }
    },
  } : undefined, [prevented, protectionOn])

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
    setPreviewCandidate(null)
  }, [])
  const cancelCoral = useCallback(() => {
    setActiveCoralId(null)
    setPreviewCandidate(null)
  }, [])
  const lockCoral = useCallback(() => {
    if (!activeCoral || !previewCandidate?.valid) return
    dispatch({ type: pocketActions.LOCK_CORAL_PLACEMENT, coralId: activeCoral.id,
      placement: previewCandidate.placement })
    setActiveCoralId(null)
    setPreviewCandidate(null)
  }, [activeCoral, dispatch, previewCandidate])
  const candidateStatus = previewCandidate ? {
    valid: previewCandidate.valid,
    message: previewCandidate.valid ? 'Valid placement. Select Lock here to confirm.'
      : `Choose another position (${previewCandidate.reason ?? 'invalid surface'}).`,
  } : null

  return (
    <main className="reef-app pocket-reef-app">
      <FeedingProvider value={feeding}>
        <SpecimenRosterProvider specimens={view.specimens} showcaseCatalog={ACCEPTED_SHOWCASE_CATALOG}
          dispatch={SHOWCASE_MODE ? undefined : dispatch}>
          <ReefScene
            snapshot={view.reefSnapshot}
            renderSettings={renderSettings}
            onRenderTelemetry={updateRenderTelemetry}
            placedCorals={view.placedCorals}
            activeCoral={activeCoral}
            previewCandidate={previewCandidate}
            onPlacementCandidate={setPreviewCandidate}
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
      />
      <CoralInventoryTray inventory={view.coralInventory} activeId={activeCoralId}
        candidate={candidateStatus} onArm={armCoral} onPointerArm={(coralId) => armCoral(coralId)}
        onCancel={cancelCoral} onLock={lockCoral} />
    </main>
  )
}

export default function App() {
  // Any ?workbench=<catalog-id> opens the workbench; unknown ids fall back visibly to Ocellaris inside it.
  return WORKBENCH_SPECIES !== null ? <SpecimenWorkbench /> : <AquariumApp />
}
