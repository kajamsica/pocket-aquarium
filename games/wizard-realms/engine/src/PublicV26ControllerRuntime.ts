import { discoveredTileIdsInActiveWindow } from './domain/publicV13DiscoveryWindow'
import { mireglassMoveBarrier } from './domain/mireglassMovementGate'
import { publicWorldV16TileAtGrid } from './domain/publicWorldV16GreenwaySites'
import { publicV14InsideGreenway } from './domain/publicWorldV14Boundary'
import { placementId, resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { previewPublicV17GreenwayWork } from './domain/publicWorldV17GreenwayWork'
import { createPublicV23StreamTerrain, resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { decodePublicV14FrameWitness, PUBLIC_V14_MAX_FRAME_BATCH } from './domain/publicWorldV14Snapshot'
import type { PublicV14Frame } from './domain/publicWorldV14Snapshot'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './domain/publicWorldRuntime'
import { applyPublicV23Witness } from './domain/publicWorldV23Transitions'
import type { PublicV23Progress } from './domain/publicWorldV23Snapshot'
import { resolvePublicV23Site } from './domain/publicWorldV23Sites'
import { applyPublicV24MireglassAction } from './domain/publicWorldV24MireglassAction'
import { publicV25RiverPassage } from './domain/publicWorldV25Passage'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { PUBLIC_RUN_STEP_METERS } from './domain/publicWorldGait'
import type { PublicMireglassEvent } from './domain/publicWorldActions'
import type { PublicV26Operation, PublicV26Start } from './domain/publicWorldV26Flow'
import type { PublicV26Progress } from './domain/publicWorldV26Migration'
import { projectPublicV26Pose } from './domain/publicWorldV26Pose'
import { decodePublicV26Witness, previewPublicV26Frames,
  publicV26SavedLadderSpans, replayPublicV26Witness } from './domain/publicWorldV26Snapshot'
import type { PublicV26Witness } from './domain/publicWorldV26Snapshot'
import { applyPublicV26TerrainAction } from './domain/publicWorldV26TerrainAction'
import { applyPublicV26PitLadderAction } from './domain/publicWorldV26PitLadder'
import { publicV26ValleyRimPassage } from './domain/publicWorldV26ValleyRim'
import type { PublicV27Start } from './domain/publicWorldV27Flow'
import { previewPublicV27Frames, replayPublicV27FramesWithEvents,
  replayPublicV27Witness } from './domain/publicWorldV27Snapshot'
import { resolveTerrainWorkSite } from './domain/terrainWorks'
import { starterCliffWorldTileAtGrid } from './domain/starterCliffWorld'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './domain/worldChunks'
import type { PublicV23ControllerOutcome } from './PublicV23ControllerRuntime'
import { HERB_CYCLE_TICKS } from './domain/mireglassHerbForaging'

type Gate = 'open' | 'checkpointing' | 'barrier' | 'blocked'
type Event = PublicWorldEvent | (PublicMireglassEvent & { sequence: number })
type Outcome = PublicV23ControllerOutcome<Event>
type Start = PublicV26Start | PublicV27Start
type Writer<S extends Start> = (revision: number, lineage: S['lineage'],
  witness: PublicV26Witness) => Promise<PublicV26Operation<S>>
type ReturnHomeWriter<S extends Start> = (revision: number, lineage: S['lineage']) =>
  Promise<PublicV26Operation<S>>
type Action = Exclude<PublicV26Witness, { kind: 'frame-batch/v1' } | { kind: 'checkpoint' }
  | { kind: 'return-home/v1' }>
const progress = ({ head }: Start): PublicV26Progress => ({
  state: head.state, greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks,
  terrain: head.terrain, nextHomeAtMs: head.nextHomeAtMs })
const old = ({ state, greenwayWorks, regionalWorks }: PublicV26Progress): PublicV23Progress =>
  ({ state, greenwayWorks, regionalWorks })
const grounded = (value: PublicV26Progress): boolean => {
  const pose = projectPublicV26Pose(value, value.terrain)
  return value.state.player.verticalVelocity === 0 && !!pose
    && Math.abs(pose.effective.position.y - pose.effective.floorY) <= 1e-6
}
const itemCount = (value: PublicV26Progress, id: string) => value.state.player.inventory
  .filter((stack) => stack.itemId === id).reduce((count, stack) => count + stack.quantity, 0)
const emptyEvents: readonly Event[] = []
const LADDER_ENTRY_REACH = 1.5
const LADDER_FOOT_MARGIN = 0.12
const LADDER_LANE_MARGIN = 0.08

/** Shape only new live input; checked frames and historical replay remain unchanged. */
function guideNorthLadderInput(value: PublicV26Progress,
  intents: readonly PublicWorldIntent[]): readonly PublicWorldIntent[] {
  if (value.state.movementOwner !== 'greenway' || !value.greenwayWorks.builtLadderIds.length
    || intents.length > 2
    || intents.some((intent) => intent.type !== 'move' && intent.type !== 'look')) return intents
  const move = intents.find((intent) => intent.type === 'move')
  if (!move || move.type !== 'move') return intents
  const { x: requestedX, z: requestedZ } = move.delta
  const stride = Math.hypot(requestedX, requestedZ)
  if (!(requestedZ < -0.08) || Math.abs(requestedX) > -requestedZ * 0.35
    || !Number.isFinite(stride) || stride > PUBLIC_RUN_STEP_METERS + 1e-6) return intents
  const from = value.state.player.position
  let target: { x: number; footZ: number; safeHalfWidth: number } | null = null
  let nearest = LADDER_ENTRY_REACH
  for (const id of value.greenwayWorks.builtLadderIds) {
    const site = resolvePublicV17GreenwaySite(value.state.seed, id)
    if (!site || site.kind !== 'ladder') continue
    if (from.z <= site.supportPath[2].z) continue
    const footZ = site.supportPath[1].z
    const safeHalfWidth = site.widthMeters / 2 - LADDER_LANE_MARGIN
    const xDistance = Math.abs(from.x - site.from.x)
    const distance = Math.hypot(xDistance, from.z - footZ)
    if (xDistance <= safeHalfWidth + 1e-6 || distance >= nearest) continue
    nearest = distance
    target = { x: site.from.x, footZ, safeHalfWidth }
  }
  if (!target) return intents
  const pose = projectPublicV26Pose(value, value.terrain)
  if (value.state.player.verticalVelocity !== 0 || pose?.support !== 'ground'
    || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6
    || Math.abs(pose.effective.floorY - pose.carrier.floorY) > 1e-6) return intents
  const safeFootZ = target.footZ + LADDER_FOOT_MARGIN
  const guided = from.z < safeFootZ - 1e-6
    ? { x: 0, z: Math.min(stride, safeFootZ - from.z) }
    : { x: Math.sign(target.x - from.x)
      * Math.min(stride, Math.abs(target.x - from.x) - target.safeHalfWidth), z: 0 }
  return intents.map((intent) => intent === move ? { ...move, delta: guided } : intent)
}

/** A dry diagonal corner may need two legal axis steps; record only the first checked step. */
function checkedDryCornerStride(value: PublicV26Progress, frame: PublicV14Frame,
  replay: typeof replayPublicV26Witness):
  { frame: PublicV14Frame; next: PublicV26Progress } | null {
  if (value.state.movementOwner !== 'greenway' || frame.intents.length > 2
    || frame.intents.some((intent) => intent.type !== 'move' && intent.type !== 'look')) return null
  const move = frame.intents.find((intent) => intent.type === 'move')
  if (!move || move.type !== 'move' || frame.intents.filter((intent) => intent.type === 'move').length !== 1
    || !move.delta.x || !move.delta.z
    || value.state.player.verticalVelocity !== 0) return null
  const from = value.state.player.position
  const to = { ...from, x: from.x + move.delta.x, z: from.z + move.delta.z }
  const cell = (axis: number) => Math.ceil(axis / WORLD_CELL_METERS - 0.5)
  if (cell(from.x) === cell(to.x) || cell(from.z) === cell(to.z)) return null
  const start = projectPublicV26Pose(value, value.terrain)
  if (start?.support !== 'ground'
    || Math.abs(start.effective.position.y - start.effective.floorY) > 1e-6
    || Math.abs(start.effective.floorY - start.carrier.floorY) > 1e-6
    || !publicV25RiverPassage(old(value), from, to).ok) return null
  const spans = publicV26SavedLadderSpans(value)
  if (!spans || !publicV26ValleyRimPassage(value.state.seed, from, to, spans).ok) return null
  for (const delta of [{ x: move.delta.x, z: 0 }, { x: 0, z: move.delta.z }]) {
    const partial = decodePublicV14FrameWitness({ kind: 'frame-batch/v1',
      frames: [{ ...frame, intents: frame.intents.map((intent) =>
        intent === move ? { ...move, delta } : intent) }] })
    if (!partial) continue
    const next = replay(value, partial)
    if (!next) continue
    const remaining = { x: move.delta.x - delta.x, z: move.delta.z - delta.z }
    const completion = replay(next, { kind: 'frame-batch/v1',
      frames: [{ intents: [{ type: 'move', delta: remaining }],
        walkRequested: frame.walkRequested }] })
    if (!completion || [next, completion].some((progress) => {
      const pose = projectPublicV26Pose(progress, progress.terrain)
      return pose?.support !== 'ground'
        || Math.abs(pose.effective.floorY - pose.carrier.floorY) > 1e-6
    })) continue
    return { frame: partial.frames[0], next }
  }
  return null
}

/** Local preview uses the selected checked version; only a matching writer reply commits it. */
function createCheckedControllerRuntime<S extends Start>(initial: S, write: Writer<S>,
  returnHomeWrite?: ReturnHomeWriter<S>, v27 = false) {
  const replay = v27 ? replayPublicV27Witness : replayPublicV26Witness
  const previewFrames = v27 ? previewPublicV27Frames : previewPublicV26Frames
  let committed = structuredClone(initial)
  let preview = progress(committed)
  let pending: PublicV14Frame[] = []
  let flight: { origin: PublicV26Progress; frames: readonly PublicV14Frame[] } | null = null
  let gate: Gate = 'open'
  let blockedReason: string | null = null
  let idleCheck: { preview: PublicV26Progress; needed: boolean } | null = null
  const freeze = (reason: string): Outcome => {
    gate = 'blocked'; blockedReason = reason
    return { status: 'blocked', reason }
  }
  const rejectedFrame = (intents: readonly PublicWorldIntent[], code: PublicWorldRejection['code'],
    message: string): { events: readonly PublicWorldEvent[];
      rejections: readonly PublicWorldRejection[] } => ({ events: [],
    rejections: [{ intentIndex: 0, intentType: intents[0]?.type ?? 'move', code, message }] })
  const blockedMoveMessage = (frame: PublicV14Frame): string => {
    const move = frame.intents.find((intent) => intent.type === 'move')
    if (!move || move.type !== 'move') return 'This move is blocked by checked V26 terrain.'
    const from = preview.state.player.position
    const to = { ...from, x: from.x + move.delta.x, z: from.z + move.delta.z }
    const cell = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
    if (v27 && [cell(to.x), cell(to.z)].some((grid) =>
      grid < WORLD_GRID_MIN || grid > WORLD_GRID_MAX)) {
      return 'You reached the edge of this world. Turn back and explore another direction.'
    }
    const river = publicV25RiverPassage(old(preview), from, to)
    if (!river.ok && river.reason === 'river-needs-bridge') {
      if (!v27) return 'River crossing blocked. Build a bridge to cross.'
      const nearBridge = preview.greenwayWorks.builtBridgeIds.some((id) => {
        const site = resolvePublicV17GreenwaySite(preview.state.seed, id)
        return site?.kind === 'bridge' && Math.abs(from.x - site.from.x) <= site.widthMeters / 2 + 2
          && from.z >= site.from.z - 2 && from.z <= site.to.z + 2
      }) || preview.state.terrainWorks.builtWorkIds.some((id) => {
        const site = resolveTerrainWorkSite(preview.state.seed, id)
        return site?.kind === 'bridge' && Math.abs(from.x - site.from.x) <= site.widthMeters / 2 + 2
          && from.z >= Math.min(site.from.z, site.to.z) - 2
          && from.z <= Math.max(site.from.z, site.to.z) + 2
      })
      return nearBridge
        ? 'The river blocks this step. Approach the built bridge from its dry end and stay on the deck.'
        : 'The river blocks this step. Follow the bank to a marked crossing before building a bridge.'
    }
    const spans = publicV26SavedLadderSpans(preview)
    const rim = spans && publicV26ValleyRimPassage(preview.state.seed, from, to, spans)
    if (rim && !rim.ok && rim.reason === 'cliff-needs-ladder') {
      if (!spans?.length) {
        if (!v27) return 'Build a ladder at this cliff face.'
        const missing = Math.max(0, 4 - itemCount(preview, 'logs'))
        const id = placementId('ladder', from.x)
        const site = id ? previewPublicV17GreenwayWork({ state: preview.state,
          greenwayWorks: preview.greenwayWorks }, id) : null
        const buildableHere = site?.site?.kind === 'ladder'
          && (site.rejection === null || site.rejection === 'not_owned')
        const next = buildableHere
          ? 'Open Works and build at this marked ladder site.'
          : 'Follow the lower cliff face until Works marks a buildable ladder site.'
        return missing
          ? `The cliff needs a ladder. Chop ${missing} more ${missing === 1 ? 'log' : 'logs'}. ${next}`
          : `The cliff needs a ladder. You have enough logs. ${next}`
      }
      return spans.some((span) => Math.abs(from.x - span.x) <= span.widthMeters / 2 + 2)
        ? 'The ladder is already built nearby. Approach its rungs from the lower cliff face.'
        : 'A ladder is already built farther along this cliff. Follow the lower cliff face to its rungs.'
    }
    if (v27 && rim && !rim.ok && rim.reason === 'rock-return-blocked')
      return 'A rock wall closes this side of the valley. Turn back toward the ladder or a marked river crossing.'
    if (v27) {
      const fromX = cell(from.x), fromZ = cell(from.z), toX = cell(to.x), toZ = cell(to.z)
      const wet = (gx: number, gz: number) =>
        starterCliffWorldTileAtGrid(preview.state.seed, gx, gz).terrain === 'wetland'
      const xCut = fromX !== toX
        ? ((Math.min(fromX, toX) + 0.5) * WORLD_CELL_METERS - from.x) / (to.x - from.x) : null
      const zCut = fromZ !== toZ
        ? ((Math.min(fromZ, toZ) + 0.5) * WORLD_CELL_METERS - from.z) / (to.z - from.z) : null
      const ownerCrossing = publicV14InsideGreenway(from) !== publicV14InsideGreenway(to)
      const mireglass = mireglassMoveBarrier(preview.state.seed, from, to)
      if (mireglass === 'fen_channel' || ownerCrossing && (wet(fromX, fromZ) || wet(toX, toZ)
        || xCut !== null && zCut !== null && Math.abs(xCut - zCut) <= 1e-12
          && (wet(fromX, toZ) || wet(toX, fromZ)))) {
        return 'Unsupported wetland blocks this step. Follow dry ground to a marked crossing.'
      }
      if (mireglass === 'slate_cliff')
        return 'A slate cliff blocks this route. Look for a marked ladder or a gentler slope.'
      const start = projectPublicV26Pose(preview, preview.terrain)
      const greenway = publicV14InsideGreenway(to)
      const next = greenway
        ? publicV17StarterSupportAt({ seed: preview.state.seed,
          profile: preview.state.generationProfile,
          route: preview.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
          built: preview.state.greenway.builtRouteIds.includes('greenway_ladder'),
          greenwayWorks: preview.greenwayWorks }, to)
        : resolvePublicV23Surface(preview.state, to, preview.regionalWorks.builtLadderIds)
      if (start && next) {
        const depth = preview.terrain.columns.find((column) => column.gx === toX
          && column.gz === toZ)?.openDepth ?? 0
        const rise = Math.abs(next.floorY - depth * 0.4 - start.effective.floorY)
        const pit = start.effective.floorY < start.carrier.floorY - 1e-6 || depth > 0
        if (pit && rise > 0.55 + 1e-6) {
          const ladder = preview.terrain.columns.some((column) => column.pitLadder
            && (column.gx === toX && column.gz === toZ
              || column.gx === start.cell.gx && column.gz === start.cell.gz))
          return ladder
            ? 'The pit edge is too steep here. Move to the installed pit ladder to climb out.'
            : 'The open pit edge is too steep. Place a pit ladder or take another route.'
        }
        const ordinary = (start.support === 'ground' || start.support === 'terrain')
          && ('kind' in next ? next.kind === 'ground' : next.support === 'terrain')
        if (ordinary && rise > 0.8 + 1e-6)
          return 'This dry rise is too steep to step over. Find a gentler slope or a marked ladder site.'
      }
      return 'This step has no supported route. Try nearby dry ground or an existing crossing.'
    }
    return `This move is blocked by checked V${v27 ? '27' : '26'} terrain.`
  }
  const acceptCheckedReply = (value: S, revision: number,
    witness: PublicV26Witness, expected: PublicV26Progress,
    events: readonly Event[] = emptyEvents): Outcome => {
    try {
      if (value.head.saveRevision !== revision + 1
        || value.head.schemaVersion !== committed.head.schemaVersion
        || !samePublicV14Value(value.lineage, committed.lineage)
        || !samePublicV14Value(value.head.witness, witness)
        || !samePublicV14Value(progress(value), expected)) return freeze('writer-mismatch')
      committed = structuredClone(value)
      preview = progress(committed)
      pending = []
      flight = null
      return { status: 'saved', events, resetWalkRequested: events.some((event) =>
        (event.type === 'item_equipped' || event.type === 'item_unequipped')
        && 'slot' in event && event.slot === 'feet') }
    } catch { return freeze('writer-mismatch') }
  }
  const checkedWrite = async (witness: PublicV26Witness, expected: PublicV26Progress,
    events: readonly Event[] = emptyEvents): Promise<Outcome> => {
    const revision = committed.head.saveRevision
    let reply: PublicV26Operation<S>
    try { reply = await write(revision, structuredClone(committed.lineage), structuredClone(witness)) }
    catch { return freeze('storage-error') }
    return reply.ok ? acceptCheckedReply(reply.value, revision, witness, expected, events)
      : freeze(reply.reason)
  }
  const flush = async (): Promise<Outcome> => {
    if (!pending.length) return { status: 'unchanged' }
    if (!grounded(preview)) return { status: 'deferred-airborne' }
    const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames: pending })
    if (!witness) return freeze('invalid-frame-batch')
    const expected = replay(progress(committed), witness)
    if (!expected || !samePublicV14Value(expected, preview)) return freeze('local-frame-replay')
    if (v27) {
      const effects = replayPublicV27FramesWithEvents(progress(committed), witness.frames)
      if (!effects || !samePublicV14Value(effects.progress, expected))
        return freeze('local-frame-events')
      return checkedWrite(witness, expected, effects.events)
    }
    const effects = applyPublicV23Witness(old(progress(committed)), witness)
    if ('rejection' in effects || !samePublicV14Value(effects.progress, old(expected)))
      return freeze('local-frame-events')
    return checkedWrite(witness, expected, effects.events)
  }
  return {
    committed: () => structuredClone(committed),
    preview: () => structuredClone(preview),
    view() {
      const { state, regionalWorks } = preview
      const activeTiles = state.movementOwner === 'greenway'
        ? state.greenway.tiles.map((tile) => publicWorldV16TileAtGrid(state.seed,
          tile.center.x / 4, tile.center.z / 4))
        : createPublicV23StreamTerrain(state, regionalWorks.builtLadderIds).activeTiles()
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
    /** Keep clock-dependent systems active; an effective grounded pose can omit idle frames. */
    idleFrameNeeded() {
      if (gate !== 'open') return true
      if (idleCheck?.preview === preview) return idleCheck.needed
      const { state } = preview, { player, tick } = state
      const pendingClock = !Number.isSafeInteger(tick) || tick < 0
        || !Number.isSafeInteger(tick + 1)
        || !player.tradeSlots.every((slot) => slot.itemId === null
          && slot.quantity === 0 && slot.unitPrice === 0)
        || !state.mireglass.herbHarvestCycles.every((entry) =>
          entry.cycle < Math.floor(tick / HERB_CYCLE_TICKS))
        || !state.highland.stoneNodes.every((node) => node.readyAtTick <= tick)
        || !Number.isSafeInteger(state.windstep.activeUntilTick)
        || !Number.isSafeInteger(state.windstep.nextCastTick)
        || state.windstep.activeUntilTick > tick || state.windstep.nextCastTick > tick
      const needed = pendingClock || !grounded(preview)
      idleCheck = { preview, needed }
      return needed
    },
    advanceFrame(intents: readonly PublicWorldIntent[], walkRequested: boolean) {
      if (gate !== 'open') return rejectedFrame(intents, 'unavailable_here',
        'Movement is paused for a checked write.')
      if (pending.length >= PUBLIC_V14_MAX_FRAME_BATCH) return rejectedFrame(intents,
        'unavailable_here', 'Checkpoint the recorded frames before moving.')
      const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1',
        frames: [{ intents: guideNorthLadderInput(preview, intents), walkRequested }] })
      if (!witness) return rejectedFrame(intents, 'invalid_frame', 'Invalid replayable frame.')
      let frame = witness.frames[0]
      const origin = flight?.origin ?? preview
      let flightFrames = flight ? [...flight.frames, frame] : witness.frames
      let next = flight ? previewFrames(origin, flightFrames)
        : replay(preview, witness)
          ?? previewFrames(origin, flightFrames)
      if (!next && !flight) {
        const corner = checkedDryCornerStride(preview, frame, replay)
        if (corner) { frame = corner.frame; next = corner.next; flightFrames = [frame] }
      }
      if (!next) return rejectedFrame(intents, 'terrain_missing',
        blockedMoveMessage(frame))
      pending = [...pending, frame]
      flight = grounded(next) ? null : { origin, frames: flightFrames }
      preview = next
      return { events: [] as readonly PublicWorldEvent[],
        rejections: [] as readonly PublicWorldRejection[] }
    },
    async save(): Promise<Outcome> {
      if (gate === 'blocked') return { status: 'blocked', reason: blockedReason! }
      if (gate !== 'open') return { status: 'busy' }
      gate = 'checkpointing'
      const result = await flush()
      if (blockedReason === null) gate = 'open'
      return result
    },
    async returnHome(): Promise<Outcome> {
      if (gate === 'blocked') return { status: 'blocked', reason: blockedReason! }
      if (gate !== 'open') return { status: 'busy' }
      gate = 'barrier'
      const saved = await flush()
      if (saved.status === 'blocked') return saved
      if (saved.status === 'deferred-airborne' || !grounded(preview)) {
        gate = 'open'; return { status: 'deferred-airborne' }
      }
      if (!returnHomeWrite) { gate = 'open'; return { status: 'rejected', reason: 'return-home-unavailable' } }
      const revision = committed.head.saveRevision, before = progress(committed)
      let reply: PublicV26Operation<S>
      try { reply = await returnHomeWrite(revision, structuredClone(committed.lineage)) }
      catch { return freeze('storage-error') }
      if (!reply.ok) {
        if (reply.reason === 'not_trapped' || reply.reason === 'cooldown') {
          gate = 'open'; return { status: 'rejected', reason: reply.reason }
        }
        return freeze(reply.reason)
      }
      const witness = decodePublicV26Witness(reply.value?.head?.witness)
      if (witness?.kind !== 'return-home/v1'
        || !samePublicV14Value(reply.value.head.witness, witness)) return freeze('writer-mismatch')
      const expected = replay(before, witness)
      if (!expected) return freeze('writer-mismatch')
      const result = acceptCheckedReply(reply.value, revision, witness, expected)
      if (blockedReason === null) gate = 'open'
      return result
    },
    async action(rawAction: Action): Promise<Outcome> {
      if (gate === 'blocked') return { status: 'blocked', reason: blockedReason! }
      if (gate !== 'open') return { status: 'busy' }
      gate = 'barrier'
      const saved = await flush()
      if (saved.status === 'blocked') return saved
      if (saved.status === 'deferred-airborne') { gate = 'open'; return saved }
      const witness = decodePublicV26Witness(rawAction)
      if (!witness || witness.kind === 'frame-batch/v1' || witness.kind === 'checkpoint'
        || witness.kind === 'return-home/v1') {
        gate = 'open'; return { status: 'rejected', reason: 'invalid-action' }
      }
      const before = progress(committed)
      const candidate = replay(before, witness)
      if (!candidate) {
        const reason = witness.kind === 'terrain-action/v1'
          ? applyPublicV26TerrainAction(before, witness.action).rejection ?? 'action-rejected'
          : witness.kind === 'pit-ladder/v1'
            ? applyPublicV26PitLadderAction(before, witness.action).rejection ?? 'action-rejected'
          : 'action-rejected'
        gate = 'open'; return { status: 'rejected', reason }
      }
      let events: readonly Event[] = emptyEvents
      if (witness.kind === 'mireglass-action/v1') {
        const effect = applyPublicV24MireglassAction(old(before), witness.action)
        if ('rejection' in effect) { gate = 'open'; return { status: 'rejected',
          reason: effect.rejection ?? 'action-rejected' } }
        if (!samePublicV14Value(effect.progress, old(candidate))) return freeze('local-action-events')
        events = effect.events
      } else if (witness.kind !== 'terrain-action/v1' && witness.kind !== 'pit-ladder/v1') {
        const effect = applyPublicV23Witness(old(before), witness)
        if ('rejection' in effect) { gate = 'open'; return { status: 'rejected', reason: effect.rejection } }
        if (!samePublicV14Value(effect.progress, old(candidate))) return freeze('local-action-events')
        events = effect.events
      }
      const result = await checkedWrite(witness, candidate, events)
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
        logsSpent: itemCount(before, 'logs') - itemCount(candidate, 'logs'),
        stoneGained: itemCount(candidate, 'stone') - itemCount(before, 'stone'),
        xp: candidate.state.player.xp - before.state.player.xp } : undefined
      return workEvent ? { ...result, workEvent } : result
    },
  }
}

export function createPublicV26ControllerRuntime(initial: PublicV26Start,
  write: Writer<PublicV26Start>, returnHomeWrite?: ReturnHomeWriter<PublicV26Start>) {
  return createCheckedControllerRuntime(initial, write, returnHomeWrite)
}

export function createPublicV27ControllerRuntime(initial: PublicV27Start,
  write: Writer<PublicV27Start>, returnHomeWrite?: ReturnHomeWriter<PublicV27Start>) {
  return createCheckedControllerRuntime(initial, write, returnHomeWrite, true)
}
