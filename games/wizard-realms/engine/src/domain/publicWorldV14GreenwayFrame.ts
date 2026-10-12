import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { publicV11Gait } from './publicWorldGait'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { starterCliffAdvanceMove, starterCliffSupportAt } from './starterCliffMovement'
import { STARTER_CLIFF_PROFILE } from './starterCliffProfile'
import { settleTradeListings, stepRng } from './world'

export interface PublicV14GreenwayFrameResult {
  state: PublicV14State
  events: PublicWorldEvent[]
  rejections: PublicWorldRejection[]
}

const STEP_SECONDS = 0.05
const GRAVITY = 9.8
const JUMP_SPEED = 5
const MAX_YAW = 1e6
const EPSILON = 0.001

function reject(state: PublicV14State, intents: readonly PublicWorldIntent[], index: number,
  code: PublicWorldRejection['code'], message: string): PublicV14GreenwayFrameResult {
  return { state, events: [], rejections: [{ intentIndex: index,
    intentType: intents?.[index]?.type ?? 'move', code, message }] }
}

/** One pure 50 ms Greenway frame. Input must come from a validated v14 head or this frame's output.
 * Airborne output remains in memory until landing; the current v14 save proof accepts grounded poses only.
 * Outbound movement stays fenced until a separate v14 boundary authority is installed. */
export function advancePublicV14GreenwayFrame(state: PublicV14State,
  intents: readonly PublicWorldIntent[], options: { walkRequested: boolean }): PublicV14GreenwayFrameResult {
  if (state.generationProfile !== STARTER_CLIFF_PROFILE || state.movementOwner !== 'greenway') {
    throw new RangeError('A validated starter-cliff Greenway state is required.')
  }
  if (!Array.isArray(intents) || typeof options?.walkRequested !== 'boolean'
    || intents.length > 2 || intents.length === 2
      && (intents[0]?.type !== 'look' || intents[1]?.type !== 'move')) {
    return reject(state, intents, Math.max(0, Math.min(1, intents?.length - 1 || 0)),
      'invalid_frame', 'A frame accepts one action or a look followed by a move.')
  }
  if (!Number.isSafeInteger(state.tick + 1)
    || !Number.isSafeInteger(state.eventSequence + intents.length)) {
    return reject(state, intents, 0, 'invalid_value', 'The world clock is exhausted.')
  }
  const unsupported = intents.findIndex((intent) => !intent || !['look', 'move', 'jump'].includes(intent.type))
  if (unsupported >= 0) return reject(state, intents, unsupported, 'unavailable_here',
    'This v14 movement frame does not own that action.')

  const context = { seed: state.seed, profile: state.generationProfile,
    route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: state.greenway.builtRouteIds.includes('greenway_ladder') }
  const player = { ...state.player, position: { ...state.player.position } }
  const events: PublicWorldEvent[] = []
  let sequence = state.eventSequence
  let discoveryMask = state.discoveryMask
  const tick = state.tick + 1
  const envelope = state.greenway.tiles.reduce((bounds, tile) => ({
    minX: Math.min(bounds.minX, tile.center.x - 2),
    maxX: Math.max(bounds.maxX, tile.center.x + 2),
    minZ: Math.min(bounds.minZ, tile.center.z - 2),
    maxZ: Math.max(bounds.maxZ, tile.center.z + 2),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity })

  for (const [index, intent] of intents.entries()) {
    if (intent.type === 'look') {
      const yaw = player.yaw + intent.yawDelta
      if (![intent.yawDelta, intent.pitchDelta, yaw].every(Number.isFinite)
        || Math.abs(yaw) > MAX_YAW) return reject(state, intents, index, 'invalid_value',
        'The turn must be finite and within the allowed heading.')
      player.yaw = yaw
      player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.pitch + intent.pitchDelta))
      events.push({ type: 'player_looked', tick, sequence: ++sequence,
        yaw: player.yaw, pitch: player.pitch })
      continue
    }
    if (intent.type === 'jump') {
      const support = starterCliffSupportAt(context, player.position)
      if (!support || support.kind === 'ladder'
        || Math.abs(player.position.y - support.floorY) > EPSILON
        || player.verticalVelocity !== 0) return reject(state, intents, index, 'airborne',
        'Jump only from ordinary ground.')
      player.verticalVelocity = JUMP_SPEED
      events.push({ type: 'player_jumped', tick, sequence: ++sequence })
      continue
    }
    const { x, z, y = 0 } = intent.delta ?? {}
    const target = { x: player.position.x + x, z: player.position.z + z }
    const limit = publicV11Gait(player.equipment.feet, options.walkRequested).metersPerStep
    if (![x, y, z, target.x, target.z].every(Number.isFinite)
      || y !== 0 || Math.hypot(x, z) > limit + 1e-9) {
      return reject(state, intents, index, 'invalid_value', 'The move exceeds the permitted horizontal gait.')
    }
    if (target.x < envelope.minX || target.x > envelope.maxX
      || target.z < envelope.minZ || target.z > envelope.maxZ) {
      return reject(state, intents, index, 'unavailable_here',
        'The v14 streamed boundary is not available in this frame.')
    }
    const move = starterCliffAdvanceMove(context, player.position, target, player.verticalVelocity)
    if (!move.accepted) return reject(state, intents, index,
      move.reason === 'cliff_blocked' ? 'locked_area'
        : move.reason === 'off_ladder' ? 'off_connector' : 'invalid_value',
      move.reason === 'cliff_blocked' ? 'Build the centered ladder to cross this cliff.'
        : move.reason === 'off_ladder' ? 'Stay within the ladder rails.'
          : 'The move has no valid starter-cliff support.')
    const moved = target.x !== player.position.x || target.z !== player.position.z
    player.position = move.position
    if (move.support.kind === 'ladder' || player.position.y === move.support.floorY) {
      player.verticalVelocity = 0
    }
    events.push({ type: 'player_moved', tick, sequence: ++sequence,
      position: { ...player.position } })
    if (moved) {
      const added = nearbyWorldTileIds(player.position, PUBLIC_WALK_REVEAL_RADIUS_METERS)
        .filter((id) => !discoveryMaskHasTileId(discoveryMask, id))
      if (added.length) {
        if (!Number.isSafeInteger(sequence + added.length)) return reject(state, intents,
          index, 'invalid_value', 'The discovery event sequence is exhausted.')
        discoveryMask = new Uint8Array(discoveryMask)
        const bits = encodeDiscoveredTileIds(added)
        for (let byte = 0; byte < discoveryMask.length; byte++) discoveryMask[byte] |= bits[byte]
        for (const tileId of added) events.push({ type: 'tile_discovered', tick,
          sequence: ++sequence, tileId })
      }
    }
  }

  const support = starterCliffSupportAt(context, player.position)
  if (!support) return reject(state, intents, 0, 'invalid_value', 'The player has no terrain support.')
  if (player.position.y > support.floorY || player.verticalVelocity > 0) {
    player.position.y += player.verticalVelocity * STEP_SECONDS
    player.verticalVelocity = Math.max(-50, player.verticalVelocity - GRAVITY * STEP_SECONDS)
    if (player.position.y <= support.floorY) {
      player.position.y = support.floorY
      player.verticalVelocity = 0
    }
  } else {
    player.position.y = support.floorY
    player.verticalVelocity = 0
  }
  const sale = settleTradeListings(player, tick, sequence)
  if (!Number.isSafeInteger(sale.eventSequence)) return reject(state, intents, 0,
    'invalid_value', 'The market event sequence is exhausted.')
  return { state: { ...state, tick, eventSequence: sale.eventSequence,
    rng: { ...state.rng, simulation: stepRng(state.rng.simulation) },
    player: sale.player, discoveryMask }, events: [...events, ...sale.events], rejections: [] }
}
