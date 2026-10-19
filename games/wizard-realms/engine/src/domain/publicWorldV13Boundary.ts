import { createActiveWorldTerrain } from './activeWorldTerrain'
import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { highlandRidgeMoveBarrier } from './highlandRidge'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { discoveredTileIdsInActiveWindow } from './publicV13DiscoveryWindow'
import { createPublicV11RouteSupport } from './publicV11RouteSupport'
import { legacyMovementEnvelope } from './publicWorldV6'
import { publicV13GreenwayWitness } from './publicWorldV13GreenwayFrame'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { publicV11Gait } from './publicWorldGait'
import type { PublicV13Start } from './publicWorldV13Flow'
import { decodePublicV13Head, decodePublicV13SourceLineage, PUBLIC_V13_SCHEMA } from './publicWorldV13Snapshot'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import { advancePublicGreenwayReturnStep } from './publicWorldRuntime'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'
import type { PublicWorldV11State } from './publicWorldV11State'
import type { StreamedWorldIntent } from './streamedWorld'
import { createStreamedWorldV13FromState, createTerrainWorkRuntimeHooks } from './terrainWorkRuntimeHooks'
import { terrainWorkSupportAt } from './terrainWorkSupport'
import { resolveTerrainWorkSite } from './terrainWorks'
import type { TerrainWorkSite } from './terrainWorks'
import { settleTradeListings } from './world'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

type State = PublicV13Head['state']
type Built = Exclude<TerrainWorkSite, { kind: 'dig' }>
type BoundaryResult = Readonly<{ candidate: State; events: readonly PublicWorldEvent[];
  rejections: readonly [] }> | Readonly<{ candidate: null; events: readonly [];
  rejections: readonly PublicWorldRejection[] }>

const cellAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
const simulationRngStep = (value: number) => {
  let next = value | 0
  next ^= next << 13
  next ^= next >>> 17
  next ^= next << 5
  return next >>> 0 || 1
}

/** Same corner-complete wetland sweep as the legacy crossing, except a built deck is ground. */
function wetSegment(state: State, from: { x: number; z: number }, to: { x: number; z: number },
  envelope: ReturnType<typeof legacyMovementEnvelope>, built: readonly Built[],
  routeSupport: ReturnType<typeof createPublicV11RouteSupport>): boolean {
  const wetAt = (x: number, z: number) => {
    const gridWet = worldTileAtGrid(state.seed, cellAt(x), cellAt(z)).terrain === 'wetland'
    const legacyWet = x >= envelope.minX && x <= envelope.maxX
      && z >= envelope.minZ && z <= envelope.maxZ
      && state.greenway.tiles.reduce((closest, candidate) =>
        Math.hypot(x - candidate.center.x, z - candidate.center.z)
          < Math.hypot(x - closest.center.x, z - closest.center.z) ? candidate : closest).terrain === 'wetland'
    if (!gridWet && !legacyWet) return false
    return !built.some((site) => site.kind === 'bridge'
      && terrainWorkSupportAt(site, { x, z }).floorY !== null)
      && routeSupport.at({ x, z })?.route.kind !== 'fen_bridge'
  }
  if (wetAt(from.x, from.z) || wetAt(to.x, to.z)) return true
  const dx = to.x - from.x, dz = to.z - from.z
  const cuts = [0, 1]
  const gridCuts: [Array<{ t: number; grid: number }>, Array<{ t: number; grid: number }>] = [[], []]
  for (const [axis, start, delta, min, max] of [
    [0, from.x, dx, envelope.minX, envelope.maxX],
    [1, from.z, dz, envelope.minZ, envelope.maxZ],
  ] as const) {
    if (delta === 0) continue
    for (let grid = cellAt(Math.min(start, start + delta)) - 1;
      grid <= cellAt(Math.max(start, start + delta)); grid++) {
      const t = (grid * WORLD_CELL_METERS + WORLD_CELL_METERS / 2 - start) / delta
      if (t > 0 && t < 1) { cuts.push(t); gridCuts[axis].push({ t, grid }) }
    }
    for (const edge of [min, max]) {
      const t = (edge - start) / delta
      if (t > 0 && t < 1) cuts.push(t)
    }
  }
  cuts.sort((a, b) => a - b)
  for (let index = 1; index < cuts.length; index++) {
    if (cuts[index] === cuts[index - 1]) continue
    const t = (cuts[index - 1] + cuts[index]) / 2
    if (wetAt(from.x + dx * t, from.z + dz * t)) return true
  }
  for (const xCut of gridCuts[0]) for (const zCut of gridCuts[1]) {
    if (Math.abs(xCut.t - zCut.t) > Number.EPSILON * 16) continue
    const beforeX = xCut.grid + (dx < 0 ? 1 : 0), afterX = xCut.grid + (dx > 0 ? 1 : 0)
    const beforeZ = zCut.grid + (dz < 0 ? 1 : 0), afterZ = zCut.grid + (dz > 0 ? 1 : 0)
    if (wetAt(beforeX * WORLD_CELL_METERS, afterZ * WORLD_CELL_METERS)
      || wetAt(afterX * WORLD_CELL_METERS, beforeZ * WORLD_CELL_METERS)) return true
  }
  return false
}

/** Pure, unmounted outbound frame. The base revision is never advanced or written here. */
export function advancePublicV13OutboundBoundary(base: PublicV13Start, current: State,
  intents: readonly PublicWorldIntent[], options: { walkRequested: boolean }): BoundaryResult {
  const reject = (index: number, code: PublicWorldRejection['code'], message: string): BoundaryResult => ({
    candidate: null, events: [], rejections: [{ intentIndex: index,
      intentType: (Array.isArray(intents) ? intents[index]?.type : undefined) ?? 'move', code, message }],
  })
  const lineage = decodePublicV13SourceLineage(base?.sourceLineage)
  const checkedBase = lineage && decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: base.saveRevision, bootstrap: base.bootstrap, state: base.state }, lineage)
  if (!checkedBase || !Number.isSafeInteger(base.saveRevision + 1)
    || typeof options?.walkRequested !== 'boolean') throw new RangeError('Invalid v13 boundary base.')
  const state = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: base.saveRevision, bootstrap: base.bootstrap, state: current }, lineage)
    ?? decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
      saveRevision: base.saveRevision + 1, bootstrap: base.bootstrap, state: current }, lineage)
  if (!state || state.state.movementOwner !== 'greenway') {
    return reject(0, 'unavailable_here', 'Boundary requires a checked Greenway origin.')
  }
  if (!Array.isArray(intents) || intents.length < 1 || intents.length > 2
    || intents.length === 2 && (intents[0]?.type !== 'look' || intents[1]?.type !== 'move')
    || intents[intents.length - 1]?.type !== 'move') {
    return reject(Array.isArray(intents) ? Math.max(0, Math.min(1, intents.length - 1)) : 0, 'invalid_frame',
      'A boundary frame accepts one move, optionally preceded by one look.')
  }
  const move = intents[intents.length - 1] as Extract<PublicWorldIntent, { type: 'move' }>
  const moveIndex = intents.length - 1
  const from = state.state.player.position
  const { x: dx, z: dz, y = 0 } = move.delta ?? {}
  const limit = publicV11Gait(state.state.player.equipment.feet, options.walkRequested).metersPerStep
  if (![dx, dz, y].every(Number.isFinite) || y !== 0 || Math.hypot(dx, dz) > limit + 1e-9) {
    return reject(moveIndex, 'invalid_value', 'The move exceeds the permitted horizontal gait.')
  }
  const to = { x: from.x + dx, z: from.z + dz }
  const envelope = legacyMovementEnvelope({ generationProfile: state.state.generationProfile,
    tiles: state.state.greenway.tiles })
  const inside = (point: { x: number; z: number }) => point.x >= envelope.minX
    && point.x <= envelope.maxX && point.z >= envelope.minZ && point.z <= envelope.maxZ
  if (!inside(from) || inside(to)) return reject(moveIndex, 'unavailable_here',
    'This frame does not cross outward from Greenway.')
  const look = intents.length === 2 ? intents[0] as Extract<PublicWorldIntent, { type: 'look' }> : null
  const yaw = state.state.player.yaw + (look?.yawDelta ?? 0)
  const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2,
    state.state.player.pitch + (look?.pitchDelta ?? 0)))
  if (look && (![look.yawDelta, look.pitchDelta, yaw].every(Number.isFinite)
    || Math.abs(yaw) > 1e6)) return reject(0, 'invalid_value', 'The turn cannot be applied at this crossing.')
  if (!Number.isSafeInteger(state.state.tick + 1)) return reject(moveIndex,
    'invalid_value', 'The boundary clock or event sequence is exhausted.')
  try {
    const context = { seed: state.state.seed, fieldCampTileIds: state.state.fieldCampTileIds,
      authoredBuiltRouteIds: [state.state.mireglass.builtRoutes.bridge,
        state.state.mireglass.builtRoutes.ladder].filter((id): id is string => id !== null) }
    const built = state.state.terrainWorks.builtWorkIds.map((id) => resolveTerrainWorkSite(state.state.seed, id))
    if (built.some((site) => !site || site.kind === 'dig')) return reject(moveIndex,
      'terrain_missing', 'The built terrain support is unavailable.')
    const sites = built as Built[]
    const dug = new Set(state.state.terrainWorks.dugTileIds)
    const { hooks } = createTerrainWorkRuntimeHooks(() => sites, () => dug)
    const support = createPublicV11RouteSupport({ ...state.state, discoveredTileIds: [] })
    const authored = mireglassMoveBarrier(state.state.seed, from, to)
    const workBarrier = hooks.barrier(from, to, authored)
    const remaining = workBarrier && support.clearsMireglassBarrier(from, to, workBarrier)
      ? null : workBarrier
    const barrier = remaining ?? highlandRidgeMoveBarrier(from, to)
    if (barrier) return reject(moveIndex, barrier, `The ${barrier} blocks the crossing.`)
    if (wetSegment(state.state, from, to, envelope, sites, support)) return reject(moveIndex,
      'terrain_missing', 'The crossing does not stay on dry or supported terrain.')
    const terrain = createActiveWorldTerrain(state.state.seed,
      { cachePitDug: state.state.mireglass.cacheExcavated, highlandRidge: true })
    terrain.activate(to)
    const tile = terrain.tileAtWorld(to.x, to.z)
    if (!tile) return reject(moveIndex, 'terrain_missing', 'The destination terrain is unavailable.')
    const effective = hooks.tile(tile)
    const floor = support.floorY(to, hooks.groundY(to, effective))
    const position = { ...to, y: Math.max(from.y, floor) }
    const revealed = nearbyWorldTileIds(position, PUBLIC_WALK_REVEAL_RADIUS_METERS)
      .filter((id) => !discoveryMaskHasTileId(state.state.discoveryMask, id))
    if (!Number.isSafeInteger(state.state.eventSequence + revealed.length + (look ? 2 : 1) + 4)) {
      return reject(moveIndex, 'invalid_value', 'The boundary event sequence is exhausted.')
    }
    const mask = revealed.length ? new Uint8Array(state.state.discoveryMask) : state.state.discoveryMask
    if (revealed.length) {
      const bits = encodeDiscoveredTileIds(revealed)
      for (let index = 0; index < mask.length; index++) mask[index] |= bits[index]
    }
    const known = [...new Set([...discoveredTileIdsInActiveWindow(mask, position), tile.id])].sort()
    const runtime = createStreamedWorldV13FromState({ seed: state.state.seed, tick: state.state.tick,
      player: { position, yaw, pitch, verticalVelocity: position.y === floor
        ? 0 : state.state.player.verticalVelocity }, discoveredTileIds: known },
    state.state.terrainWorks, context,
    { cachePitDug: state.state.mireglass.cacheExcavated, highlandRidge: true, routeSupport: support })
    const destination = runtime.advance([])
    if (destination.rejections.length) return reject(moveIndex, 'terrain_missing',
      'The destination terrain rejected the crossing.')
    const tick = destination.state.tick
    let sequence = state.state.eventSequence
    const events: PublicWorldEvent[] = []
    if (look) events.push({ type: 'player_looked', tick, sequence: ++sequence, yaw, pitch })
    events.push({ type: 'player_moved', tick, sequence: ++sequence,
      position: { ...destination.state.player.position } })
    for (const tileId of revealed) events.push({ type: 'tile_discovered', tick,
      sequence: ++sequence, tileId })
    const player = { ...state.state.player, position: { ...destination.state.player.position },
      yaw: destination.state.player.yaw, pitch: destination.state.player.pitch,
      verticalVelocity: destination.state.player.verticalVelocity }
    const sale = settleTradeListings(player, tick, sequence)
    events.push(...sale.events)
    const next: State = { ...state.state, movementOwner: 'streamed', tick,
      rng: { ...state.state.rng, simulation: simulationRngStep(state.state.rng.simulation) },
      eventSequence: sale.eventSequence, discoveryMask: mask, player: sale.player }
    const checked = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
      saveRevision: base.saveRevision + 1, bootstrap: base.bootstrap, state: next }, lineage)
    if (!checked) return reject(moveIndex, 'terrain_missing', 'The crossing candidate failed validation.')
    return { candidate: checked.state, events, rejections: [] }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return reject(moveIndex, 'terrain_missing', 'The crossing terrain could not be resolved.')
  }
}

/** Pure return candidate. The original saved base remains the only CAS ancestor. */
export function advancePublicV13ReturnBoundary(base: PublicV13Start, current: State,
  intents: readonly PublicWorldIntent[], options: { walkRequested: boolean }): BoundaryResult {
  const reject = (index: number, code: PublicWorldRejection['code'], message: string): BoundaryResult => ({
    candidate: null, events: [], rejections: [{ intentIndex: index,
      intentType: (Array.isArray(intents) ? intents[index]?.type : undefined) ?? 'move', code, message }],
  })
  const lineage = decodePublicV13SourceLineage(base?.sourceLineage)
  const checkedBase = lineage && decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: base.saveRevision, bootstrap: base.bootstrap, state: base.state }, lineage)
  if (!checkedBase || !Number.isSafeInteger(base.saveRevision + 1)
    || typeof options?.walkRequested !== 'boolean') throw new RangeError('Invalid v13 boundary base.')
  const state = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: base.saveRevision, bootstrap: base.bootstrap, state: current }, lineage)
    ?? decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
      saveRevision: base.saveRevision + 1, bootstrap: base.bootstrap, state: current }, lineage)
  if (!state || state.state.movementOwner !== 'streamed') return reject(0, 'unavailable_here',
    'Return requires a checked streamed origin.')
  if (!Array.isArray(intents) || intents.length < 1 || intents.length > 2
    || intents.length === 2 && (intents[0]?.type !== 'look' || intents[1]?.type !== 'move')
    || intents[intents.length - 1]?.type !== 'move') {
    return reject(Array.isArray(intents) ? Math.max(0, Math.min(1, intents.length - 1)) : 0,
      'invalid_frame', 'A return frame accepts one move, optionally preceded by one look.')
  }
  const moveIndex = intents.length - 1
  const move = intents[moveIndex] as Extract<PublicWorldIntent, { type: 'move' }>
  const from = state.state.player.position
  const { x: dx, z: dz, y = 0 } = move.delta ?? {}
  const limit = publicV11Gait(state.state.player.equipment.feet, options.walkRequested).metersPerStep
  if (![dx, dz, y].every(Number.isFinite) || y !== 0 || Math.hypot(dx, dz) > limit + 1e-9) {
    return reject(moveIndex, 'invalid_value', 'The move exceeds the permitted horizontal gait.')
  }
  const to = { x: from.x + dx, z: from.z + dz }
  const envelope = legacyMovementEnvelope({ generationProfile: state.state.generationProfile,
    tiles: state.state.greenway.tiles })
  const inside = (point: { x: number; z: number }) => point.x >= envelope.minX
    && point.x <= envelope.maxX && point.z >= envelope.minZ && point.z <= envelope.maxZ
  if (inside(from) || !inside(to)) return reject(moveIndex, 'unavailable_here',
    'This frame does not return into Greenway.')
  const look = intents.length === 2 ? intents[0] as Extract<PublicWorldIntent, { type: 'look' }> : null
  const yaw = state.state.player.yaw + (look?.yawDelta ?? 0)
  if (look && (![look.yawDelta, look.pitchDelta, yaw].every(Number.isFinite)
    || Math.abs(yaw) > 1e6)) return reject(0, 'invalid_value', 'The turn cannot be applied at this crossing.')
  if (!Number.isSafeInteger(state.state.tick + 1)) return reject(moveIndex,
    'invalid_value', 'The boundary clock is exhausted.')
  try {
    const context = { seed: state.state.seed, fieldCampTileIds: state.state.fieldCampTileIds,
      authoredBuiltRouteIds: [state.state.mireglass.builtRoutes.bridge,
        state.state.mireglass.builtRoutes.ladder].filter((id): id is string => id !== null) }
    const built = state.state.terrainWorks.builtWorkIds.map((id) => resolveTerrainWorkSite(state.state.seed, id))
    if (built.some((site) => !site || site.kind === 'dig')) return reject(moveIndex,
      'terrain_missing', 'The built terrain support is unavailable.')
    const sites = built as Built[]
    const dug = new Set(state.state.terrainWorks.dugTileIds)
    const { hooks } = createTerrainWorkRuntimeHooks(() => sites, () => dug)
    const witness = publicV13GreenwayWitness(state.state, intents)
    const support = createPublicV11RouteSupport(witness)
    const authored = mireglassMoveBarrier(state.state.seed, from, to)
    const workBarrier = hooks.barrier(from, to, authored)
    const remaining = workBarrier && support.clearsMireglassBarrier(from, to, workBarrier)
      ? null : workBarrier
    const barrier = remaining ?? highlandRidgeMoveBarrier(from, to)
    if (barrier) return reject(moveIndex, barrier, `The ${barrier} blocks the return.`)
    if (wetSegment(state.state, from, to, envelope, sites, support)) return reject(moveIndex,
      'terrain_missing', 'The return does not stay on dry or supported terrain.')
    const sourceTile = worldTileAtGrid(state.state.seed, cellAt(from.x), cellAt(from.z))
    const known = [...new Set([...discoveredTileIdsInActiveWindow(state.state.discoveryMask, from),
      sourceTile.id])].sort()
    const runtime = createStreamedWorldV13FromState({ seed: state.state.seed, tick: state.state.tick,
      player: { position: from, yaw: state.state.player.yaw, pitch: state.state.player.pitch,
        verticalVelocity: state.state.player.verticalVelocity }, discoveredTileIds: known },
    state.state.terrainWorks, context,
    { cachePitDug: state.state.mireglass.cacheExcavated, highlandRidge: true, routeSupport: support })
    const streamedIntents: StreamedWorldIntent[] = intents.map((intent) => intent.type === 'move'
      ? { type: 'move', delta: { x: intent.delta.x, z: intent.delta.z } }
      : { type: 'look', yawDelta: intent.yawDelta, pitchDelta: intent.pitchDelta })
    const streamed = runtime.advance(streamedIntents, { nearbyDiscovery: true })
    if (streamed.rejections.length) return reject(moveIndex, streamed.rejections[0].code,
      'The work-hooked terrain rejected the return.')
    const greenway = advancePublicGreenwayReturnStep(witness, intents, support)
    if (greenway.rejections.length) {
      const blocked = greenway.rejections[0]
      return reject(blocked.intentIndex, blocked.code, blocked.message)
    }
    if (greenway.state.tick !== streamed.state.tick) return reject(moveIndex,
      'terrain_missing', 'The two movement authorities disagreed on the return tick.')
    const tick = streamed.state.tick
    const position = streamed.state.player.position
    const discovered = new Set<string>()
    const events: PublicWorldEvent[] = []
    for (const event of greenway.events) {
      if (event.type === 'tile_discovered') {
        if (discoveryMaskHasTileId(state.state.discoveryMask, event.tileId)
          || discovered.has(event.tileId)) continue
        discovered.add(event.tileId)
      }
      events.push(event.type === 'player_moved'
        ? { ...event, position: { ...position } } : event)
    }
    for (const tileId of nearbyWorldTileIds(position, PUBLIC_WALK_REVEAL_RADIUS_METERS)) {
      if (discoveryMaskHasTileId(state.state.discoveryMask, tileId) || discovered.has(tileId)) continue
      discovered.add(tileId)
      events.push({ type: 'tile_discovered', tileId, tick, sequence: 0 })
    }
    if (!Number.isSafeInteger(state.state.eventSequence + events.length)) return reject(moveIndex,
      'invalid_value', 'The boundary event sequence is exhausted.')
    const numbered = events.map((event, index) => ({ ...event, tick,
      sequence: state.state.eventSequence + index + 1 }))
    const mask = discovered.size ? new Uint8Array(state.state.discoveryMask) : state.state.discoveryMask
    if (discovered.size) {
      const bits = encodeDiscoveredTileIds([...discovered])
      for (let index = 0; index < mask.length; index++) mask[index] |= bits[index]
    }
    const { discoveredTileIds: _ids, ...legacyNext } = greenway.state as PublicWorldV11State
    const next: State = { ...state.state, ...legacyNext, discoveryMask: mask,
      eventSequence: state.state.eventSequence + numbered.length,
      player: { ...legacyNext.player, position: { ...position },
        yaw: streamed.state.player.yaw, pitch: streamed.state.player.pitch,
        verticalVelocity: streamed.state.player.verticalVelocity },
      windstep: state.state.windstep, terrainWorks: state.state.terrainWorks }
    const checked = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
      saveRevision: base.saveRevision + 1, bootstrap: base.bootstrap, state: next }, lineage)
    if (!checked) return reject(moveIndex, 'terrain_missing', 'The return candidate failed validation.')
    return { candidate: checked.state, events: numbered, rejections: [] }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return reject(moveIndex, 'terrain_missing', 'The return terrain could not be resolved.')
  }
}
