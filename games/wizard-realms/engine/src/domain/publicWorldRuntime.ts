import { mireglassGreenwayToMarkerTrail } from './mireglassApproachTrail'
import type { MireglassItemId } from './mireglassExpedition'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { legacyMovementEnvelope } from './publicWorldV6'
import type { PublicWorldState } from './publicWorldState'
import { createStreamedWorldFromState } from './streamedWorld'
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
let currentStreamed: { state: PublicWorldState; runtime: StreamedWorldRuntime } | null = null
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
    discoveredTileIds: [...state.discoveredTileIds],
  }
}

function fromGreenway(state: PublicWorldState, world: WizardWorldState): PublicWorldState {
  const { seed: _seed, generationProfile: _profile, tick, rng, eventSequence,
    player, discoveredTileIds, ...greenway } = world
  return { ...state, movementOwner: 'greenway', tick, rng, eventSequence,
    player, discoveredTileIds, greenway }
}

function stepGreenway(state: PublicWorldState, intents: readonly PublicWorldIntent[],
  requireExactMove = false): PublicWorldAdvanceResult {
  const v5Intents: WizardIntent[] = intents.map((intent) => intent.type === 'move'
    ? { type: 'move', delta: { x: intent.delta.x, y: 0, z: intent.delta.z } }
    : intent)
  const result = advanceWizardWorld(greenwayWorld(state), v5Intents)
  if (result.rejections.length) return { state, events: [], rejections: result.rejections }
  if (!Number.isSafeInteger(result.state.eventSequence)) {
    if (!intents[0]) throw new RangeError('The public event sequence is exhausted.')
    return reject(state, intents[0], 'invalid_value', 'The public event sequence is exhausted.')
  }
  const moveIndex = intents.findIndex((intent) => intent.type === 'move')
  const move = intents[moveIndex]
  if (requireExactMove && move?.type === 'move'
    && (result.state.player.position.x !== state.player.position.x + move.delta.x
      || result.state.player.position.z !== state.player.position.z + move.delta.z)) {
    return reject(state, move, 'off_connector', 'The Greenway return is obstructed.', moveIndex)
  }
  return { state: fromGreenway(state, result.state), events: result.events, rejections: [] }
}

function connectorCrossing(state: PublicWorldState, from: { x: number; z: number },
  to: { x: number; z: number }): boolean {
  const envelope = legacyMovementEnvelope({ generationProfile: state.generationProfile,
    tiles: state.greenway.tiles })
  const edgeX = envelope.minX + (state.generationProfile === 'greenway-expanded-v1' ? 2 : 0)
  const connector = mireglassGreenwayToMarkerTrail(state.seed)
  const edge = connector.findIndex(({ x, z }) => x === edgeX && z === 0)
  if (edge < 0 || connector[edge + 1]?.x !== edgeX - 4 || connector[edge + 1]?.z !== 0) return false
  return cellAt(from.z) === 0 && cellAt(to.z) === 0
    && from.x >= edgeX - 6 && from.x <= edgeX + 2
    && to.x >= edgeX - 6 && to.x <= edgeX + 2
    && [edgeX, edgeX - 4].includes(cellAt(from.x) * 4)
    && [edgeX, edgeX - 4].includes(cellAt(to.x) * 4)
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

function stepStreamed(state: PublicWorldState, intents: readonly PublicWorldIntent[]): PublicWorldAdvanceResult {
  const unavailableIndex = intents.findIndex((intent) =>
    intent.type !== 'move' && intent.type !== 'look' && intent.type !== 'jump')
  if (unavailableIndex >= 0) {
    return reject(state, intents[unavailableIndex], 'unavailable_here',
      'Greenway actions are unavailable beyond the connector.', unavailableIndex)
  }
  const streamedIntents: StreamedWorldIntent[] = intents.map((intent) => intent.type === 'move'
    ? { type: 'move', delta: { x: intent.delta.x, z: intent.delta.z } } : intent as StreamedWorldIntent)
  try {
    const runtime = currentStreamed?.state === state
      ? currentStreamed.runtime : createStreamedWorldFromState(streamedSnapshot(state))
    const result = fromStreamed(state, intents, runtime.advance(streamedIntents))
    currentStreamed = result.rejections.length ? null : { state: result.state, runtime }
    return result
  } catch (error) {
    currentStreamed = null
    if (!(error instanceof RangeError)) throw error
    if (!intents[0]) throw error
    return reject(state, intents[0], 'terrain_missing', 'Streamed terrain could not resume at this position.')
  }
}

function crossOutbound(state: PublicWorldState, intent: Extract<PublicWorldIntent, { type: 'move' }>,
  to: { x: number; z: number }): PublicWorldAdvanceResult {
  const from = state.player.position
  if (!connectorCrossing(state, from, to)) return reject(state, intent, 'off_connector',
    'Leave Greenway through the dry southwest connector.')
  const barrier = mireglassMoveBarrier(state.seed, from, to)
  if (barrier) return reject(state, intent, barrier, `The ${barrier} blocks the connector.`)
  try {
    const tile = worldTileAtGrid(state.seed, cellAt(to.x), cellAt(to.z))
    if (tile.terrain === 'wetland') return reject(state, intent, 'terrain_missing',
      'The destination is not dry streamed terrain.')
    const position = { x: to.x, y: Math.max(from.y, tile.center.y), z: to.z }
    const discoveredTileIds = [...new Set([...state.discoveredTileIds, tile.id])].sort()
    const runtime = createStreamedWorldFromState({
      seed: state.seed, tick: state.tick,
      player: { position, yaw: state.player.yaw, pitch: state.player.pitch,
        verticalVelocity: position.y === tile.center.y ? 0 : state.player.verticalVelocity },
      discoveredTileIds,
    })
    const destination = runtime.advance([])
    const eventSequence = state.eventSequence + (state.discoveredTileIds.includes(tile.id) ? 1 : 2)
    const events: PublicWorldEvent[] = [
      { type: 'player_moved', tick: destination.state.tick, sequence: state.eventSequence + 1,
        position: { ...destination.state.player.position } },
    ]
    if (!state.discoveredTileIds.includes(tile.id)) events.push({ type: 'tile_discovered',
      tick: destination.state.tick, sequence: eventSequence, tileId: tile.id })
    const next: PublicWorldState = { ...state, movementOwner: 'streamed', tick: destination.state.tick,
      rng: { ...state.rng, simulation: simulationRngStep(state.rng.simulation) },
      eventSequence, discoveredTileIds: destination.state.discoveredTileIds,
      player: { ...state.player, position: { ...destination.state.player.position },
        verticalVelocity: destination.state.player.verticalVelocity } }
    const result = settleStreamedMarket({ state: next, events, rejections: [] })
    currentStreamed = { state: result.state, runtime }
    return result
  } catch (error) {
    currentStreamed = null
    if (!(error instanceof RangeError)) throw error
    return reject(state, intent, 'terrain_missing', 'The streamed destination failed validation.')
  }
}

function crossOutboundFrame(state: PublicWorldState, intents: readonly PublicWorldIntent[],
  move: Extract<PublicWorldIntent, { type: 'move' }>, to: { x: number; z: number }): PublicWorldAdvanceResult {
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
  const crossed = crossOutbound(afterLook, move, to)
  if (crossed.rejections.length) return {
    state, events: [], rejections: crossed.rejections.map((rejection) => ({
      ...rejection, intentIndex: look ? 1 : 0,
    })),
  }
  if (!look) return crossed
  const events: PublicWorldEvent[] = [
    { type: 'player_looked', tick: crossed.state.tick,
      sequence: state.eventSequence + 1, yaw, pitch },
    ...crossed.events.map((event) => ({ ...event, sequence: event.sequence + 1 })),
  ]
  const next = { ...crossed.state, eventSequence: crossed.state.eventSequence + 1 }
  if (currentStreamed?.state === crossed.state) currentStreamed = { state: next, runtime: currentStreamed.runtime }
  return { state: next, events, rejections: [] }
}

/**
 * One bounded 50 ms frame. The only composite is look then move, matching the
 * control sampler's heading calculation. A rejected frame changes no state.
 */
export function advancePublicWorldFrame(
  state: PublicWorldState, intents: readonly PublicWorldIntent[],
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
      return arrivingGreenway ? stepGreenway(state, intents) : crossOutboundFrame(state, intents, move, to)
    }
    if (arrivingGreenway) {
      if (!connectorCrossing(state, from, to)) return reject(state, move, 'off_connector',
        'Return to Greenway through the dry southwest connector.', moveIndex)
      const barrier = mireglassMoveBarrier(state.seed, from, to)
      if (barrier) return reject(state, move, barrier, `The ${barrier} blocks the connector.`, moveIndex)
      try {
        if (currentStreamed?.state !== state) createStreamedWorldFromState(streamedSnapshot(state))
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        return reject(state, move, 'terrain_missing',
          'Streamed terrain cannot resume for the return.', moveIndex)
      }
      currentStreamed = null
      return stepGreenway(state, intents, true)
    }
  }
  return state.movementOwner === 'greenway' ? stepGreenway(state, intents) : stepStreamed(state, intents)
}

/** Compatibility entrypoint for one-intent callers. */
export function advancePublicWorld(state: PublicWorldState, intent: PublicWorldIntent): PublicWorldAdvanceResult {
  return advancePublicWorldFrame(state, [intent])
}
