import { decodePublicV14FrameWitness, PUBLIC_V14_MAX_FRAME_BATCH } from './publicWorldV14Snapshot'
import type { PublicV14Frame } from './publicWorldV14Snapshot'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { decodePublicV23Progress } from './publicWorldV23Snapshot'
import { visitPublicV23FramesWithEvents } from './publicWorldV23Transitions'
import type { PublicV24Progress } from './publicWorldV24Snapshot'
import { publicV25RiverTouchesSegment } from './publicWorldV25RiverSweep'
import { publicV26SavedLadderSpans } from './publicWorldV26Snapshot'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { publicV26ValleyRimPassage } from './publicWorldV26ValleyRim'
import { replayPublicV27FramesWithEvents } from './publicWorldV27Snapshot'
import type { PublicV28Progress } from './publicWorldV28Migration'
import { publicV28AdjacentBankSeam, publicV28RiverPassage } from './publicWorldV28RiverPassage'
import { projectPublicV28Pose, publicV28ResolvedRiverBridges,
  publicV28RiverBridgeFloorAt } from './publicWorldV28RiverSupport'
import type { PublicWorldEvent } from './publicWorldRuntime'
import { WORLD_CELL_METERS } from './worldChunks'

const movementPolicy = { maxOrdinaryGroundStepMeters: 0.8 } as const
const LANDING_RESERVE_FRAMES = 32
type BufferedFlight = { origin: PublicV24Progress; frames: PublicV14Frame[]; eventCount: number }
const oldProgress = ({ state, greenwayWorks, regionalWorks }: PublicV28Progress): PublicV24Progress =>
  ({ state, greenwayWorks, regionalWorks })

function groundedDeckCarrier(before: PublicV24Progress, after: PublicV24Progress,
  terrain: PublicV28Progress['terrain'], riverBridgeIds: readonly string[]):
  PublicV24Progress | null {
  const { state } = after, player = state.player
  if (state.movementOwner !== 'streamed' || player.verticalVelocity >= 0
    || player.verticalVelocity < -0.5) return null
  const point = player.position
  const floor = resolvePublicV23Surface(state, point, after.regionalWorks.builtLadderIds)
  const sites = publicV28ResolvedRiverBridges(state.seed, riverBridgeIds)
  const adjacent = publicV28AdjacentBankSeam(before, terrain, riverBridgeIds,
    before.state.player.position, point)
  if (!floor || floor.support !== 'terrain' || !sites
    || Math.abs(point.y - floor.floorY) > 0.03 && adjacent?.direction !== 'outward') return null
  let supporting = sites.filter((site) => site.wetGapTileIds.includes(floor.tileId)
    && publicV28RiverBridgeFloorAt(site, point) !== null)
  if (!supporting.length) {
    // Only the saved bridge's wet-to-dry edge or its immediate dry exit may
    // settle a transient fall. Other dry steps retain V23's rejection.
    const from = before.state.player.position
    const fromFloor = resolvePublicV23Surface(before.state, from, before.regionalWorks.builtLadderIds)
    const groundedBefore = before.state.player.verticalVelocity === 0 && fromFloor
      && Math.abs(from.y - fromFloor.floorY) <= 1e-6
    const fromPose = groundedBefore && projectPublicV28Pose(before, terrain, riverBridgeIds)
    const toPose = groundedBefore && projectPublicV28Pose(after, terrain, riverBridgeIds)
    const noPit = fromPose && toPose && !terrain.columns.some((column) => column.openDepth > 0
      && (column.gx === fromPose.cell.gx && column.gz === fromPose.cell.gz
        || column.gx === toPose.cell.gx && column.gz === toPose.cell.gz))
    supporting = sites.filter((site) => {
      if (!noPit || !fromFloor) return false
      if (from.z > point.z) return fromFloor.tileId === site.wetGapTileIds[0]
        && floor.tileId === site.footprintTileIds[1]
        && Math.abs(from.x - site.from.x) <= site.widthMeters / 2
        && Math.abs(point.x - site.from.x) <= site.widthMeters / 2
        && fromFloor.floorY - floor.floorY > 1e-6
        && fromFloor.floorY - floor.floorY <= 0.03
        && fromPose.bridgeId === site.id && toPose.bridgeId === site.id
      if (from.z >= point.z
        || Math.abs(from.x - site.to.x) > site.widthMeters / 2
        || Math.abs(point.x - site.to.x) > site.widthMeters / 2) return false
      if (fromFloor.tileId === site.wetGapTileIds.at(-1)
        && floor.tileId === site.footprintTileIds.at(-2))
        return fromPose.bridgeId === site.id && toPose.bridgeId === site.id
      return fromFloor.tileId === site.footprintTileIds.at(-2)
        && floor.tileId === site.footprintTileIds.at(-1)
        && fromPose.support === 'terrain' && toPose.support === 'terrain'
        && Math.abs(fromPose.effective.floorY - fromPose.carrier.floorY) <= 1e-6
        && Math.abs(toPose.effective.floorY - toPose.carrier.floorY) <= 1e-6
    })
  }
  if (supporting.length !== 1) return null
  return { ...after, state: { ...state, player: { ...player,
    position: { ...point, y: floor.floorY }, verticalVelocity: 0 } } }
}

/** V28-only gate. V27's private visitor starts with the V25 river check and cannot admit this deck. */
function acceptsSegment(before: PublicV24Progress, after: PublicV24Progress,
  terrain: PublicV28Progress['terrain'], riverBridgeIds: readonly string[],
  passageTo = after.state.player.position): boolean {
  const from = before.state.player.position, to = after.state.player.position
  const start = projectPublicV28Pose(before, terrain, riverBridgeIds)
  const end = projectPublicV28Pose(after, terrain, riverBridgeIds)
  if (!start || !end) return false
  if (from.x !== to.x || from.z !== to.z) {
    const spans = publicV26SavedLadderSpans(before)
    if (!spans || !publicV28RiverPassage(before, terrain, riverBridgeIds, from, passageTo).ok
      || !publicV26ValleyRimPassage(before.state.seed, from, to, spans).ok) return false
  }
  const heightChange = end.effective.floorY - start.effective.floorY
  const pit = start.effective.floorY < start.carrier.floorY - 1e-6
    || end.effective.floorY < end.carrier.floorY - 1e-6
  if (pit) {
    if (Math.abs(heightChange) <= 0.55 + 1e-6) return true
    return Math.abs(end.carrier.floorY - start.carrier.floorY) <= 0.55 + 1e-6
      && (start.cell.gx !== end.cell.gx || start.cell.gz !== end.cell.gz)
      && [start, end].some((pose) => pose.effective.floorY < pose.carrier.floorY - 1e-6
        && terrain.columns.some((column) => column.gx === pose.cell.gx
          && column.gz === pose.cell.gz && column.openDepth > 0 && column.pitLadder))
  }
  const ordinary = (start.support === 'ground' || start.support === 'terrain')
    && (end.support === 'ground' || end.support === 'terrain')
  if (Math.abs(heightChange) <= (ordinary ? movementPolicy.maxOrdinaryGroundStepMeters : 0.55) + 1e-6)
    return true
  return start.support === 'ladder' || end.support === 'ladder'
    || start.support === 'bridge' || end.support === 'bridge'
}

/** V23's terminal dry settlement is only valid on its original terrain carrier. */
function dryBaseSegment(before: PublicV24Progress, after: PublicV24Progress,
  terrain: PublicV28Progress['terrain'], riverBridgeIds: readonly string[]): boolean {
  const from = before.state.player.position, to = after.state.player.position
  const start = projectPublicV28Pose(before, terrain, riverBridgeIds)
  const end = projectPublicV28Pose(after, terrain, riverBridgeIds)
  const grid = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
  const minGX = Math.min(grid(from.x), grid(to.x)), maxGX = Math.max(grid(from.x), grid(to.x))
  const minGZ = Math.min(grid(from.z), grid(to.z)), maxGZ = Math.max(grid(from.z), grid(to.z))
  return start?.support === 'terrain' && end?.support === 'terrain'
    && Math.abs(start.effective.floorY - start.carrier.floorY) <= 1e-6
    && Math.abs(end.effective.floorY - end.carrier.floorY) <= 1e-6
    && !publicV25RiverTouchesSegment(before.state.seed, from, to)
    && !terrain.columns.some((column) => column.openDepth > 0
      && column.gx >= minGX && column.gx <= maxGX
      && column.gz >= minGZ && column.gz <= maxGZ)
}

/** Flight buffering follows checked support and coverage, not a particular support label. */
function bufferedFlightSegment(before: PublicV24Progress, after: PublicV24Progress,
  terrain: PublicV28Progress['terrain'], riverBridgeIds: readonly string[]): boolean {
  if (before.state.movementOwner !== after.state.movementOwner) return false
  const from = before.state.player.position, to = after.state.player.position
  const start = projectPublicV28Pose(before, terrain, riverBridgeIds)
  const end = projectPublicV28Pose(after, terrain, riverBridgeIds)
  if (!start || !end
    || start.effective.floorY < start.carrier.floorY - 1e-6
    || end.effective.floorY < end.carrier.floorY - 1e-6) return false
  const grid = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
  const minGX = Math.min(grid(from.x), grid(to.x)), maxGX = Math.max(grid(from.x), grid(to.x))
  const minGZ = Math.min(grid(from.z), grid(to.z)), maxGZ = Math.max(grid(from.z), grid(to.z))
  if (terrain.columns.some((column) => column.openDepth > 0
    && column.gx >= minGX && column.gx <= maxGX
    && column.gz >= minGZ && column.gz <= maxGZ)) return false
  return !publicV25RiverTouchesSegment(before.state.seed, from, to)
    || start.bridgeId !== null && start.bridgeId === end.bridgeId
}

/** A jump-led flight has one V23 session; collect its frames once instead of replaying every prefix. */
function replayJumpFlight(before: PublicV28Progress, frames: readonly PublicV14Frame[],
  terrain: PublicV28Progress['terrain'],
  allowAirborne: boolean): { progress: PublicV28Progress;
    events: readonly PublicWorldEvent[]; flight: BufferedFlight | null } | null {
  if (frames[0]?.intents[0]?.type !== 'jump') return null
  const states: PublicV24Progress[] = []
  const first = { previous: null as PublicV24Progress | null }
  const trial = visitPublicV23FramesWithEvents(oldProgress(before), frames,
    (previous, next) => { first.previous ??= previous; states.push(next); return true }, true, movementPolicy)
  const old = first.previous
  if (!trial || !old || states.length !== frames.length
    || !projectPublicV28Pose(old, terrain, before.riverBridgeIds)) return null
  let current = old, airborneBefore = false
  for (const [index, candidate] of states.entries()) {
    const airborne = candidate.state.player.verticalVelocity !== 0
    if (!airborneBefore && airborne
      && groundedDeckCarrier(current, candidate, terrain, before.riverBridgeIds)) return null
    if ((airborneBefore || airborne)
      && !bufferedFlightSegment(current, candidate, terrain, before.riverBridgeIds)) return null
    if (airborneBefore && !airborne && index < states.length - 1) return null
    const checked = allowAirborne || airborne && index < states.length - 1
      ? candidate : decodePublicV23Progress(candidate, old.state.seed)
    if (!checked || !acceptsSegment(current, checked, terrain, before.riverBridgeIds,
      candidate.state.player.position)) return null
    current = checked
    airborneBefore = airborne
  }
  if (!projectPublicV28Pose(current, terrain, before.riverBridgeIds)) return null
  return { progress: { ...current, terrain, nextHomeAtMs: before.nextHomeAtMs,
    riverBridgeIds: [...before.riverBridgeIds] }, events: trial.events,
  flight: airborneBefore ? { origin: old, frames: [...frames], eventCount: trial.events.length } : null }
}

/** Authoritative frame events and movement replay share one checked V28 visitor. */
function replayCheckedFrames(before: PublicV28Progress,
  frames: readonly PublicV14Frame[], allowAirborne = false):
  { progress: PublicV28Progress; events: readonly PublicWorldEvent[];
    flight: BufferedFlight | null } | null {
  try {
    if (Array.isArray(before.riverBridgeIds) && before.riverBridgeIds.length === 0) {
      const inherited = replayPublicV27FramesWithEvents(before, frames, allowAirborne)
      return inherited ? { progress: { ...inherited.progress, riverBridgeIds: [] },
        events: inherited.events, flight: null } : null
    }
    const terrain = decodePublicV26TerrainLedger(before.terrain)
    const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames })
    if (!terrain || !witness || !Number.isSafeInteger(before.nextHomeAtMs)
      || before.nextHomeAtMs < 0) return null
    const jumpFlight = replayJumpFlight(before, witness.frames, terrain, allowAirborne)
    if (jumpFlight) return jumpFlight
    let current: PublicV24Progress | null = null
    let flight: BufferedFlight | null = null
    const events: PublicWorldEvent[] = []
    const first = { previous: null as PublicV24Progress | null }
    const captureFirstPrevious = (previous: PublicV24Progress) => {
      first.previous ??= previous
      return true
    }
    for (const [frameIndex, frame] of witness.frames.entries()) {
      // The V23 trial can leave a transient falling carrier when entering wet
      // ground from a higher dry bank. A saved deck supports a ground step, but
      // V28 still stores the canonical old-floor carrier, never deck Y.
      const priorFlight = flight as BufferedFlight | null
      const flightFrames: PublicV14Frame[] = priorFlight ? [...priorFlight.frames, frame] : [frame]
      const trial = visitPublicV23FramesWithEvents(priorFlight?.origin ?? current ?? oldProgress(before),
        flightFrames, captureFirstPrevious, true, movementPolicy)
      if (!trial) return null
      if (!current) {
        if (!first.previous || !projectPublicV28Pose(first.previous, terrain, before.riverBridgeIds)) return null
        current = first.previous
      }
      let candidate = trial.progress
      if (!priorFlight && candidate.state.player.verticalVelocity !== 0)
        candidate = groundedDeckCarrier(current, candidate, terrain, before.riverBridgeIds) ?? candidate
      const deckSnapped = candidate !== trial.progress
      // Keep the airborne trial for saved deck seams. Only an otherwise
      // undecodable, entirely dry fall may retry V23's durable settlement.
      let dryRetry: ReturnType<typeof visitPublicV23FramesWithEvents> = null
      if (!priorFlight && !allowAirborne && !deckSnapped && candidate.state.player.verticalVelocity < 0
        && !decodePublicV23Progress(candidate, current.state.seed)
        && dryBaseSegment(current, trial.progress, terrain, before.riverBridgeIds))
        dryRetry = visitPublicV23FramesWithEvents(current, [frame], () => true, false, movementPolicy)
      if (dryRetry) candidate = dryRetry.progress
      const airborne = candidate.state.player.verticalVelocity !== 0
      const bufferedFlight: boolean = !deckSnapped && (priorFlight !== null || airborne)
        && bufferedFlightSegment(current, candidate, terrain, before.riverBridgeIds)
      if ((priorFlight || airborne) && !bufferedFlight) return null
      const checked: PublicV24Progress | null = allowAirborne || airborne && bufferedFlight
        && frameIndex < witness.frames.length - 1
        ? candidate : decodePublicV23Progress(candidate, current.state.seed)
      if (!checked || !acceptsSegment(current, checked, terrain, before.riverBridgeIds,
        trial.progress.state.player.position)) return null
      const frameEvents = [...(dryRetry?.events ?? trial.events).slice(priorFlight?.eventCount ?? 0)]
      flight = airborne && bufferedFlight ? { origin: priorFlight?.origin ?? current,
        frames: flightFrames, eventCount: trial.events.length } : null
      current = checked
      if (deckSnapped) {
        let moved = frameEvents.length - 1
        while (moved >= 0 && frameEvents[moved].type !== 'player_moved') moved--
        if (moved < 0) return null
        const event = frameEvents[moved]
        if (event.type === 'player_moved') frameEvents[moved] = {
          ...event, position: { ...checked.state.player.position } }
      }
      events.push(...frameEvents)
    }
    return current && projectPublicV28Pose(current, terrain, before.riverBridgeIds)
      ? { progress: { ...current, terrain, nextHomeAtMs: before.nextHomeAtMs,
        riverBridgeIds: [...before.riverBridgeIds] }, events, flight } : null
  } catch { return null }
}

/** An accepted airborne preview must have an in-batch idle path to checked landing. */
export function replayPublicV28FramesWithEvents(before: PublicV28Progress,
  frames: readonly PublicV14Frame[], allowAirborne = false):
  { progress: PublicV28Progress; events: readonly PublicWorldEvent[] } | null {
  const result = replayCheckedFrames(before, frames, allowAirborne)
  if (!result) return null
  const { flight, ...publicResult } = result
  if (!allowAirborne || !flight) return publicResult
  const reserve = Math.min(LANDING_RESERVE_FRAMES, PUBLIC_V14_MAX_FRAME_BATCH - frames.length)
  if (reserve < 1) return null
  const idle = Array.from({ length: reserve }, () => ({ intents: [], walkRequested: false }))
  // The accepted flight prefix already passed every V28 segment gate. An idle
  // suffix stays at that same checked XZ support; V23 must prove its landing.
  const landed = visitPublicV23FramesWithEvents(flight.origin, [...flight.frames, ...idle],
    () => true, false, movementPolicy)
  return landed && projectPublicV28Pose(landed.progress, result.progress.terrain,
    result.progress.riverBridgeIds) ? publicResult : null
}
