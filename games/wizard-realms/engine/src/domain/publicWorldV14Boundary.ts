import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { publicV11Gait } from './publicWorldGait'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { validatePublicV14State } from './publicWorldV14Validation'
import type { PublicV17GroundStepPolicy } from './publicWorldV17StarterMovement'
import { starterCliffAdvanceMove, starterCliffPoseValid } from './starterCliffMovement'
import { starterCliffWorldTileAtGrid } from './starterCliffWorld'
import { settleTradeListings, stepRng } from './world'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

type Point = Readonly<{ x: number; z: number }>
export type PublicV14BoundaryResult =
  | Readonly<{ candidate: PublicV14State; events: readonly PublicWorldEvent[]; rejections: readonly [] }>
  | Readonly<{ candidate: null; events: readonly []; rejections: readonly PublicWorldRejection[] }>

/** Canonical 16 by 16 A Greenway centers span -28..32; half-cell owner edges are inclusive. */
export function publicV14InsideGreenway(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z)
    && point.x >= -30 && point.x <= 34 && point.z >= -30 && point.z <= 34
}

const cellAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)

/** At most one 4 m cell edge per axis in a 0.24 m step, including diagonal corner side cells. */
function touchesWetland(seed: string, from: Point, to: Point): boolean {
  const dx = to.x - from.x, dz = to.z - from.z
  const fromX = cellAt(from.x), toX = cellAt(to.x)
  const fromZ = cellAt(from.z), toZ = cellAt(to.z)
  const wet = (gx: number, gz: number) =>
    starterCliffWorldTileAtGrid(seed, gx, gz).terrain === 'wetland'
  if (wet(fromX, fromZ) || wet(toX, toZ)) return true
  const xCut = fromX !== toX ? ((Math.min(fromX, toX) + 0.5) * WORLD_CELL_METERS - from.x) / dx : null
  const zCut = fromZ !== toZ ? ((Math.min(fromZ, toZ) + 0.5) * WORLD_CELL_METERS - from.z) / dz : null
  const cuts = [0, 1, xCut, zCut].filter((t): t is number => t !== null && t > 0 && t < 1)
    .sort((a, b) => a - b)
  for (let index = 1; index < cuts.length; index++) {
    const t = (cuts[index - 1] + cuts[index]) / 2
    if (wet(cellAt(from.x + dx * t), cellAt(from.z + dz * t))) return true
  }
  return xCut !== null && zCut !== null && Math.abs(xCut - zCut) <= 1e-12
    && xCut >= 0 && xCut <= 1 && (wet(fromX, toZ) || wet(toX, fromZ))
}

/** One grounded, pure owner transition. The caller keeps its old head on rejection. */
export function advancePublicV14BoundaryFrame(current: PublicV14State,
  intents: readonly PublicWorldIntent[], options: { walkRequested: boolean },
  policy?: PublicV17GroundStepPolicy): PublicV14BoundaryResult {
  const reject = (index: number, code: PublicWorldRejection['code'], message: string): PublicV14BoundaryResult => ({
    candidate: null, events: [], rejections: [{ intentIndex: index,
      intentType: intents?.[index]?.type ?? 'move', code, message }],
  })
  if (!Array.isArray(intents) || intents.length < 1 || intents.length > 2
    || intents.length === 2 && (intents[0]?.type !== 'look' || intents[1]?.type !== 'move')
    || intents[intents.length - 1]?.type !== 'move'
    || typeof options?.walkRequested !== 'boolean') return reject(0, 'invalid_frame',
    'A boundary frame requires one move, optionally preceded by a look.')
  const moveIndex = intents.length - 1
  const move = intents[moveIndex] as Extract<PublicWorldIntent, { type: 'move' }>
  const { x: dx, z: dz, y = 0 } = move.delta ?? {}
  const from = current.player.position
  const to = { x: from.x + dx, z: from.z + dz }
  const limit = publicV11Gait(current.player.equipment.feet, options.walkRequested).metersPerStep
  if (![dx, dz, y, to.x, to.z].every(Number.isFinite)
    || y !== 0 || Math.hypot(dx, dz) > limit + 1e-9) return reject(moveIndex,
    'invalid_value', 'The move exceeds the permitted horizontal gait.')
  if (cellAt(to.x) < WORLD_GRID_MIN || cellAt(to.x) > WORLD_GRID_MAX
    || cellAt(to.z) < WORLD_GRID_MIN || cellAt(to.z) > WORLD_GRID_MAX) {
    return reject(moveIndex, 'out_of_bounds', 'The destination is outside the streamed world.')
  }
  const sourceInside = publicV14InsideGreenway(from)
  if (sourceInside === publicV14InsideGreenway(to)
    || current.movementOwner !== (sourceInside ? 'greenway' : 'streamed')) {
    return reject(moveIndex, 'unavailable_here', 'This frame does not cross the v14 owner boundary.')
  }
  const look = intents.length === 2
    ? intents[0] as Extract<PublicWorldIntent, { type: 'look' }> : null
  const yaw = current.player.yaw + (look?.yawDelta ?? 0)
  const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2,
    current.player.pitch + (look?.pitchDelta ?? 0)))
  if (look && (![look.yawDelta, look.pitchDelta, yaw].every(Number.isFinite)
    || Math.abs(yaw) > 1e6)) return reject(0, 'invalid_value', 'The look is not finite or bounded.')
  const context = { seed: current.seed, profile: current.generationProfile,
    route: current.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: current.greenway.builtRouteIds.includes('greenway_ladder') }
  if (!starterCliffPoseValid(context, from, current.player.verticalVelocity)) {
    return reject(moveIndex, 'airborne', 'Land on ordinary ground before changing regions.')
  }
  const advanced = starterCliffAdvanceMove(context, from, to, 0, policy)
  if (!advanced.accepted) return reject(moveIndex,
    advanced.reason === 'world_edge' ? 'out_of_bounds'
      : advanced.reason === 'cliff_blocked' ? 'locked_area'
        : advanced.reason === 'off_ladder' ? 'off_connector' : 'invalid_value',
    'The crossing has no valid starter-cliff support.')
  try {
    if (touchesWetland(current.seed, from, to)) return reject(moveIndex,
      'terrain_missing', 'The crossing touches unsupported wetland.')
    const tick = current.tick + 1
    const revealed = nearbyWorldTileIds(advanced.position, PUBLIC_WALK_REVEAL_RADIUS_METERS)
      .filter((id) => !discoveryMaskHasTileId(current.discoveryMask, id))
    const frameEvents = (look ? 1 : 0) + 1 + revealed.length
    if (!Number.isSafeInteger(tick)
      || !Number.isSafeInteger(current.eventSequence + frameEvents + 4)) {
      return reject(moveIndex, 'invalid_value', 'The boundary clock or event sequence is exhausted.')
    }
    const mask = revealed.length ? new Uint8Array(current.discoveryMask) : current.discoveryMask
    if (revealed.length) {
      const bits = encodeDiscoveredTileIds(revealed)
      for (let index = 0; index < mask.length; index++) mask[index] |= bits[index]
    }
    let sequence = current.eventSequence
    const events: PublicWorldEvent[] = []
    if (look) events.push({ type: 'player_looked', tick, sequence: ++sequence, yaw, pitch })
    events.push({ type: 'player_moved', tick, sequence: ++sequence,
      position: { ...advanced.position } })
    for (const tileId of revealed) events.push({ type: 'tile_discovered', tick,
      sequence: ++sequence, tileId })
    const player = { ...current.player, position: { ...advanced.position },
      yaw, pitch, verticalVelocity: 0 }
    const sale = settleTradeListings(player, tick, sequence)
    events.push(...sale.events)
    const candidate: PublicV14State = { ...current,
      movementOwner: sourceInside ? 'streamed' : 'greenway', tick,
      rng: { ...current.rng, simulation: stepRng(current.rng.simulation) },
      eventSequence: sale.eventSequence, discoveryMask: mask, player: sale.player }
    const checked = validatePublicV14State(candidate, current.seed)
    return checked ? { candidate: checked, events, rejections: [] }
      : reject(moveIndex, 'terrain_missing', 'The receiving owner rejected this crossing.')
  } catch { return reject(moveIndex, 'terrain_missing', 'The crossing terrain could not be resolved.') }
}
