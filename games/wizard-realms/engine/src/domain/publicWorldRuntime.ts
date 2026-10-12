import { areaAt, terrainHeightAt } from './generation'
import { highlandRidgeMoveBarrier } from './highlandRidge'
import { MIREGLASS_RING_ID, mireglassFairyRing } from './mireglassContent'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import type { MireglassItemId } from './mireglassExpedition'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { legacyMovementEnvelope, parsePublicV6BootstrapRoot } from './publicWorldV6'
import type { PublicWorldState } from './publicWorldState'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { isValidPublicWorldV10State } from './publicWorldV10State'
import type { PublicWorldV10State } from './publicWorldV10State'
import type { PublicWorldV11State } from './publicWorldV11State'
import { createPublicV11RouteSupport } from './publicV11RouteSupport'
import type { PublicV11RouteSupport } from './publicV11RouteSupport'
import { createStreamedWorldFromState } from './streamedWorld'
import type { TerrainFacts } from './mireglassCachePitOverlay'
import type { StreamedWorldEvent, StreamedWorldIntent, StreamedWorldRejection, StreamedWorldRuntime } from './streamedWorld'
import type { IntentRejection, PlayerState, WizardEvent, WizardIntent, WizardWorldState } from './types'
import { advanceWizardWorld, settleTradeListings } from './world'
import { worldTileAtGrid } from './worldChunks'

/** A fixed step may combine a look and move, but never advances both authorities. */
export type PublicWorldIntent =
  | { type: 'move'; delta: { x: number; y?: number; z: number } }
  | Exclude<WizardIntent, { type: 'move' }>

export type PublicWorldEvent =
  | Exclude<WizardEvent, { type: 'item_unequipped' }>
  | (Omit<Extract<WizardEvent, { type: 'item_unequipped' }>, 'itemId'> & { itemId: MireglassItemId })
  | (StreamedWorldEvent & { sequence: number })
export interface PublicWorldRejection {
  intentIndex: number
  intentType: PublicWorldIntent['type']
  code: IntentRejection['code'] | StreamedWorldRejection['code'] | 'off_connector'
    | 'unavailable_here' | 'invalid_frame'
  message: string
}
export interface PublicWorldAdvanceResult {
  state: PublicWorldState
  events: PublicWorldEvent[]
  rejections: PublicWorldRejection[]
}
export type PublicWorldV10AdvanceResult = Omit<PublicWorldAdvanceResult, 'state'> & {
  state: PublicWorldV10State
}

const cellAt = (coordinate: number) => Math.ceil(coordinate / 4 - 0.5)
const within = (x: number, z: number, envelope: ReturnType<typeof legacyMovementEnvelope>) =>
  x >= envelope.minX && x <= envelope.maxX && z >= envelope.minZ && z <= envelope.maxZ
const simulationRngStep = (value: number) => {
  let next = value | 0
  next ^= next << 13
  next ^= next >>> 17
  next ^= next << 5
  return next >>> 0 || 1
}
// Only the current immutable state chain keeps active chunks. Replaying an older
// state rebuilds its own authority instead of reusing a runtime that already advanced.
type TerrainMode = 'seed' | 'v10-base' | 'v10-dug' | 'v11-base' | 'v11-dug'
const terrainMode = (facts?: TerrainFacts): TerrainMode => !facts ? 'seed'
  : facts.highlandRidge === true
    ? facts.cachePitDug ? 'v11-dug' : 'v11-base'
    : facts.cachePitDug ? 'v10-dug' : 'v10-base'
let currentStreamed: { state: PublicWorldState; runtime: StreamedWorldRuntime;
  terrainMode: TerrainMode } | null = null
type BootstrapProof = readonly string[] | null
const trustedV10States = new WeakMap<object, BootstrapProof>()
const deeplyFrozenV10Objects = new WeakSet<object>()
const BOOTSTRAP_KEYS = ['schemaVersion', 'greenwayContentRevision', 'mireglassContentRevision',
  'seed', 'source', 'greenwaySaveBytes'] as const
const SOURCE_KEYS = ['profile', 'key', 'bytes'] as const

function dataRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== keys.length) return false
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
  })
}

/** Captures all mutable bootstrap leaves as immutable string values, not object identity. */
function captureBootstrapProof(bootstrap: PublicV6BootstrapRoot | null): BootstrapProof | undefined {
  if (bootstrap === null) return null
  try {
    if (!dataRecord(bootstrap, BOOTSTRAP_KEYS) || !dataRecord(bootstrap.source, SOURCE_KEYS)) return undefined
    const values = [bootstrap.schemaVersion, bootstrap.greenwayContentRevision,
      bootstrap.mireglassContentRevision, bootstrap.seed, bootstrap.greenwaySaveBytes,
      bootstrap.source.profile, bootstrap.source.key, bootstrap.source.bytes]
    return values.every((value) => typeof value === 'string') ? Object.freeze(values) : undefined
  } catch { return undefined }
}

function sameBootstrapProof(proof: BootstrapProof, bootstrap: PublicV6BootstrapRoot | null): boolean {
  const current = captureBootstrapProof(bootstrap)
  return current !== undefined && (proof === null ? current === null
    : current !== null && proof.every((value, index) => value === current[index]))
}

function deepFreezeState(value: object): void {
  if (deeplyFrozenV10Objects.has(value)) return
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) throw new RangeError('V10 state has an accessor.')
    if (descriptor.value !== null && typeof descriptor.value === 'object') deepFreezeState(descriptor.value)
  }
  Object.freeze(value)
  deeplyFrozenV10Objects.add(value)
}

function validV10Bootstrap(bootstrap: PublicV6BootstrapRoot | null): boolean {
  if (bootstrap === null) return true
  try { return parsePublicV6BootstrapRoot(JSON.stringify(bootstrap)) !== null }
  catch { return false }
}
const reject = (state: PublicWorldState, intent: PublicWorldIntent,
  code: PublicWorldRejection['code'], message: string, intentIndex = 0): PublicWorldAdvanceResult => ({
  state, events: [], rejections: [{ intentIndex, intentType: intent.type, code, message }],
})

function greenwayWorld(state: PublicWorldState): WizardWorldState {
  return {
    ...state.greenway, seed: state.seed, generationProfile: state.generationProfile,
    tick: state.tick, rng: state.rng, eventSequence: state.eventSequence,
    // v5 actions accept the complete v6 player at runtime and clone it before changing it.
    // The extra Mireglass item IDs must not be projected away during a return journey.
    player: state.player as PlayerState,
    // The legacy step treats frozen history as copy-on-write; mutable callers stay detached.
    discoveredTileIds: Object.isFrozen(state.discoveredTileIds)
      ? state.discoveredTileIds as string[] : [...state.discoveredTileIds],
  }
}

function fromGreenway(state: PublicWorldState, world: WizardWorldState): PublicWorldState {
  const { seed: _seed, generationProfile: _profile, tick, rng, eventSequence,
    player, discoveredTileIds, ...greenway } = world
  return { ...state, movementOwner: 'greenway', tick, rng, eventSequence,
    player, discoveredTileIds, greenway }
}

function stepGreenway(state: PublicWorldState, intents: readonly PublicWorldIntent[],
  requireExactMove = false, routeSupport?: PublicV11RouteSupport): PublicWorldAdvanceResult {
  const v5Intents: WizardIntent[] = intents.map((intent) => intent.type === 'move'
    ? { type: 'move', delta: { x: intent.delta.x, y: 0, z: intent.delta.z } }
    : intent)
  const moveIndex = intents.findIndex((intent) => intent.type === 'move')
  const move = intents[moveIndex]
  const world = greenwayWorld(state)
  const originalAreas = world.areas
  if (requireExactMove && move?.type === 'move') {
    const from = state.player.position
    const area = areaAt(originalAreas, from.x + move.delta.x, from.z + move.delta.z)
    if (area.id !== 'greenway' && world.routes.some((route) =>
      route.toAreaId === area.id && route.siteId !== null && world.builtRouteIds.includes(route.id))) {
      // The exterior pose inherits Greenway's fallback area. For this return step,
      // let an already opened authored area own only that exterior source pose.
      world.areas = originalAreas.map((candidate) => candidate.id === area.id
        ? { ...candidate, minX: Math.min(candidate.minX, from.x),
          maxX: Math.max(candidate.maxX, from.x), minZ: Math.min(candidate.minZ, from.z),
          maxZ: Math.max(candidate.maxZ, from.z) } : candidate)
    }
  }
  const result = advanceWizardWorld(world, v5Intents, routeSupport
    ? (from, to) => {
      const route = routeSupport.crossing(from, to)
      return route?.kind === 'greenway_ladder' || route?.kind === 'highland_bridge'
    } : undefined)
  if (result.rejections.length) return { state, events: [], rejections: result.rejections }
  if (!Number.isSafeInteger(result.state.eventSequence)) {
    if (!intents[0]) throw new RangeError('The public event sequence is exhausted.')
    return reject(state, intents[0], 'invalid_value', 'The public event sequence is exhausted.')
  }
  if (requireExactMove && move?.type === 'move'
    && (result.state.player.position.x !== state.player.position.x + move.delta.x
      || result.state.player.position.z !== state.player.position.z + move.delta.z)) {
    return reject(state, move, 'off_connector', 'The Greenway return is obstructed.', moveIndex)
  }
  if (result.state.player.position.x !== state.player.position.x
    || result.state.player.position.z !== state.player.position.z) {
    const known = new Set(result.state.discoveredTileIds)
    const revealedIds = nearbyWorldTileIds(result.state.player.position,
      PUBLIC_WALK_REVEAL_RADIUS_METERS).filter((id) => !known.has(id))
    if (!Number.isSafeInteger(result.state.eventSequence + revealedIds.length)) {
      if (!intents[0]) throw new RangeError('The public event sequence is exhausted.')
      return reject(state, intents[0], 'invalid_value', 'The public event sequence is exhausted.')
    }
    if (revealedIds.length) {
      result.state.discoveredTileIds = [...known, ...revealedIds].sort()
      for (const tileId of revealedIds) result.events.push({ type: 'tile_discovered', tileId,
        tick: result.state.tick, sequence: ++result.state.eventSequence })
    }
  }
  return { state: fromGreenway(state, world.areas === originalAreas ? result.state
    : { ...result.state, areas: originalAreas.map((area) => ({ ...area })) }),
    events: result.events, rejections: [] }
}

/** Checks every cell segment of a bounded crossing, including zero-width diagonal corners. */
function crossingTouchesWetland(state: PublicWorldState,
  from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const envelope = legacyMovementEnvelope({ generationProfile: state.generationProfile,
    tiles: state.greenway.tiles })
  const wetlandAt = (x: number, z: number) => {
    if (worldTileAtGrid(state.seed, cellAt(x), cellAt(z)).terrain === 'wetland') return true
    if (!within(x, z, envelope)) return false
    const tile = state.greenway.tiles.reduce((closest, candidate) =>
      Math.hypot(x - candidate.center.x, z - candidate.center.z)
        < Math.hypot(x - closest.center.x, z - closest.center.z) ? candidate : closest)
    return tile.terrain === 'wetland'
  }
  if (wetlandAt(from.x, from.z) || wetlandAt(to.x, to.z)) return true

  const dx = to.x - from.x
  const dz = to.z - from.z
  const cuts = [0, 1]
  const gridCuts: [Array<{ t: number; grid: number }>, Array<{ t: number; grid: number }>] = [[], []]
  for (const [axis, start, delta, min, max] of [
    [0, from.x, dx, envelope.minX, envelope.maxX],
    [1, from.z, dz, envelope.minZ, envelope.maxZ],
  ] as const) {
    if (delta === 0) continue
    for (let grid = cellAt(Math.min(start, start + delta)) - 1;
      grid <= cellAt(Math.max(start, start + delta)); grid += 1) {
      const t = (grid * 4 + 2 - start) / delta
      if (t > 0 && t < 1) { cuts.push(t); gridCuts[axis].push({ t, grid }) }
    }
    for (const edge of [min, max]) {
      const t = (edge - start) / delta
      if (t > 0 && t < 1) cuts.push(t)
    }
  }
  cuts.sort((a, b) => a - b)
  for (let index = 1; index < cuts.length; index += 1) {
    if (cuts[index] === cuts[index - 1]) continue
    const t = (cuts[index - 1] + cuts[index]) / 2
    if (wetlandAt(from.x + dx * t, from.z + dz * t)) return true
  }
  for (const xCut of gridCuts[0]) for (const zCut of gridCuts[1]) {
    if (Math.abs(xCut.t - zCut.t) > Number.EPSILON * 16) continue
    const beforeX = xCut.grid + (dx < 0 ? 1 : 0)
    const afterX = xCut.grid + (dx > 0 ? 1 : 0)
    const beforeZ = zCut.grid + (dz < 0 ? 1 : 0)
    const afterZ = zCut.grid + (dz > 0 ? 1 : 0)
    if (wetlandAt(beforeX * 4, afterZ * 4) || wetlandAt(afterX * 4, beforeZ * 4)) return true
  }
  return false
}

function streamedSnapshot(state: PublicWorldState) {
  return {
    seed: state.seed, tick: state.tick,
    player: {
      position: state.player.position, yaw: state.player.yaw, pitch: state.player.pitch,
      verticalVelocity: state.player.verticalVelocity,
    },
    discoveredTileIds: state.discoveredTileIds,
  }
}

function fromStreamed(state: PublicWorldState, intents: readonly PublicWorldIntent[],
  result: ReturnType<ReturnType<typeof createStreamedWorldFromState>['advance']>): PublicWorldAdvanceResult {
  if (result.rejections.length) {
    const rejection = result.rejections[0]
    return reject(state, intents[rejection.intentIndex], rejection.code,
      `Streamed movement was rejected: ${rejection.code}.`, rejection.intentIndex)
  }
  if (!Number.isSafeInteger(state.eventSequence + result.events.length)) {
    if (!intents[0]) throw new RangeError('The public event sequence is exhausted.')
    return reject(state, intents[0], 'invalid_value', 'The public event sequence is exhausted.')
  }
  let eventSequence = state.eventSequence
  const events: PublicWorldEvent[] = result.events.map((event) => ({ ...event, sequence: ++eventSequence }))
  return settleStreamedMarket({
    state: { ...state, movementOwner: 'streamed', tick: result.state.tick,
      rng: { ...state.rng, simulation: simulationRngStep(state.rng.simulation) },
      eventSequence, discoveredTileIds: result.state.discoveredTileIds,
      player: { ...state.player, position: { ...result.state.player.position },
        yaw: result.state.player.yaw, pitch: result.state.player.pitch,
        verticalVelocity: result.state.player.verticalVelocity } },
    events, rejections: [],
  })
}

/** The market clock keeps running while the one campaign player explores streamed terrain. */
function settleStreamedMarket(result: PublicWorldAdvanceResult): PublicWorldAdvanceResult {
  if (result.rejections.length || result.state.movementOwner !== 'streamed') return result
  const sale = settleTradeListings(result.state.player, result.state.tick, result.state.eventSequence)
  if (!sale.events.length) return result
  return { ...result,
    state: { ...result.state, player: sale.player, eventSequence: sale.eventSequence },
    events: [...result.events, ...sale.events] }
}

/** One player changes region ownership only after both rings were discovered on foot. */
function crossRegionFairyRing(state: PublicWorldState,
  intent: Extract<PublicWorldIntent, { type: 'teleport_fairy_ring' }>,
  facts?: TerrainFacts): PublicWorldAdvanceResult {
  const outbound = state.movementOwner === 'greenway'
  const greenwayRing = state.greenway.fairyRings.find((ring) => ring.id === 'ring-greenway')
  const mireglassRing = mireglassFairyRing(state.seed)
  if (!greenwayRing) return reject(state, intent, 'not_found', 'The Greenway fairy ring is missing.')
  const source = outbound ? greenwayRing : { id: mireglassRing.id, position: mireglassRing.tile.center }
  const target = outbound ? { id: mireglassRing.id, position: mireglassRing.tile.center } : greenwayRing
  if (intent.sourceRingId !== source.id || intent.targetRingId !== target.id) {
    return reject(state, intent, 'not_found', 'These fairy rings do not form the Greenway to Mireglass path.')
  }
  if (!state.player.discoveredRingIds.includes(source.id)
    || !state.player.discoveredRingIds.includes(target.id)) {
    return reject(state, intent, 'undiscovered', 'Discover both fairy rings on foot before traveling.')
  }
  if (Math.hypot(state.player.position.x - source.position.x,
    state.player.position.y - source.position.y,
    state.player.position.z - source.position.z) > 3) {
    return reject(state, intent, 'too_far', 'Stand inside the source fairy ring to travel.')
  }
  if (outbound && areaAt(state.greenway.areas, state.player.position.x, state.player.position.z).id
    !== areaAt(state.greenway.areas, greenwayRing.position.x, greenwayRing.position.z).id) {
    return reject(state, intent, 'locked_area', 'Cross into the Greenway Ring area before traveling.')
  }
  if (outbound && !state.discoveredTileIds.includes(mireglassRing.tile.id)) {
    return reject(state, intent, 'undiscovered', 'Reach the Mireglass outpost before using its fairy ring.')
  }
  const position = outbound ? { ...mireglassRing.tile.center }
    : { ...greenwayRing.position,
      y: terrainHeightAt(state.greenway.tiles, greenwayRing.position.x, greenwayRing.position.z) }
  let streamed: StreamedWorldRuntime | null = null
  if (outbound) {
    try {
      streamed = createStreamedWorldFromState({ seed: state.seed, tick: state.tick + 1,
        player: { position, yaw: state.player.yaw, pitch: state.player.pitch, verticalVelocity: 0 },
        discoveredTileIds: state.discoveredTileIds }, facts)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      return reject(state, intent, 'terrain_missing', 'The Mireglass fairy ring cannot receive travelers safely.')
    }
  }
  const tick = state.tick + 1
  const teleport: PublicWorldEvent = { type: 'fairy_ring_teleported', tick,
    sequence: state.eventSequence + 1, sourceRingId: source.id, targetRingId: target.id, position }
  const player = { ...state.player, position, verticalVelocity: 0 }
  const sale = settleTradeListings(player, tick, teleport.sequence)
  const next: PublicWorldState = { ...state,
    movementOwner: outbound ? 'streamed' : 'greenway', tick,
    rng: { ...state.rng, simulation: simulationRngStep(state.rng.simulation) },
    eventSequence: sale.eventSequence, player: sale.player }
  currentStreamed = streamed ? { state: next, runtime: streamed, terrainMode: terrainMode(facts) } : null
  return { state: next, events: [teleport, ...sale.events], rejections: [] }
}

function stepStreamed(state: PublicWorldState, intents: readonly PublicWorldIntent[],
  facts?: TerrainFacts): PublicWorldAdvanceResult {
  const unavailableIndex = intents.findIndex((intent) =>
    intent.type !== 'move' && intent.type !== 'look' && intent.type !== 'jump')
  if (unavailableIndex >= 0) {
    return reject(state, intents[unavailableIndex], 'unavailable_here',
      'Greenway actions are unavailable outside Greenway.', unavailableIndex)
  }
  const streamedIntents: StreamedWorldIntent[] = intents.map((intent) => intent.type === 'move'
    ? { type: 'move', delta: { x: intent.delta.x, z: intent.delta.z } } : intent as StreamedWorldIntent)
  try {
    const runtime = currentStreamed?.state === state && currentStreamed.terrainMode === terrainMode(facts)
      ? currentStreamed.runtime : createStreamedWorldFromState(streamedSnapshot(state), facts)
    const runtimeState = runtime.state
    const result = fromStreamed(state, intents, runtime.advance(streamedIntents,
      { atomicOnRejection: true, nearbyDiscovery: true }))
    currentStreamed = result.rejections.length && runtime.state !== runtimeState ? null
      : { state: result.state, runtime, terrainMode: terrainMode(facts) }
    return result
  } catch (error) {
    currentStreamed = null
    if (!(error instanceof RangeError)) throw error
    if (!intents[0]) throw error
    return reject(state, intents[0], 'terrain_missing', 'Streamed terrain could not resume at this position.')
  }
}

function crossOutbound(state: PublicWorldState, intent: Extract<PublicWorldIntent, { type: 'move' }>,
  to: { x: number; z: number }, facts?: TerrainFacts): PublicWorldAdvanceResult {
  const from = state.player.position
  const barrier = mireglassMoveBarrier(state.seed, from, to)
    ?? (facts?.highlandRidge === true ? highlandRidgeMoveBarrier(from, to) : null)
  if (barrier) return reject(state, intent, barrier, `The ${barrier} blocks the crossing.`)
  try {
    if (crossingTouchesWetland(state, from, to)) return reject(state, intent, 'terrain_missing',
      'The crossing does not stay on dry terrain.')
    const tile = worldTileAtGrid(state.seed, cellAt(to.x), cellAt(to.z))
    const position = { x: to.x, y: Math.max(from.y, tile.center.y), z: to.z }
    const nearbyIds = nearbyWorldTileIds(position, PUBLIC_WALK_REVEAL_RADIUS_METERS)
    const known = new Set(state.discoveredTileIds)
    const revealedIds = nearbyIds.filter((id) => !known.has(id))
    const discoveredTileIds = [...known, ...revealedIds].sort()
    const runtime = createStreamedWorldFromState({
      seed: state.seed, tick: state.tick,
      player: { position, yaw: state.player.yaw, pitch: state.player.pitch,
        verticalVelocity: position.y === tile.center.y ? 0 : state.player.verticalVelocity },
      discoveredTileIds,
    }, facts)
    const destination = runtime.advance([])
    const eventSequence = state.eventSequence + 1 + revealedIds.length
    if (!Number.isSafeInteger(eventSequence)) return reject(state, intent, 'invalid_value',
      'The public event sequence is exhausted.')
    const events: PublicWorldEvent[] = [
      { type: 'player_moved', tick: destination.state.tick, sequence: state.eventSequence + 1,
        position: { ...destination.state.player.position } },
      ...revealedIds.map((tileId, index) => ({ type: 'tile_discovered' as const,
        tick: destination.state.tick, sequence: state.eventSequence + 2 + index, tileId })),
    ]
    const next: PublicWorldState = { ...state, movementOwner: 'streamed', tick: destination.state.tick,
      rng: { ...state.rng, simulation: simulationRngStep(state.rng.simulation) },
      eventSequence, discoveredTileIds: destination.state.discoveredTileIds,
      player: { ...state.player, position: { ...destination.state.player.position },
        verticalVelocity: destination.state.player.verticalVelocity } }
    const result = settleStreamedMarket({ state: next, events, rejections: [] })
    currentStreamed = { state: result.state, runtime, terrainMode: terrainMode(facts) }
    return result
  } catch (error) {
    currentStreamed = null
    if (!(error instanceof RangeError)) throw error
    return reject(state, intent, 'terrain_missing', 'The streamed destination failed validation.')
  }
}

function crossOutboundFrame(state: PublicWorldState, intents: readonly PublicWorldIntent[],
  move: Extract<PublicWorldIntent, { type: 'move' }>, to: { x: number; z: number },
  facts?: TerrainFacts): PublicWorldAdvanceResult {
  const look = intents.length === 2 ? intents[0] as Extract<PublicWorldIntent, { type: 'look' }> : null
  const yaw = state.player.yaw + (look?.yawDelta ?? 0)
  const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2,
    state.player.pitch + (look?.pitchDelta ?? 0)))
  if (look && (![look.yawDelta, look.pitchDelta, yaw].every(Number.isFinite)
    || Math.abs(yaw) > 1e6)) {
    return reject(state, look, 'invalid_value', 'The turn cannot be applied at this crossing.')
  }
  const afterLook: PublicWorldState = look
    ? { ...state, player: { ...state.player, yaw, pitch } } : state
  const crossed = crossOutbound(afterLook, move, to, facts)
  if (crossed.rejections.length) return {
    state, events: [], rejections: crossed.rejections.map((rejection) => ({
      ...rejection, intentIndex: look ? 1 : 0,
    })),
  }
  if (!look) return crossed
  if (!Number.isSafeInteger(crossed.state.eventSequence + 1)) {
    currentStreamed = null
    return reject(state, look, 'invalid_value', 'The public event sequence is exhausted.')
  }
  const events: PublicWorldEvent[] = [
    { type: 'player_looked', tick: crossed.state.tick,
      sequence: state.eventSequence + 1, yaw, pitch },
    ...crossed.events.map((event) => ({ ...event, sequence: event.sequence + 1 })),
  ]
  const next = { ...crossed.state, eventSequence: crossed.state.eventSequence + 1 }
  if (currentStreamed?.state === crossed.state) currentStreamed = { state: next,
    runtime: currentStreamed.runtime, terrainMode: currentStreamed.terrainMode }
  return { state: next, events, rejections: [] }
}

/**
 * One bounded 50 ms frame. The only composite is look then move, matching the
 * control sampler's heading calculation. A rejected frame changes no state.
 */
function advancePublicWorldFrameInternal(
  state: PublicWorldState, intents: readonly PublicWorldIntent[], facts?: TerrainFacts,
): PublicWorldAdvanceResult {
  if (intents.length > 2 || (intents.length === 2
    && (intents[0].type !== 'look' || intents[1].type !== 'move'))) {
    return reject(state, intents[Math.min(1, intents.length - 1)], 'invalid_frame',
      'A fixed step accepts at most one look followed by one move.', Math.min(1, intents.length - 1))
  }
  if (!Number.isSafeInteger(state.tick + 1) || !Number.isSafeInteger(state.eventSequence + 8)) {
    if (!intents[0]) throw new RangeError('The public world clock is exhausted.')
    return reject(state, intents[0], 'invalid_value', 'The public world clock is exhausted.')
  }
  if (intents.length === 1 && intents[0].type === 'teleport_fairy_ring'
    && (intents[0].sourceRingId === MIREGLASS_RING_ID
      || intents[0].targetRingId === MIREGLASS_RING_ID)) {
    return crossRegionFairyRing(state, intents[0], facts)
  }
  const moveIndex = intents.findIndex((intent) => intent.type === 'move')
  const move = intents[moveIndex]
  if (move?.type === 'move') {
    const { x, z, y = 0 } = move.delta
    if (![x, y, z].every(Number.isFinite) || y !== 0 || Math.hypot(x, z) > 4
      || !Number.isFinite(state.player.position.x + x) || !Number.isFinite(state.player.position.z + z)) {
      return reject(state, move, 'invalid_value',
        'Movement must be finite, horizontal and at most four meters.', moveIndex)
    }
    const from = state.player.position
    const to = { x: from.x + x, z: from.z + z }
    const envelope = legacyMovementEnvelope({ generationProfile: state.generationProfile,
      tiles: state.greenway.tiles })
    const arrivingGreenway = within(to.x, to.z, envelope)
    if (state.movementOwner === 'greenway') {
      return arrivingGreenway ? stepGreenway(state, intents, false, facts?.routeSupport)
        : crossOutboundFrame(state, intents, move, to, facts)
    }
    if (arrivingGreenway) {
      const barrier = mireglassMoveBarrier(state.seed, from, to)
        ?? (facts?.highlandRidge === true ? highlandRidgeMoveBarrier(from, to) : null)
      if (barrier) return reject(state, move, barrier, `The ${barrier} blocks the crossing.`, moveIndex)
      try {
        if (crossingTouchesWetland(state, from, to)) return reject(state, move, 'terrain_missing',
          'The crossing does not stay on dry terrain.', moveIndex)
        if (currentStreamed?.state !== state || currentStreamed.terrainMode !== terrainMode(facts)) {
          createStreamedWorldFromState(streamedSnapshot(state), facts)
        }
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        return reject(state, move, 'terrain_missing',
          'Streamed terrain cannot resume for the return.', moveIndex)
      }
      currentStreamed = null
      return stepGreenway(state, intents, true, facts?.routeSupport)
    }
  }
  return state.movementOwner === 'greenway'
    ? stepGreenway(state, intents, false, facts?.routeSupport) : stepStreamed(state, intents, facts)
}

export function advancePublicWorldFrame(
  state: PublicWorldState, intents: readonly PublicWorldIntent[],
): PublicWorldAdvanceResult {
  return advancePublicWorldFrameInternal(state, intents)
}

/** Unmounted v13 adapter: Greenway actions continue, but an unhooked stream cannot own movement. */
export function advancePublicGreenwayOnlyFrame(state: PublicWorldState,
  intents: readonly PublicWorldIntent[], routeSupport?: PublicV11RouteSupport): PublicWorldAdvanceResult {
  // Let the existing frame validator own malformed composites before checking a destination.
  if (intents.length > 2 || (intents.length === 2
    && (intents[0].type !== 'look' || intents[1].type !== 'move'))) {
    return advancePublicWorldFrameInternal(state, intents)
  }
  const envelope = legacyMovementEnvelope({ generationProfile: state.generationProfile,
    tiles: state.greenway.tiles })
  if (state.movementOwner !== 'greenway'
    || !within(state.player.position.x, state.player.position.z, envelope)) {
    if (!intents[0]) throw new RangeError('The Greenway-only frame requires a Greenway origin.')
    return reject(state, intents[0], 'unavailable_here', 'Greenway-only travel requires a Greenway origin.')
  }
  const ringIndex = intents.findIndex((intent) => intent.type === 'teleport_fairy_ring'
    && (intent.sourceRingId === MIREGLASS_RING_ID || intent.targetRingId === MIREGLASS_RING_ID))
  if (ringIndex >= 0) return reject(state, intents[ringIndex], 'unavailable_here',
    'Cross-region fairy travel is not yet available.', ringIndex)
  const moveIndex = intents.findIndex((intent) => intent.type === 'move')
  const move = intents[moveIndex]
  if (move?.type === 'move') {
    const { x, z, y = 0 } = move.delta
    const toX = state.player.position.x + x
    const toZ = state.player.position.z + z
    // Invalid values still receive the existing frame validator's precise rejection.
    if ([x, y, z, toX, toZ].every(Number.isFinite) && y === 0 && Math.hypot(x, z) <= 4
      && !within(toX, toZ, envelope)) {
      return reject(state, move, 'unavailable_here', 'Travel beyond Greenway is not yet available.', moveIndex)
    }
  }
  return advancePublicWorldFrameInternal(state, intents,
    { cachePitDug: state.mireglass.cacheExcavated, routeSupport })
}

/** Exact authored Greenway return step, without the legacy unhooked stream branch. */
export function advancePublicGreenwayReturnStep(state: PublicWorldState,
  intents: readonly PublicWorldIntent[], routeSupport: PublicV11RouteSupport): PublicWorldAdvanceResult {
  return stepGreenway(state, intents, true, routeSupport)
}

/** Only internally produced, deeply frozen states can skip the expensive full-state check. */
export function advancePublicWorldV10Frame(state: PublicWorldV10State,
  intents: readonly PublicWorldIntent[], bootstrap: PublicV6BootstrapRoot | null = null): PublicWorldV10AdvanceResult {
  const rejectInvalid = (): PublicWorldV10AdvanceResult => {
    if (!intents[0]) throw new RangeError('Invalid v10 world state.')
    return reject(state, intents[0], 'invalid_value', 'Invalid v10 world state.') as PublicWorldV10AdvanceResult
  }
  const trusted = trustedV10States.has(state)
  const proof = trusted ? trustedV10States.get(state)! : captureBootstrapProof(bootstrap)
  if (proof === undefined || trusted && !sameBootstrapProof(proof, bootstrap)) return rejectInvalid()
  let ingressState = state
  let ingressBootstrap = bootstrap
  if (!trusted) {
    // The codec's exact-shape check must see the original. Cloning alone can
    // erase hidden or symbol keys and accidentally sanitize an invalid save.
    if (!isValidPublicWorldV10State(state, bootstrap)) return rejectInvalid()
    try {
      // Getters are resolved once. Validation, movement, and output all use this
      // detached snapshot, so caller changes cannot split the checked values.
      ingressState = structuredClone(state)
      ingressBootstrap = bootstrap === null ? null : structuredClone(bootstrap)
    } catch { return rejectInvalid() }
    if (!isValidPublicWorldV10State(ingressState, ingressBootstrap)
      || !validV10Bootstrap(ingressBootstrap)
      || !sameBootstrapProof(proof, bootstrap)) return rejectInvalid()
  }
  const result = advancePublicWorldFrameInternal(ingressState, intents,
    { cachePitDug: ingressState.mireglass.cacheExcavated })
  if (result.rejections.length) {
    if (trusted) return result as PublicWorldV10AdvanceResult
    currentStreamed = null
    return { ...result, state }
  }
  if (!trusted && !sameBootstrapProof(proof, bootstrap)) {
    currentStreamed = null
    return rejectInvalid()
  }
  // The first result is detached from all mutable caller-owned input subtrees.
  const next = trusted ? result.state as PublicWorldV10State
    : structuredClone(result.state) as PublicWorldV10State
  if (!trusted && !isValidPublicWorldV10State(next, ingressBootstrap)) {
    currentStreamed = null
    return rejectInvalid()
  }
  deepFreezeState(next)
  trustedV10States.set(next, proof)
  if (currentStreamed?.state === result.state) currentStreamed = { ...currentStreamed, state: next }
  return { ...result, state: next }
}

/** Internal v11 movement step. The v11 boundary validates and freezes its input/output. */
export function advancePublicWorldV11BaseFrame(state: PublicWorldV11State,
  intents: readonly PublicWorldIntent[]): Omit<PublicWorldAdvanceResult, 'state'> & {
  state: PublicWorldV11State
} {
  return advancePublicWorldFrameInternal(state, intents,
    { cachePitDug: state.mireglass.cacheExcavated, highlandRidge: true,
      routeSupport: createPublicV11RouteSupport(state) }) as Omit<PublicWorldAdvanceResult, 'state'> & {
      state: PublicWorldV11State
    }
}

/** Compatibility entrypoint for one-intent callers. */
export function advancePublicWorld(state: PublicWorldState, intent: PublicWorldIntent): PublicWorldAdvanceResult {
  return advancePublicWorldFrame(state, [intent])
}
