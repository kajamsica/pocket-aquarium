import { useCallback, useEffect, useRef, useState } from 'react'
import { intentForView } from './App'
import { publicWorldV13ViewProjection } from './PublicV13WorldView'
import { createPublicSaveScheduler } from './publicSaveScheduler'
import { streamedControlIntents } from './StreamedPreviewApp'
import type { createAtomicV13Store } from './domain/atomicV13Database'
import { selectPublicV13BuildPreview } from './domain/publicV13BuildPreview'
import { PUBLIC_V11_BOOTS_LISTING_ID, publicV11Gait } from './domain/publicWorldGait'
import { createPublicV13ContinuousSession } from './domain/publicWorldV13ContinuousSession'
import { commitPublicV13BootPurchase, commitPublicV13Snapshot,
  commitPublicV13TerrainWork, inspectPublicV13 } from './domain/publicWorldV13Flow'
import type { PublicV13Operation, PublicV13Start } from './domain/publicWorldV13Flow'
import { publicV13GreenwayWitness } from './domain/publicWorldV13GreenwayFrame'
import { serializePublicV13Rescue } from './domain/publicWorldV13Rescue'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import type { PublicV7LockProvider } from './domain/publicWorldV7Flow'
import type { createPublicV13SourceReader } from './domain/publicWorldV13SourceReader'
import { enumerateTerrainWorkSites } from './domain/terrainWorks'
import type { TerrainWorkSite, TerrainWorkWindow } from './domain/terrainWorks'
import type { PlayerState } from './domain/types'
import { WORLD_CELL_METERS } from './domain/worldChunks'
import { WizardSurface } from './view/WizardSurface'
import type { WizardViewIntent } from './view/contracts'
import { createFixedInputClock, createTimedMovementSampler, recordTimedMovement,
  sampleFixedInputBatch } from './view/timedInput'

type State = PublicV13Start['state']
type Purchase = { start: PublicV13Start; event: { type: string } }
type Writers = Readonly<{
  save: (state: State, revision: number, source: PublicV13Start['sourceLineage']) => Promise<PublicV13Operation<PublicV13Start>>
  boots: (id: string, revision: number, source: PublicV13Start['sourceLineage']) => Promise<PublicV13Operation<Purchase>>
  work: (id: string, revision: number, source: PublicV13Start['sourceLineage']) => Promise<PublicV13Operation<Purchase>>
}>
type Gate = 'open' | 'barrier' | 'blocked'
type Outcome = 'saved' | 'unchanged' | 'rejected' | 'blocked' | 'busy'
const bootRules = new Set(['Leather boots are sold only at Greenway Outfitters.',
  'Move closer to Greenway Outfitters.', 'You already own leather boots.',
  'Not enough coins for leather boots.', 'The backpack is full.'])
const workRules = new Set(['unavailable_here', 'invalid_site', 'undiscovered', 'too_far',
  'already_done', 'occupied', 'limit_reached', 'not_owned', 'requires_spade', 'capacity'])

export function publicV13WalkRequestedAfterFrame(walkRequested: boolean,
  events: readonly { type: string; slot?: string }[]): boolean {
  return events.some((event) => (event.type === 'item_equipped' || event.type === 'item_unequipped')
    && event.slot === 'feet') ? false : walkRequested
}

/** Testable unmounted controller core. The mounted component binds only checked Flow writers. */
export function createPublicV13ControllerRuntime(initial: PublicV13Start, writers: Writers,
  changed: () => void = () => {}, rebaseInput: () => void = () => {}) {
  let committedStart = structuredClone(initial)
  let facade = createPublicV13ContinuousSession(committedStart)
  let dirtyGeneration = 0
  let writeGate: Gate = 'open'
  let blockedReason: string | null = null
  let rescueBytes: string | null = null
  let notice = 'Continuous v13 preview. Progress stays on this device.'
  let writeSucceeded = false
  const tell = (message: string) => { notice = message; changed() }
  const freeze = (reason: string, candidate: State | null) => {
    writeGate = 'blocked'; blockedReason = reason
    try { rescueBytes = serializePublicV13Rescue(committedStart,
      candidate && candidate.tick > committedStart.state.tick ? structuredClone(candidate) : null) }
    catch { rescueBytes = null }
    rebaseInput(); tell(`Save blocked (${reason}). Movement is frozen; download rescue before changing this tab.`)
  }
  const scheduler = createPublicSaveScheduler<State>(async ({ snapshot }) => {
    writeSucceeded = false
    try {
      const result = await writers.save(snapshot, committedStart.saveRevision, committedStart.sourceLineage)
      if (!result.ok) { freeze(result.reason, snapshot); return false }
      const next = createPublicV13ContinuousSession(result.value)
      committedStart = structuredClone(result.value); facade = next; dirtyGeneration = 0
      writeSucceeded = true; changed(); return true
    } catch { freeze('storage-error', snapshot); return false }
  })
  const checkpoint = async (candidate: State): Promise<boolean> => {
    if (!dirtyGeneration) return true
    writeSucceeded = false
    scheduler.enqueue({ snapshot: candidate, manual: true,
      queuedDuringManual: false, savedTravelVersion: dirtyGeneration })
    await scheduler.whenIdle()
    return writeSucceeded
  }
  const transaction = async (kind: 'save' | 'boots' | 'work', id = ''): Promise<Outcome> => {
    if (writeGate !== 'open') return writeGate === 'blocked' ? 'blocked' : 'busy'
    writeGate = 'barrier'; rebaseInput(); changed()
    await scheduler.whenIdle()
    if (blockedReason !== null) return 'blocked'
    let candidate: State
    try { candidate = facade.snapshotForSave() }
    catch { freeze('invalid-state', null); return 'blocked' }
    const hadDirty = dirtyGeneration > 0
    if (!await checkpoint(candidate)) {
      if (blockedReason === null) freeze('save-not-confirmed', candidate)
      return 'blocked'
    }
    if (kind === 'save') {
      writeGate = 'open'; rebaseInput()
      tell(dirtyGeneration ? 'Save incomplete.' : 'Public v13 progress saved on this device.')
      return hadDirty ? 'saved' : 'unchanged'
    }
    try {
      const result = kind === 'boots'
        ? await writers.boots(id, committedStart.saveRevision, committedStart.sourceLineage)
        : await writers.work(id, committedStart.saveRevision, committedStart.sourceLineage)
      if (!result.ok) {
        if ((kind === 'boots' ? bootRules : workRules).has(result.reason)) {
          writeGate = 'open'; rebaseInput(); tell(result.reason); return 'rejected'
        }
        freeze(result.reason, null); return 'blocked'
      }
      const next = createPublicV13ContinuousSession(result.value.start)
      committedStart = structuredClone(result.value.start); facade = next
      writeGate = 'open'; dirtyGeneration = 0; rebaseInput()
      tell(kind === 'boots' ? 'Leather boots bought and saved.' : 'Terrain work saved.')
      return 'saved'
    } catch { freeze('storage-error', null); return 'blocked' }
  }
  return {
    view: () => facade.view(), snapshotForView: () => facade.previewSnapshot(),
    status: () => ({ gate: writeGate, blockedReason, rescueBytes, notice,
      saveRevision: committedStart.saveRevision, dirtyGeneration }),
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean) {
      if (writeGate !== 'open') return { events: [], rejections: [{ intentIndex: 0,
        intentType: intents[0]?.type ?? 'move', code: 'unavailable_here' as const,
        message: 'Fixed frames are paused for a save or recovery.' }] }
      const beforeTick = facade.view().tick
      const result = facade.advanceFrame(intents, { walkRequested })
      if (result.rejections.length) tell(result.rejections.at(-1)!.message)
      else if (facade.view().tick !== beforeTick) { dirtyGeneration++; changed() }
      return result
    },
    save: () => transaction('save'), buyBoots: (storeId: string) => transaction('boots', storeId),
    buildWork: (siteId: string) => transaction('work', siteId),
  }
}

export interface PublicV13ControllerProps {
  start: PublicV13Start
  locks: PublicV7LockProvider | undefined
  reader: ReturnType<typeof createPublicV13SourceReader>
  store: ReturnType<typeof createAtomicV13Store>
}
type WorkKind = TerrainWorkSite['kind']
const STEP_MS = 50
const MAX_CATCH_UP = 12

/** Recheck the visible aim against the live pose before sending an ID to the writer. */
export function publicV13WorkIntentStillReady(state: State, kind: WorkKind,
  window: TerrainWorkWindow, sites: readonly TerrainWorkSite[], requestedId: string): boolean {
  const aimed = selectPublicV13BuildPreview(state, window, sites, kind, state.player.yaw).selected
  return aimed?.site.id === requestedId && aimed.rejection === null
}

/** Deliberately unmounted until the explicit entry and browser proof pass. */
export function PublicV13Controller({ start, locks, reader, store }: PublicV13ControllerProps) {
  const [, redraw] = useState(0)
  const [messages, setMessages] = useState<string[]>([])
  const [walkRequested, setWalkRequested] = useState(false)
  const [openStoreId, setOpenStoreId] = useState<string | null>(null)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [workMode, setWorkMode] = useState(false)
  const [workKind, setWorkKind] = useState<WorkKind>('bridge')
  const workModeRef = useRef(false)
  const workKindRef = useRef<WorkKind>('bridge')
  const [inspection, setInspection] = useState<string | null>(null)
  const input = useRef(createTimedMovementSampler(performance.now()))
  const clock = useRef(createFixedInputClock(input.current.cursorMs))
  const held = useRef<readonly [number, number]>([0, 0])
  const lastAutoSaveMs = useRef(performance.now())
  const workCache = useRef<{ key: string; window: TerrainWorkWindow;
    sites: readonly TerrainWorkSite[] } | null>(null)
  const rebase = () => {
    const now = performance.now()
    input.current = createTimedMovementSampler(now)
    clock.current = createFixedInputClock(now)
    recordTimedMovement(input.current, now, held.current)
  }
  const runtime = useRef<ReturnType<typeof createPublicV13ControllerRuntime> | null>(null)
  runtime.current ??= createPublicV13ControllerRuntime(start, {
    save: (state, revision, source) => commitPublicV13Snapshot(locks, reader, store, state, revision, source),
    boots: (id, revision, source) => commitPublicV13BootPurchase(locks, reader, store, id, revision, source),
    work: (id, revision, source) => commitPublicV13TerrainWork(locks, reader, store, id, revision, source),
  }, () => {
    if (runtime.current?.status().gate !== 'open') {
      workModeRef.current = false
      setWorkMode(false)
    }
    redraw((version) => version + 1)
  }, rebase)
  const controller = runtime.current
  const state = controller.snapshotForView(), active = controller.view(), status = controller.status()
  const streamed = active.movementOwner === 'streamed'
  const modeActive = workMode && streamed && status.gate === 'open'
  useEffect(() => {
    if (!streamed || status.gate !== 'open') {
      workModeRef.current = false
      setWorkMode(false)
    }
  }, [streamed, status.gate])
  const currentWorkPreviewInput = (current: State, kind: WorkKind) => {
    const gx = Math.floor(current.player.position.x / WORLD_CELL_METERS)
    const gz = Math.floor(current.player.position.z / WORLD_CELL_METERS)
    const window = { minGX: gx - 7, maxGX: gx + 8, minGZ: gz - 7, maxGZ: gz + 8 }
    const key = `${window.minGX}:${window.minGZ}`
    if (workCache.current?.key !== key) workCache.current = { key, window,
      sites: enumerateTerrainWorkSites(current.seed, window) }
    return { window: workCache.current.window, sites: workCache.current.sites,
      kind, bodyYaw: current.player.yaw }
  }
  let workPreview: { window: TerrainWorkWindow; sites: readonly TerrainWorkSite[];
    kind: WorkKind; bodyYaw: number } | undefined
  if (modeActive) workPreview = currentWorkPreviewInput(state, workKind)
  const base = publicWorldV13ViewProjection(state, active, messages, selectedSiteId,
    openStoreId, workPreview)
  const projection = { ...base,
    gait: publicV11Gait(state.player.equipment.feet, walkRequested),
    controllerActionsEnabled: status.gate === 'open',
    ...(streamed ? { unavailableActions: true as const,
      streamedSpellAvailable: status.gate === 'open' && state.player.learnedSpellIds.includes('wayfinder_glow'),
      highlandExtraction: undefined, stores: [], nearbyStoreId: null, openStoreId: null } : {}),
    savedTerrainWorks: { ...base.savedTerrainWorks, selectedKind: workKind, modeActive,
      actionsEnabled: streamed && status.gate === 'open' } }
  const inform = (message: string) => setMessages((current) => [...current.slice(-2), message])
  const frame = (intents: readonly PublicWorldIntent[]) => {
    const result = controller.advanceFrame(intents, walkRequested)
    const nextWalkRequested = publicV13WalkRequestedAfterFrame(walkRequested, result.events)
    if (nextWalkRequested !== walkRequested) setWalkRequested(nextWalkRequested)
    if (result.rejections.length) inform(result.rejections.at(-1)!.message)
    else if (result.events.length) inform(result.events.at(-1)!.type.replaceAll('_', ' '))
  }
  const controls = (vector: readonly [number, number]) => {
    const shown = controller.snapshotForView().player
    const gait = publicV11Gait(shown.equipment.feet, walkRequested)
    return streamedControlIntents(shown.yaw, vector, gait.metersPerStep) as PublicWorldIntent[]
  }
  const sampleFrame = useRef<(vector: readonly [number, number]) => void>(() => {})
  sampleFrame.current = (vector) => frame(controls(vector))
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (controller.status().gate !== 'open') return
      const now = performance.now()
      if (controller.status().dirtyGeneration > 0 && now - lastAutoSaveMs.current >= 5_000) {
        lastAutoSaveMs.current = now
        void controller.save()
        return
      }
      for (const vector of sampleFixedInputBatch(input.current, clock.current,
        now, STEP_MS, MAX_CATCH_UP)) sampleFrame.current(vector)
    }, STEP_MS)
    return () => window.clearInterval(timer)
  }, [controller])
  const onIntent = useCallback((intent: WizardViewIntent) => {
    if (intent.type === 'movement') {
      held.current = intent.vector
      if (controller.status().gate === 'open') recordTimedMovement(input.current,
        intent.atMs ?? performance.now(), intent.vector)
      return
    }
    if (intent.type === 'saved-work.mode') {
      if (!intent.active) { workModeRef.current = false; setWorkMode(false) }
      else if (controller.view().movementOwner === 'streamed' && controller.status().gate === 'open') {
        workModeRef.current = true; setWorkMode(true)
      }
      return
    }
    if (controller.status().gate !== 'open') return
    if (intent.type === 'movement.tap') { frame(controls(intent.vector)); return }
    if (intent.type === 'gait.toggle') { if (projection.gait?.canRun) setWalkRequested(!walkRequested); return }
    if (intent.type === 'saved-work.kind' && workModeRef.current) {
      workKindRef.current = intent.kind; setWorkKind(intent.kind); return
    }
    if (intent.type === 'saved-work.confirm') {
      if (workModeRef.current && controller.view().movementOwner === 'streamed') {
        const current = controller.snapshotForView()
        const input = currentWorkPreviewInput(current, workKindRef.current)
        if (publicV13WorkIntentStillReady(current, input.kind, input.window, input.sites, intent.id)) {
          void controller.buildWork(intent.id)
          return
        }
      }
      inform('Aim at a ready, discovered work site first.')
      return
    }
    if (streamed) {
      if (intent.type === 'jump') frame([{ type: 'jump' }])
      else if (intent.type === 'spell.cast' && intent.spellId === 'wayfinder_glow')
        frame([{ type: 'cast_spell', spellId: intent.spellId }])
      else inform('This action is unavailable on streamed terrain.')
      return
    }
    if (intent.type === 'store.close') { setOpenStoreId(null); return }
    if (intent.type === 'store.open') {
      if (projection.nearbyStoreId === intent.storeId) setOpenStoreId(intent.storeId)
      return
    }
    if (intent.type === 'interact' && projection.nearbyInteraction?.kind === 'store'
      && projection.nearbyStoreId) { setOpenStoreId(projection.nearbyStoreId); return }
    if (intent.type === 'build-site.select') { setSelectedSiteId(intent.siteId); return }
    if (intent.type === 'store.select-listing' && intent.listingId === PUBLIC_V11_BOOTS_LISTING_ID) {
      void controller.buyBoots(intent.storeId); return
    }
    const witness = publicV13GreenwayWitness(controller.snapshotForView(), [])
    const greenway = { ...witness.greenway, seed: witness.seed,
      generationProfile: witness.generationProfile, tick: witness.tick,
      rng: witness.rng, eventSequence: witness.eventSequence,
      player: witness.player as PlayerState, discoveredTileIds: [...witness.discoveredTileIds] }
    const mapped = intentForView(greenway, intent, openStoreId)
    if (mapped) frame([mapped])
    else inform('This action is unavailable in the continuous v13 preview.')
  }, [controller, streamed, projection, openStoreId, walkRequested])
  const download = () => {
    if (!status.rescueBytes) return
    const url = URL.createObjectURL(new Blob([status.rescueBytes], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'wizard-realms-v13-rescue.json'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  return <main data-public-v13="true" data-owner={active.movementOwner}
    style={{ position: 'relative', width: '100%', height: '100%' }}>
    <WizardSurface projection={projection} onIntent={onIntent} />
    <aside style={{ position: 'absolute', top: 8, left: 8, zIndex: 20,
      padding: 8, background: '#101a17ee', color: '#fff', borderRadius: 8 }}>
      <button type="button" disabled={status.gate !== 'open'} onClick={() => void controller.save()}>Save</button>
      <span role="status" style={{ marginLeft: 8 }}>{status.notice}</span>
      {status.gate === 'blocked' && <div>
        <button type="button" disabled={!status.rescueBytes} onClick={download}>Download validated rescue</button>
        <button type="button" onClick={() => void inspectPublicV13(locks, reader, store)
          .then((result) => setInspection(result.ok ? result.value.status : result.reason))
          .catch(() => setInspection('storage-error'))}>
          Reinspect saved state
        </button>
        {inspection && <span role="status">Inspection: {inspection}. This tab remains frozen.</span>}
      </div>}
    </aside>
  </main>
}
