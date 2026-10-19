import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { publicWorldV16TileAtGrid } from './domain/publicWorldV16GreenwaySites'
import { createPublicV23StreamTerrain, resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { decodePublicV14FrameWitness, PUBLIC_V14_MAX_FRAME_BATCH } from './domain/publicWorldV14Snapshot'
import type { PublicV14Frame } from './domain/publicWorldV14Snapshot'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './domain/publicWorldRuntime'
import type { PublicMireglassEvent } from './domain/publicWorldActions'
import type { PublicV23Operation, PublicV23Start } from './domain/publicWorldV23Flow'
import type { PublicV23Progress, PublicV23Witness } from './domain/publicWorldV23Snapshot'
import { applyPublicV23Witness, previewPublicV23Frames } from './domain/publicWorldV23Transitions'
import { applyPublicV24MireglassAction } from './domain/publicWorldV24MireglassAction'
import type { PublicV24Operation, PublicV24Start } from './domain/publicWorldV24Flow'
import type { PublicV24Witness } from './domain/publicWorldV24Snapshot'
import type { PublicV25Operation, PublicV25Start } from './domain/publicWorldV25Flow'
import { publicV25RiverPassage } from './domain/publicWorldV25Passage'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { publicV17StarterPoseValid } from './domain/publicWorldV17StarterMovement'
import { resolvePublicV23Site } from './domain/publicWorldV23Sites'
import { resolveTerrainWorkSite } from './domain/terrainWorks'
import { HERB_CYCLE_TICKS } from './domain/mireglassHerbForaging'

type Gate = 'open' | 'checkpointing' | 'barrier' | 'blocked'
export type PublicV23ControllerOutcome<Event extends { type: string } = PublicWorldEvent> =
  | { status: 'saved'; events: readonly Event[]; resetWalkRequested: boolean;
      workEvent?: { id: string; kind: 'bridge' | 'ladder' | 'dig';
        logsSpent: number; stoneGained: number; xp: number } }
  | { status: 'unchanged' | 'deferred-airborne' | 'busy' }
  | { status: 'rejected' | 'blocked'; reason: string }
type Writer = (revision: number, lineage: PublicV23Start['lineage'],
  witness: PublicV23Witness) => Promise<PublicV23Operation<PublicV23Start>>
type V24Writer = (revision: number, lineage: PublicV24Start['lineage'],
  witness: PublicV24Witness) => Promise<PublicV24Operation<PublicV24Start>>
type V25Writer = (revision: number, lineage: PublicV25Start['lineage'],
  witness: PublicV24Witness) => Promise<PublicV25Operation<PublicV25Start>>
type CheckedStart = Readonly<{ head: PublicV23Progress & Readonly<{ saveRevision: number }>;
  lineage: unknown }>
type BaseAction = Exclude<PublicV23Witness, { kind: 'frame-batch/v1' } | { kind: 'checkpoint' }>
type MireglassWitness = Extract<PublicV24Witness, { kind: 'mireglass-action/v1' }>
type Applied<Event extends { type: string }> =
  | { progress: PublicV23Progress; events: readonly Event[] }
  | { rejection: string }
export type PublicV24SavePhase = Readonly<{ phase: 'witness-decode' | 'local-frame-replay'
  | 'writer-await' | 'reply-check-clone'; durationMs: number; pendingFrames: number }>
const progress = (start: CheckedStart): PublicV23Progress => ({ state: start.head.state,
  greenwayWorks: start.head.greenwayWorks, regionalWorks: start.head.regionalWorks })
const feetChanged = (events: readonly { type: string; slot?: unknown }[]) => events.some((event) =>
  (event.type === 'item_equipped' || event.type === 'item_unequipped') && event.slot === 'feet')
const itemCount = (value: PublicV23Progress, id: string) => value.state.player.inventory
  .filter((stack) => stack.itemId === id).reduce((count, stack) => count + stack.quantity, 0)

/** Local frames are replayed from the last grounded head; only checked writer replies advance it. */
function createControllerRuntime<Start extends CheckedStart,
  Extra extends MireglassWitness = never, Event extends { type: string } = never>(
  initial: Start,
  write: (revision: number, lineage: Start['lineage'], witness: PublicV23Witness | Extra) =>
    Promise<{ ok: true; value: Start } | { ok: false; reason: string }>,
  extraAction?: (before: PublicV23Progress, witness: Extra) => Applied<Event>,
  onSavePhase?: (sample: PublicV24SavePhase) => void,
  passage?: typeof publicV25RiverPassage) {
  let committed = structuredClone(initial)
  let preview = progress(committed)
  let pending: PublicV14Frame[] = []
  let gate: Gate = 'open'
  let blockedReason: string | null = null
  let idleCheck: { preview: PublicV23Progress; needed: boolean } | null = null
  const reportPhase = (phase: PublicV24SavePhase['phase'], startedAt: number,
    frameCount: number) => {
    if (!onSavePhase || !frameCount) return
    try { onSavePhase({ phase, durationMs: performance.now() - startedAt,
      pendingFrames: frameCount }) } catch { /* Diagnostics must not affect checked saves. */ }
  }
  const freeze = (reason: string): PublicV23ControllerOutcome<PublicWorldEvent | Event> => {
    gate = 'blocked'; blockedReason = reason
    return { status: 'blocked', reason }
  }
  const checkedWrite = async (witness: PublicV23Witness | Extra,
    expected: PublicV23Progress): Promise<PublicV23ControllerOutcome<PublicWorldEvent | Event>> => {
    const revision = committed.head.saveRevision
    const frameCount = witness.kind === 'frame-batch/v1' ? witness.frames.length : 0
    const writerStartedAt = onSavePhase && frameCount ? performance.now() : 0
    let response: { ok: true; value: Start } | { ok: false; reason: string }
    try { response = await write(revision, structuredClone(committed.lineage), witness) }
    catch { return freeze('storage-error') }
    finally { reportPhase('writer-await', writerStartedAt, frameCount) }
    const replyStartedAt = onSavePhase && frameCount ? performance.now() : 0
    try {
      if (!response.ok) return freeze(response.reason)
      if (response.value.head.saveRevision !== revision + 1
        || !samePublicV14Value(response.value.lineage, committed.lineage)
        || !samePublicV14Value(progress(response.value), expected)) return freeze('writer-mismatch')
      committed = structuredClone(response.value)
      preview = progress(committed)
      pending = []
      return { status: 'saved', events: [], resetWalkRequested: false }
    } finally { reportPhase('reply-check-clone', replyStartedAt, frameCount) }
  }
  const flush = async (): Promise<PublicV23ControllerOutcome<PublicWorldEvent | Event>> => {
    if (!pending.length) return { status: 'unchanged' }
    if (preview.state.player.verticalVelocity !== 0) return { status: 'deferred-airborne' }
    const frameCount = pending.length
    const decodeStartedAt = onSavePhase ? performance.now() : 0
    const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames: pending })
    reportPhase('witness-decode', decodeStartedAt, frameCount)
    if (!witness) return freeze('invalid-frame-batch')
    const replayStartedAt = onSavePhase ? performance.now() : 0
    const expected = applyPublicV23Witness(progress(committed), witness)
    reportPhase('local-frame-replay', replayStartedAt, frameCount)
    if ('rejection' in expected) return freeze(expected.rejection)
    const result = await checkedWrite(witness, expected.progress)
    return result.status === 'saved' ? { ...result, events: expected.events } : result
  }
  const rejectFrame = (intents: readonly PublicWorldIntent[], code: PublicWorldRejection['code'],
    message: string) => ({ events: [] as readonly PublicWorldEvent[], rejections: [{ intentIndex: 0,
      intentType: intents[0]?.type ?? 'move', code, message }] as readonly PublicWorldRejection[] })
  return {
    committed: () => structuredClone(committed),
    preview: () => structuredClone(preview),
    view() {
      const state = preview.state
      const activeTiles = state.movementOwner === 'greenway' ? state.greenway.tiles.map((tile) =>
        publicWorldV16TileAtGrid(state.seed, tile.center.x / 4, tile.center.z / 4))
        : createPublicV23StreamTerrain(state, preview.regionalWorks.builtLadderIds).activeTiles()
      return { movementOwner: state.movementOwner, tick: state.tick,
        player: structuredClone(state.player), activeTiles: structuredClone(activeTiles),
        activeKnownTileIds: discoveredTileIdsInActiveWindow(state.discoveryMask,
          state.player.position), pendingBoundary: false }
    },
    status: () => ({ gate: gate === 'open' && pending.length >= PUBLIC_V14_MAX_FRAME_BATCH
      ? 'cap-paused' as const : gate, blockedReason,
    saveRevision: committed.head.saveRevision, pendingFrames: pending.length,
    checkpointRecommended: pending.length >= 64,
    checkpointRequired: pending.length >= PUBLIC_V14_MAX_FRAME_BATCH }),
    /** Future clock-driven systems must be added here before an empty frame can be omitted. */
    idleFrameNeeded() {
      if (gate !== 'open') return true
      if (idleCheck?.preview === preview) return idleCheck.needed
      let needed = true
      try {
        const { state, greenwayWorks, regionalWorks } = preview
        const { player, tick } = state
        if (!Number.isSafeInteger(tick) || tick < 0 || !Number.isSafeInteger(tick + 1)
          || !player.tradeSlots.every((slot) => slot.itemId === null
            && slot.quantity === 0 && slot.unitPrice === 0)
          || !state.mireglass.herbHarvestCycles.every((entry) =>
            entry.cycle < Math.floor(tick / HERB_CYCLE_TICKS))
          || !state.highland.stoneNodes.every((node) => node.readyAtTick <= tick)
          || !Number.isSafeInteger(state.windstep.activeUntilTick)
          || !Number.isSafeInteger(state.windstep.nextCastTick)
          || state.windstep.activeUntilTick > tick || state.windstep.nextCastTick > tick) {
          idleCheck = { preview, needed: true }
          return true
        }
        const surface = state.movementOwner === 'streamed'
          ? resolvePublicV23Surface(state, player.position, regionalWorks.builtLadderIds) : null
        const grounded = state.movementOwner === 'greenway'
          ? publicV17StarterPoseValid({ seed: state.seed, profile: state.generationProfile,
            route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
            built: state.greenway.builtRouteIds.includes('greenway_ladder'), greenwayWorks },
          player.position, player.verticalVelocity)
          : !!surface && player.verticalVelocity === 0
            && Math.abs(player.position.y - surface.floorY) <= 1e-6
        needed = !grounded
      } catch { /* Unknown state keeps the authoritative clock running. */ }
      idleCheck = { preview, needed }
      return needed
    },
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean) {
      if (gate !== 'open') return rejectFrame(intents, 'unavailable_here',
        'Movement is paused for a checked write.')
      if (pending.length >= PUBLIC_V14_MAX_FRAME_BATCH) return rejectFrame(intents,
        'unavailable_here', 'Checkpoint the recorded frames before moving.')
      const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1',
        frames: [{ intents, walkRequested }] })
      if (!witness) return rejectFrame(intents, 'invalid_frame', 'Invalid replayable frame.')
      const candidate = [...pending, witness.frames[0]]
      const local = preview.state.player.verticalVelocity === 0
        ? previewPublicV23Frames(preview, witness.frames, true) : null
      const replay = local?.progress ? local
        : previewPublicV23Frames(progress(committed), candidate, true)
      if (!replay.progress) {
        return replay.rejection && replay.rejectedFrameIndex === candidate.length - 1
          ? { events: [] as readonly PublicWorldEvent[],
              rejections: [replay.rejection] as readonly PublicWorldRejection[] }
          : rejectFrame(intents, 'terrain_missing', 'No supported move at this position.')
      }
      const crossing = passage?.(preview, preview.state.player.position,
        replay.progress.state.player.position)
      if (crossing && !crossing.ok) return rejectFrame(intents, 'terrain_missing',
        crossing.reason === 'river-needs-bridge'
          ? 'River crossing blocked. Build a bridge to cross.'
          : 'This move cannot be replayed safely.')
      pending = candidate; preview = replay.progress
      return { events: [] as readonly PublicWorldEvent[], rejections: [] as readonly PublicWorldRejection[] }
    },
    async save(): Promise<PublicV23ControllerOutcome<PublicWorldEvent | Event>> {
      if (gate === 'blocked') return { status: 'blocked', reason: blockedReason! }
      if (gate !== 'open') return { status: 'busy' }
      gate = 'checkpointing'
      const result = await flush()
      if (blockedReason === null) gate = 'open'
      return result
    },
    async action(witness: BaseAction | Extra):
      Promise<PublicV23ControllerOutcome<PublicWorldEvent | Event>> {
      if (gate === 'blocked') return { status: 'blocked', reason: blockedReason! }
      if (gate !== 'open') return { status: 'busy' }
      gate = 'barrier'
      const saved = await flush()
      if (saved.status === 'blocked') return saved
      if (saved.status === 'deferred-airborne') { gate = 'open'; return saved }
      const before = progress(committed)
      const candidate = witness.kind === 'mireglass-action/v1'
        ? extraAction?.(before, witness as Extra) ?? { rejection: 'invalid-witness' }
        : applyPublicV23Witness(before, witness)
      if ('rejection' in candidate) { gate = 'open'; return { status: 'rejected', reason: candidate.rejection } }
      const result = await checkedWrite(witness, candidate.progress)
      if (blockedReason === null) gate = 'open'
      if (result.status !== 'saved') return result
      const site = witness.kind === 'regional-work'
        ? resolvePublicV23Site(before.state.seed, witness.id)
        : witness.kind === 'legacy-work'
          ? before.state.movementOwner === 'greenway'
            ? resolvePublicV17GreenwaySite(before.state.seed, witness.id)
            : resolveTerrainWorkSite(before.state.seed, witness.id)
          : null
      const workEvent = site ? { id: site.id, kind: site.kind,
        logsSpent: itemCount(before, 'logs') - itemCount(candidate.progress, 'logs'),
        stoneGained: itemCount(candidate.progress, 'stone') - itemCount(before, 'stone'),
        xp: candidate.progress.state.player.xp - before.state.player.xp } : undefined
      return { ...result, events: candidate.events,
        resetWalkRequested: feetChanged(candidate.events), ...(workEvent ? { workEvent } : {}) }
    },
  }
}

/** V23 keeps its original writer and witness surface. */
export function createPublicV23ControllerRuntime(initial: PublicV23Start, write: Writer) {
  return createControllerRuntime<PublicV23Start, never, never>(initial, write)
}

/** V24 shares V23 frame replay and barriers, adding only its checked Mireglass reducer. */
export function createPublicV24ControllerRuntime(initial: PublicV24Start, write: V24Writer,
  onSavePhase?: (sample: PublicV24SavePhase) => void) {
  return createControllerRuntime<PublicV24Start, MireglassWitness,
    PublicMireglassEvent & { sequence: number }>(initial, write,
    (before, witness) => applyPublicV24MireglassAction(before, witness.action), onSavePhase)
}

/** V25 shares V24 actions but checks the connected river before queuing local frames. */
export function createPublicV25ControllerRuntime(initial: PublicV25Start, write: V25Writer,
  onSavePhase?: (sample: PublicV24SavePhase) => void) {
  return createControllerRuntime<PublicV25Start, MireglassWitness,
    PublicMireglassEvent & { sequence: number }>(initial, write,
    (before, witness) => applyPublicV24MireglassAction(before, witness.action),
    onSavePhase, publicV25RiverPassage)
}
