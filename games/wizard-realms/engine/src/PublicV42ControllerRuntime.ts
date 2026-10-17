import { createPublicV36ControllerRuntime } from './PublicV36ControllerRuntime'
import { publicV28BlockedMoveMessage } from './PublicV28ControllerRuntime'
import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { HERB_CYCLE_TICKS } from './domain/mireglassHerbForaging'
import { createPublicV23StreamTerrain } from './domain/publicWorldV14Terrain'
import { decodePublicV14FrameWitness, PUBLIC_V14_MAX_FRAME_BATCH } from './domain/publicWorldV14Snapshot'
import type { PublicV14Frame } from './domain/publicWorldV14Snapshot'
import { publicV17StarterAdvanceMove } from './domain/publicWorldV17StarterMovement'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import { publicWorldV16TileAtGrid } from './domain/publicWorldV16GreenwaySites'
import { exactPublicV23 } from './domain/publicWorldV23Snapshot'
import type { PublicWorldIntent, PublicWorldRejection } from './domain/publicWorldRuntime'
import type { PublicV23ControllerOutcome } from './PublicV23ControllerRuntime'
import type { PublicV36Start } from './domain/publicWorldV36Flow'
import { projectPublicV31Pose } from './domain/publicWorldV31Support'
import { replayPublicV28FramesWithEvents } from './domain/publicWorldV28Replay'
import { starterCliffFace } from './domain/starterCliffProfile'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './domain/worldChunks'
import { decodePublicV36Witness, PUBLIC_V36_SCHEMA } from './domain/publicWorldV36Snapshot'
import type { PublicV42Operation, PublicV42Start } from './domain/publicWorldV42Flow'
import type { PublicV42SavePhase, PublicV42SaveTrace } from './domain/publicWorldV42Flow'
import { decodePublicV42Head, decodePublicV42Lineage, replayPublicV42Witness } from './domain/publicWorldV42Snapshot'
import type { PublicV42Witness } from './domain/publicWorldV42Snapshot'
import { confirmPublicV37WindwardAction, decodePublicV37WindwardWitness } from './domain/publicWorldV37WindwardAction'
import { confirmPublicV38SignalAction, decodePublicV38SignalWitness } from './domain/publicWorldV38SignalAction'
import { confirmPublicV39RingAction, decodePublicV39RingWitness } from './domain/publicWorldV39RingAction'
import type { PublicV39RingProgress } from './domain/publicWorldV39RingAction'
import { confirmPublicV40WaystationAction, decodePublicV40WaystationWitness } from './domain/publicWorldV40WaystationAction'
import type { PublicV40WaystationProgress } from './domain/publicWorldV40WaystationAction'
import { confirmPublicV41CombatAction, decodePublicV41CombatWitness } from './domain/publicWorldV41CombatAction'
import { confirmPublicV42RewardAction, decodePublicV42RewardWitness,
  previewPublicV42RewardFrameBatch } from './domain/publicWorldV42RewardAction'
import type { PublicV42RewardProgress } from './domain/publicWorldV42RewardAction'

type Writer = (revision: number, lineage: PublicV42Start['lineage'], witness: PublicV42Witness) =>
  Promise<PublicV42Operation<PublicV42Start>>
type HomeWriter = (revision: number, lineage: PublicV42Start['lineage']) =>
  Promise<PublicV42Operation<PublicV42Start>>
type InheritedAction = Parameters<ReturnType<typeof createPublicV36ControllerRuntime>['action']>[0]
const progress = ({ head }: PublicV42Start): PublicV42RewardProgress => {
  const { schemaVersion: _schema, saveRevision: _revision, witness: _witness, ...value } = head
  return value
}
const ringFlags = ({ quarryRingDiscovered, ringLinkEstablished, ringOutboundCompleted,
  ringReturnCompleted, ringkeeperClaimed }: PublicV39RingProgress) => ({
  quarryRingDiscovered, ringLinkEstablished, ringOutboundCompleted,
  ringReturnCompleted, ringkeeperClaimed })
const waystationFlags = ({ timberBartered, southbankReached,
  waystationClaimed }: PublicV40WaystationProgress) => ({ timberBartered, southbankReached,
  waystationClaimed })
const combatState = ({ ironHall, ironHallReward }: PublicV42RewardProgress) => ({ ironHall, ironHallReward })

/** Explain a checked off-axis cliff rejection without changing the requested move. */
function starterLadderRejection(value: PublicV42RewardProgress,
  intents: readonly PublicWorldIntent[]): string | null {
  if (value.state.movementOwner !== 'greenway') return null
  const move = intents.find((intent) => intent.type === 'move')
  if (!move || move.type !== 'move' || Math.abs(move.delta.z) < 0.08) return null
  const { state } = value, route = state.greenway.routes.find((entry) =>
    entry.id === 'greenway_ladder')
  const face = route && starterCliffFace(state.seed, route,
    state.generationProfile, state.greenway.builtRouteIds.includes('greenway_ladder'))
  if (!face) return null
  const from = state.player.position, offset = Math.abs(from.x - face.from.x)
  if (offset <= face.width / 2 + 1e-6 || offset > 2
    || from.z < face.to.z - 0.5 || from.z > face.from.z + 2) return null
  const step = publicV17StarterAdvanceMove({ seed: state.seed,
    profile: state.generationProfile, route, built: true,
    greenwayWorks: value.greenwayWorks }, from,
  { x: from.x + move.delta.x, z: from.z + move.delta.z }, state.player.verticalVelocity)
  if (step.accepted || step.reason !== 'cliff_blocked' && step.reason !== 'off_ladder') return null
  return move.delta.z < 0
    ? 'The built starter ladder is narrow. Move to the center of its lower foot, then climb within the rungs.'
    : 'The built starter ladder is narrow. Move to the center of its upper foot, then descend within the rungs.'
}

/** Surface only a grounded creek gate proven by the same Greenway move authority. */
function starterCreekRejection(value: PublicV42RewardProgress,
  intents: readonly PublicWorldIntent[]): string | null {
  const { state, greenwayWorks } = value
  if (state.movementOwner !== 'greenway' || state.player.verticalVelocity !== 0
    || intents.length !== 1 || intents[0].type !== 'move') return null
  const from = state.player.position, { delta } = intents[0]
  const step = publicV17StarterAdvanceMove({ seed: state.seed,
    profile: state.generationProfile,
    route: state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
    built: state.greenway.builtRouteIds.includes('greenway_ladder'), greenwayWorks }, from,
  { x: from.x + delta.x, z: from.z + delta.z }, state.player.verticalVelocity)
  if (step.accepted) return null
  return step.reason === 'creek_blocked'
    ? 'Build a Greenway bridge lane to cross the creek.'
    : step.reason === 'off_bridge'
      ? 'Move along the dry bank to a built bridge, then cross centered on its deck.' : null
}

/** Inherited controls use a disposable V36 shell. Its lineage never reaches storage. */
function asV36(start: PublicV42Start): PublicV36Start {
  const { markerClaimReward: _marker, signalVantageInspected: _inspected,
    signalClaimed: _claimed, quarryRingDiscovered: _discovered,
    ringLinkEstablished: _linked, ringOutboundCompleted: _outbound,
    ringReturnCompleted: _returned, ringkeeperClaimed: _ringClaimed,
    timberBartered: _bartered, southbankReached: _southbank,
    waystationClaimed: _waystationClaimed, ironHall: _combat,
    ironHallReward: _reward, ...genesis } = start.lineage.genesis
  const { signalVantageInspected: _headInspected, signalClaimed: _headClaimed,
    quarryRingDiscovered: _headDiscovered, ringLinkEstablished: _headLinked,
    ringOutboundCompleted: _headOutbound, ringReturnCompleted: _headReturned,
    ringkeeperClaimed: _headRingClaimed, timberBartered: _headBartered,
    southbankReached: _headSouthbank, waystationClaimed: _headWaystationClaimed,
    ironHall: _headCombat, ironHallReward: _headReward, ...head } = start.head
  return { lineage: { origin: 'v35-migration', rulesProfile: 'old-marker/v1',
    seed: start.lineage.seed, sourceRevision: 0, genesis: structuredClone(genesis) },
  head: { ...structuredClone(head), schemaVersion: PUBLIC_V36_SCHEMA,
    saveRevision: start.head.saveRevision + 1,
    witness: decodePublicV36Witness(start.head.witness) ?? { kind: 'checkpoint' } } }
}

/** Preview and writer verify the same ordinary witnesses with V37's private movement policy. */
export function createPublicV42ControllerRuntime(initial: PublicV42Start,
  write: Writer, homeWrite?: HomeWriter, onSavePhase?: PublicV42SaveTrace) {
  let committed = structuredClone(initial), preview = progress(committed)
  let pending: PublicV14Frame[] = [], busy = false, blockedReason: string | null = null
  const reportPhase = (phase: PublicV42SavePhase['phase'], startedAt: number,
    frameCount: number) => {
    if (!onSavePhase) return
    try { onSavePhase({ phase, durationMs: performance.now() - startedAt,
      pendingFrames: frameCount }) }
    catch { /* Diagnostics must not affect checked saves. */ }
  }
  const grounded = (value: PublicV42RewardProgress) => {
    const pose = projectPublicV31Pose(value)
    return value.state.player.verticalVelocity === 0 && !!pose
      && Math.abs(pose.effective.position.y - pose.effective.floorY) <= 1e-6
  }
  const freeze = (reason: string) => {
    blockedReason = reason
    return { status: 'blocked' as const, reason }
  }
  const checked = (reply: PublicV42Operation<PublicV42Start>, revision: number,
    witness: PublicV42Witness, expected: PublicV42RewardProgress) => {
    if (!reply.ok) return reply
    try {
      const { head, lineage } = reply.value
      if (!exactPublicV23(reply.value, ['head', 'lineage'])
        || !decodePublicV42Lineage(lineage) || !decodePublicV42Head(head, lineage)
        || !samePublicV14Value(lineage, committed.lineage)
        || head.saveRevision !== revision + 1 || !samePublicV14Value(head.witness, witness)
        || !samePublicV14Value(progress(reply.value), expected))
        return { ok: false as const, reason: 'writer-mismatch' }
      committed = structuredClone(reply.value); preview = progress(committed); pending = []
      return { ok: true as const, value: asV36(committed) }
    } catch { return { ok: false as const, reason: 'writer-mismatch' } }
  }
  const flush = async (): Promise<PublicV23ControllerOutcome> => {
    if (!pending.length) return { status: 'unchanged' }
    const frameCount = pending.length
    const groundedStartedAt = onSavePhase ? performance.now() : 0
    const canSave = grounded(preview)
    reportPhase('grounded-check', groundedStartedAt, frameCount)
    if (!canSave) return { status: 'deferred-airborne' }
    const decodeStartedAt = onSavePhase ? performance.now() : 0
    const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames: pending })
    reportPhase('witness-decode', decodeStartedAt, frameCount)
    const replayStartedAt = onSavePhase ? performance.now() : 0
    const expected = witness && replayPublicV42Witness(progress(committed), witness)
    reportPhase('local-frame-replay', replayStartedAt, frameCount)
    const compareStartedAt = onSavePhase ? performance.now() : 0
    const matchesPreview = !!witness && !!expected && samePublicV14Value(expected, preview)
    reportPhase('local-frame-compare', compareStartedAt, frameCount)
    if (!matchesPreview || !witness || !expected) return freeze('local-replay')
    try {
      const revision = committed.head.saveRevision
      const writerStartedAt = onSavePhase ? performance.now() : 0
      const reply = await write(revision, structuredClone(committed.lineage), witness)
        .finally(() => reportPhase('writer-await', writerStartedAt, frameCount))
      const replyStartedAt = onSavePhase ? performance.now() : 0
      const result = checked(reply, revision, witness, expected)
      reportPhase('reply-check-clone', replyStartedAt, frameCount)
      return result.ok ? { status: 'saved', events: [], resetWalkRequested: false } : freeze(result.reason)
    } catch { return freeze('storage-error') }
  }
  const inherited = () => createPublicV36ControllerRuntime(asV36(committed),
    async (shellRevision, _lineage, witness) => {
      const revision = committed.head.saveRevision
      if (shellRevision !== revision + 1) return { ok: false, reason: 'revision-changed' }
      const expected = replayPublicV42Witness(progress(committed), witness)
      if (!expected) return { ok: false, reason: 'local-replay' }
      return checked(await write(revision, structuredClone(committed.lineage), witness), revision, witness, expected)
    }, homeWrite ? async (shellRevision) => {
      const revision = committed.head.saveRevision
      if (shellRevision !== revision + 1) return { ok: false, reason: 'revision-changed' }
      const reply = await homeWrite(revision, structuredClone(committed.lineage))
      if (!reply.ok) return reply
      const witness = decodePublicV36Witness(reply.value.head.witness)
      const expected = witness?.kind === 'return-home/v1'
        ? replayPublicV42Witness(progress(committed), witness) : null
      return witness && expected ? checked(reply, revision, witness, expected)
        : { ok: false, reason: 'writer-mismatch' }
    } : undefined)
  const reject = (intents: readonly PublicWorldIntent[], code: PublicWorldRejection['code'], message: string) =>
    ({ events: [], rejections: [{ intentIndex: 0, intentType: intents[0]?.type ?? 'move', code, message }] })
  return {
    committed: () => structuredClone(committed),
    preview: () => structuredClone(preview),
    view() {
      const { state } = preview
      const activeTiles = state.movementOwner === 'greenway' ? state.greenway.tiles.map((tile) =>
        publicWorldV16TileAtGrid(state.seed, tile.center.x / 4, tile.center.z / 4))
        : createPublicV23StreamTerrain(state, preview.regionalWorks.builtLadderIds).activeTiles()
      return { movementOwner: state.movementOwner, tick: state.tick,
        player: structuredClone(state.player), activeTiles: structuredClone(activeTiles),
        activeKnownTileIds: discoveredTileIdsInActiveWindow(state.discoveryMask, state.player.position),
        pendingBoundary: false }
    },
    status: () => ({ gate: blockedReason ? 'blocked' as const : busy ? 'barrier' as const
      : pending.length >= PUBLIC_V14_MAX_FRAME_BATCH ? 'cap-paused' as const : 'open' as const,
    blockedReason, saveRevision: committed.head.saveRevision, pendingFrames: pending.length,
    checkpointRecommended: pending.length >= 64, checkpointRequired: pending.length >= PUBLIC_V14_MAX_FRAME_BATCH }),
    // Match inherited clock obligations, with V31's effective support for settling.
    idleFrameNeeded: () => {
      const { state } = preview, { tick, player } = state
      return busy || blockedReason !== null || !grounded(preview)
        || !Number.isSafeInteger(tick + 1)
        || !player.tradeSlots.every((slot) => slot.itemId === null && slot.quantity === 0 && slot.unitPrice === 0)
        || !state.mireglass.herbHarvestCycles.every((entry) => entry.cycle < Math.floor(tick / HERB_CYCLE_TICKS))
        || !state.highland.stoneNodes.every((node) => node.readyAtTick <= tick)
        || state.windstep.activeUntilTick > tick || state.windstep.nextCastTick > tick
        || preview.ironHall.engaged && (preview.ironHall.phase === 'windup'
          || preview.ironHall.phase === 'recovery')
        || preview.ironHallReward.spar.active
    },
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean) {
      if (busy || blockedReason || pending.length >= PUBLIC_V14_MAX_FRAME_BATCH)
        return reject(intents, 'unavailable_here', 'Movement is paused for a checked write.')
      const frame = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames: [{ intents, walkRequested }] })
      if (!frame) return reject(intents, 'invalid_frame', 'Invalid replayable frame.')
      const candidate = [...pending, frame.frames[0]]
      const hasJump = candidate.some(({ intents }) => intents.some((intent) => intent.type === 'jump'))
      // Grounded ordinary frames compose singly. Flight needs its grounded origin.
      const wholeBatch = hasJump || !grounded(preview)
      const next = previewPublicV42RewardFrameBatch(wholeBatch ? progress(committed) : preview,
        { kind: 'frame-batch/v1', frames: wholeBatch ? candidate : frame.frames })
      if (!next) {
        const move = intents.find((intent) => intent.type === 'move')
        const from = preview.state.player.position
        const target = move?.type === 'move'
          ? [from.x + move.delta.x, from.z + move.delta.z] : []
        const worldEdge = target.some((coordinate) => {
          const cell = Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
          return cell < WORLD_GRID_MIN || cell > WORLD_GRID_MAX
        })
        const knownReason = starterLadderRejection(preview, intents)
          ?? starterCreekRejection(preview, intents)
          ?? (worldEdge ? 'You reached the edge of this world. Turn back and explore another direction.'
            : null)
        if (knownReason) return reject(intents, 'terrain_missing', knownReason)
        const v28Blocked = !hasJump && grounded(preview)
          && frame.frames[0].intents.filter((intent) => intent.type === 'move').length === 1
          && frame.frames[0].intents.every((intent) => intent.type === 'move' || intent.type === 'look')
          && !replayPublicV28FramesWithEvents(preview, frame.frames, true)
        return reject(intents, 'terrain_missing', v28Blocked
          ? publicV28BlockedMoveMessage(preview, frame.frames[0])
          : 'This move cannot be replayed safely.')
      }
      pending = candidate; preview = next
      return { events: [], rejections: [] }
    },
    async save() {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      busy = true
      try { return await flush() } finally { busy = false }
    },
    async returnHome() {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      busy = true
      try {
        const saved = await flush()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const result = await inherited().returnHome()
        if (result.status === 'blocked') return freeze(result.reason)
        return result
      } catch { return freeze('storage-error') } finally { busy = false }
    },
    async action(raw: InheritedAction | import('./domain/publicWorldV37WindwardAction').PublicV37WindwardWitness
      | import('./domain/publicWorldV38SignalAction').PublicV38SignalWitness
      | import('./domain/publicWorldV39RingAction').PublicV39RingWitness
      | import('./domain/publicWorldV40WaystationAction').PublicV40WaystationWitness
      | import('./domain/publicWorldV41CombatAction').PublicV41CombatWitness
      | import('./domain/publicWorldV42RewardAction').PublicV42RewardWitness) {
      if (blockedReason) return freeze(blockedReason)
      if (busy) return { status: 'busy' as const }
      busy = true
      try {
        const saved = await flush()
        if (saved.status !== 'saved' && saved.status !== 'unchanged') return saved
        const reward = decodePublicV42RewardWitness(raw)
        if (reward) {
          const action = confirmPublicV42RewardAction(preview, reward)
          if (action.rejection) return { status: 'rejected' as const, reason: action.rejection }
          const revision = committed.head.saveRevision
          const result = checked(await write(revision, structuredClone(committed.lineage), reward),
            revision, reward, action.progress)
          return result.ok ? { status: 'saved' as const, events: [], resetWalkRequested: false } : freeze(result.reason)
        }
        const combat = decodePublicV41CombatWitness(raw)
        if (combat) {
          const action = confirmPublicV41CombatAction(preview, combat)
          if (action.rejection) return { status: 'rejected' as const, reason: action.rejection }
          const expected = replayPublicV42Witness(preview, combat)
          if (!expected) return freeze('local-replay')
          const revision = committed.head.saveRevision
          const result = checked(await write(revision, structuredClone(committed.lineage), combat),
            revision, combat, expected)
          return result.ok ? { status: 'saved' as const, events: [], resetWalkRequested: false } : freeze(result.reason)
        }
        const waystation = decodePublicV40WaystationWitness(raw)
        if (waystation) {
          const action = confirmPublicV40WaystationAction(preview, waystation)
          if (action.rejection) return { status: 'rejected' as const, reason: action.rejection }
          const revision = committed.head.saveRevision
          const result = checked(await write(revision, structuredClone(committed.lineage), waystation),
            revision, waystation, { ...action.progress, ...combatState(preview) })
          return result.ok ? { status: 'saved' as const, events: [], resetWalkRequested: false } : freeze(result.reason)
        }
        const ring = decodePublicV39RingWitness(raw)
        if (ring) {
          const action = confirmPublicV39RingAction(preview, ring)
          if (action.rejection) return { status: 'rejected' as const, reason: action.rejection }
          const revision = committed.head.saveRevision
          const result = checked(await write(revision, structuredClone(committed.lineage), ring),
            revision, ring, { ...action.progress, ...waystationFlags(preview),
              ...combatState(preview) })
          return result.ok ? { status: 'saved' as const, events: [], resetWalkRequested: false } : freeze(result.reason)
        }
        const signal = decodePublicV38SignalWitness(raw)
        if (signal) {
          const action = confirmPublicV38SignalAction(preview, signal)
          if (action.rejection) return { status: 'rejected' as const, reason: action.rejection }
          const revision = committed.head.saveRevision
          const result = checked(await write(revision, structuredClone(committed.lineage), signal),
            revision, signal, { ...action.progress, ...ringFlags(preview),
              ...waystationFlags(preview), ...combatState(preview) })
          return result.ok ? { status: 'saved' as const, events: [], resetWalkRequested: false } : freeze(result.reason)
        }
        const windward = decodePublicV37WindwardWitness(raw)
        if (!windward) {
          const result = await inherited().action(raw as InheritedAction)
          if (result.status === 'blocked') return freeze(result.reason)
          return result
        }
        const action = confirmPublicV37WindwardAction(preview, windward)
        if (action.rejection) return { status: 'rejected' as const, reason: action.rejection }
        const revision = committed.head.saveRevision
        const result = checked(await write(revision, structuredClone(committed.lineage), windward),
          revision, windward, { ...action.progress,
            signalVantageInspected: preview.signalVantageInspected,
            signalClaimed: preview.signalClaimed, ...ringFlags(preview),
            ...waystationFlags(preview), ...combatState(preview) })
        return result.ok ? { status: 'saved' as const, events: [], resetWalkRequested: false } : freeze(result.reason)
      } catch { return freeze('storage-error') } finally { busy = false }
    },
  }
}
