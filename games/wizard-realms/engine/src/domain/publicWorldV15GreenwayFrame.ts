import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { publicV11Gait } from './publicWorldGait'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'
import { publicV14InsideGreenway } from './publicWorldV14Boundary'
import { publicV15StarterAdvanceMove, publicV15StarterSupportAt } from './publicWorldV15StarterMovement'
import type { PublicV15Progress } from './publicWorldV15Validation'
import { settleTradeListings, stepRng } from './world'

export type PublicV15GreenwayFrameResult = Readonly<{
  progress: PublicV15Progress
  events: PublicWorldEvent[]
  rejections: PublicWorldRejection[]
}>

const STEP_SECONDS = 0.05
const GRAVITY = 9.8
const JUMP_SPEED = 5
const MAX_YAW = 1e6
const EPSILON = 0.001

function reject(progress: PublicV15Progress, intents: readonly PublicWorldIntent[], index: number,
  code: PublicWorldRejection['code'], message: string): PublicV15GreenwayFrameResult {
  return { progress, events: [], rejections: [{ intentIndex: index,
    intentType: intents?.[index]?.type ?? 'move', code, message }] }
}

/** One native v15 Greenway frame. Preview and checked witness replay call this same reducer. */
export function advancePublicV15GreenwayFrame(progress: PublicV15Progress,
  intents: readonly PublicWorldIntent[], options: { walkRequested: boolean }): PublicV15GreenwayFrameResult {
  const { state, starterWorks } = progress
  if (state.movementOwner !== 'greenway') throw new RangeError('A Greenway v15 state is required.')
  if (!Array.isArray(intents) || typeof options?.walkRequested !== 'boolean'
    || intents.length > 2 || intents.length === 2
      && (intents[0]?.type !== 'look' || intents[1]?.type !== 'move')) {
    return reject(progress, intents, Math.max(0, Math.min(1, intents?.length - 1 || 0)),
      'invalid_frame', 'A frame accepts one action or a look followed by a move.')
  }
  if (!Number.isSafeInteger(state.tick + 1)
    || !Number.isSafeInteger(state.eventSequence + intents.length)) {
    return reject(progress, intents, 0, 'invalid_value', 'The world clock is exhausted.')
  }
  const unsupported = intents.findIndex((intent) => !intent || !['look', 'move', 'jump'].includes(intent.type))
  if (unsupported >= 0) return reject(progress, intents, unsupported, 'unavailable_here',
    'This movement frame does not own that action.')

  const context = { seed: state.seed, profile: state.generationProfile,
    route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: state.greenway.builtRouteIds.includes('greenway_ladder'), starterWorks }
  const player = { ...state.player, position: { ...state.player.position } }
  const events: PublicWorldEvent[] = []
  let sequence = state.eventSequence
  let discoveryMask = state.discoveryMask
  const tick = state.tick + 1

  for (const [index, intent] of intents.entries()) {
    if (intent.type === 'look') {
      const yaw = player.yaw + intent.yawDelta
      if (![intent.yawDelta, intent.pitchDelta, yaw].every(Number.isFinite)
        || Math.abs(yaw) > MAX_YAW) return reject(progress, intents, index, 'invalid_value',
        'The turn must be finite and within the allowed heading.')
      player.yaw = yaw
      player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.pitch + intent.pitchDelta))
      events.push({ type: 'player_looked', tick, sequence: ++sequence,
        yaw: player.yaw, pitch: player.pitch })
      continue
    }
    if (intent.type === 'jump') {
      const support = publicV15StarterSupportAt(context, player.position)
      if (!support || support.kind === 'ladder'
        || Math.abs(player.position.y - support.floorY) > EPSILON
        || player.verticalVelocity !== 0) return reject(progress, intents, index, 'airborne',
        'Jump only from supported ground.')
      player.verticalVelocity = JUMP_SPEED
      events.push({ type: 'player_jumped', tick, sequence: ++sequence })
      continue
    }
    const { x, z, y = 0 } = intent.delta ?? {}
    const target = { x: player.position.x + x, z: player.position.z + z }
    const limit = publicV11Gait(player.equipment.feet, options.walkRequested).metersPerStep
    if (![x, y, z, target.x, target.z].every(Number.isFinite)
      || y !== 0 || Math.hypot(x, z) > limit + 1e-9) {
      return reject(progress, intents, index, 'invalid_value',
        'The move exceeds the permitted horizontal gait.')
    }
    if (!publicV14InsideGreenway(target)) return reject(progress, intents, index,
      'unavailable_here', 'The streamed boundary is not available in this frame.')
    const move = publicV15StarterAdvanceMove(context, player.position, target, player.verticalVelocity)
    if (!move.accepted) {
      const code = move.reason === 'cliff_blocked' || move.reason === 'creek_blocked'
        ? 'locked_area' : move.reason === 'off_ladder' || move.reason === 'off_bridge'
          ? 'off_connector' : 'invalid_value'
      const message = move.reason === 'creek_blocked'
        ? 'Build the Greenway bridge to cross the creek.'
        : move.reason === 'off_bridge' ? 'Stay centered on the bridge planks.'
          : move.reason === 'cliff_blocked' ? 'Build the centered ladder to cross this cliff.'
            : move.reason === 'off_ladder' ? 'Stay within the ladder rails.'
              : 'The move has no valid starter support.'
      return reject(progress, intents, index, code, message)
    }
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
        if (!Number.isSafeInteger(sequence + added.length)) return reject(progress, intents,
          index, 'invalid_value', 'The discovery event sequence is exhausted.')
        discoveryMask = new Uint8Array(discoveryMask)
        const bits = encodeDiscoveredTileIds(added)
        for (let byte = 0; byte < discoveryMask.length; byte++) discoveryMask[byte] |= bits[byte]
        for (const tileId of added) events.push({ type: 'tile_discovered', tick,
          sequence: ++sequence, tileId })
      }
    }
  }

  const support = publicV15StarterSupportAt(context, player.position)
  if (!support) return reject(progress, intents, 0, 'invalid_value', 'The player has no terrain support.')
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
  if (!Number.isSafeInteger(sale.eventSequence)) return reject(progress, intents, 0,
    'invalid_value', 'The market event sequence is exhausted.')
  return { progress: { state: { ...state, tick, eventSequence: sale.eventSequence,
    rng: { ...state.rng, simulation: stepRng(state.rng.simulation) },
    player: sale.player, discoveryMask }, starterWorks },
  events: [...events, ...sale.events], rejections: [] }
}
