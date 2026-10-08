import { mireglassGreenwayToMarkerTrail } from './mireglassApproachTrail'
import type { MireglassItemId } from './mireglassExpedition'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { legacyMovementEnvelope } from './publicWorldV6'
import type { PublicWorldState } from './publicWorldState'
import { createStreamedWorldFromState } from './streamedWorld'
import type { StreamedWorldEvent, StreamedWorldIntent, StreamedWorldRejection, StreamedWorldRuntime } from './streamedWorld'
import type { IntentRejection, PlayerState, WizardEvent, WizardIntent, WizardWorldState } from './types'
import { advanceWizardWorld } from './world'
import { worldTileAtGrid } from './worldChunks'

/** One intent is one fixed step. A crossing never advances both authorities. */
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
  code: IntentRejection['code'] | StreamedWorldRejection['code'] | 'off_connector' | 'unavailable_here'
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
  code: PublicWorldRejection['code'], message: string): PublicWorldAdvanceResult => ({
  state, events: [], rejections: [{ intentIndex: 0, intentType: intent.type, code, message }],
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

function stepGreenway(state: PublicWorldState, intent: PublicWorldIntent,
  requireExactMove = false): PublicWorldAdvanceResult {
  const v5Intent: WizardIntent = intent.type === 'move'
    ? { type: 'move', delta: { x: intent.delta.x, y: 0, z: intent.delta.z } }
    : intent
  const result = advanceWizardWorld(greenwayWorld(state), [v5Intent])
  if (result.rejections.length) return { state, events: [], rejections: result.rejections }
  if (!Number.isSafeInteger(result.state.eventSequence)) {
    return reject(state, intent, 'invalid_value', 'The public event sequence is exhausted.')
  }
  if (requireExactMove && intent.type === 'move'
    && (result.state.player.position.x !== state.player.position.x + intent.delta.x
      || result.state.player.position.z !== state.player.position.z + intent.delta.z)) {
    return reject(state, intent, 'off_connector', 'The Greenway return is obstructed.')
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

function fromStreamed(state: PublicWorldState, intent: PublicWorldIntent,
  result: ReturnType<ReturnType<typeof createStreamedWorldFromState>['advance']>): PublicWorldAdvanceResult {
  if (result.rejections.length) {
    const rejection = result.rejections[0]
    return reject(state, intent,
      rejection.code, `Streamed movement was rejected: ${rejection.code}.`)
  }
  let eventSequence = state.eventSequence
  const events: PublicWorldEvent[] = result.events.map((event) => ({ ...event, sequence: ++eventSequence }))
  return {
    state: { ...state, movementOwner: 'streamed', tick: result.state.tick,
      rng: { ...state.rng, simulation: simulationRngStep(state.rng.simulation) },
      eventSequence, discoveredTileIds: result.state.discoveredTileIds,
      player: { ...state.player, position: { ...result.state.player.position },
        yaw: result.state.player.yaw, pitch: result.state.player.pitch,
        verticalVelocity: result.state.player.verticalVelocity } },
    events, rejections: [],
  }
}

function stepStreamed(state: PublicWorldState, intent: PublicWorldIntent): PublicWorldAdvanceResult {
  if (intent.type !== 'move' && intent.type !== 'look' && intent.type !== 'jump') {
    return reject(state, intent, 'unavailable_here', 'Greenway actions are unavailable beyond the connector.')
  }
  const streamedIntent: StreamedWorldIntent = intent.type === 'move'
    ? { type: 'move', delta: { x: intent.delta.x, z: intent.delta.z } } : intent
  try {
    const runtime = currentStreamed?.state === state
      ? currentStreamed.runtime : createStreamedWorldFromState(streamedSnapshot(state))
    const result = fromStreamed(state, intent, runtime.advance([streamedIntent]))
    currentStreamed = result.rejections.length ? null : { state: result.state, runtime }
    return result
  } catch (error) {
    currentStreamed = null
    if (!(error instanceof RangeError)) throw error
    return reject(state, intent, 'terrain_missing', 'Streamed terrain could not resume at this position.')
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
    currentStreamed = { state: next, runtime }
    return { state: next, events, rejections: [] }
  } catch (error) {
    currentStreamed = null
    if (!(error instanceof RangeError)) throw error
    return reject(state, intent, 'terrain_missing', 'The streamed destination failed validation.')
  }
}

/**
 * Pure public authority transition. Rejections are atomic, including tick, RNG and
 * event sequence. The caller supplies one intent per 50 ms fixed step.
 */
export function advancePublicWorld(state: PublicWorldState, intent: PublicWorldIntent): PublicWorldAdvanceResult {
  if (!Number.isSafeInteger(state.tick + 1) || !Number.isSafeInteger(state.eventSequence + 4)) {
    return reject(state, intent, 'invalid_value', 'The public world clock is exhausted.')
  }
  if (intent.type === 'move') {
    const { x, z, y = 0 } = intent.delta
    if (![x, y, z].every(Number.isFinite) || y !== 0 || Math.hypot(x, z) > 4
      || !Number.isFinite(state.player.position.x + x) || !Number.isFinite(state.player.position.z + z)) {
      return reject(state, intent, 'invalid_value', 'Movement must be finite, horizontal and at most four meters.')
    }
    const from = state.player.position
    const to = { x: from.x + x, z: from.z + z }
    const envelope = legacyMovementEnvelope({ generationProfile: state.generationProfile,
      tiles: state.greenway.tiles })
    const arrivingGreenway = within(to.x, to.z, envelope)
    if (state.movementOwner === 'greenway') {
      return arrivingGreenway ? stepGreenway(state, intent) : crossOutbound(state, intent, to)
    }
    if (arrivingGreenway) {
      if (!connectorCrossing(state, from, to)) return reject(state, intent, 'off_connector',
        'Return to Greenway through the dry southwest connector.')
      const barrier = mireglassMoveBarrier(state.seed, from, to)
      if (barrier) return reject(state, intent, barrier, `The ${barrier} blocks the connector.`)
      try {
        if (currentStreamed?.state !== state) createStreamedWorldFromState(streamedSnapshot(state))
      } catch (error) {
        if (!(error instanceof RangeError)) throw error
        return reject(state, intent, 'terrain_missing', 'Streamed terrain cannot resume for the return.')
      }
      currentStreamed = null
      return stepGreenway(state, intent, true)
    }
  }
  return state.movementOwner === 'greenway' ? stepGreenway(state, intent) : stepStreamed(state, intent)
}
