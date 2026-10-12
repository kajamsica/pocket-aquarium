import { discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { publicV11Gait } from './publicWorldGait'
import type { PublicWorldEvent, PublicWorldIntent, PublicWorldRejection } from './publicWorldRuntime'
import { advancePublicV14GreenwayAction } from './publicWorldV14Actions'
import { publicV14InsideGreenway } from './publicWorldV14Boundary'
import { createFreshPublicV14State, validatePublicV14State } from './publicWorldV14Validation'
import { publicWorldV15SuppressedStarterResourceIds } from './publicWorldV15StarterSites'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import { publicV17StarterAdvanceMove, publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import type { PublicV17GroundStepPolicy, PublicV17StarterSupport } from './publicWorldV17StarterMovement'
import { starterCliffSupportAt } from './starterCliffMovement'
import { decodePublicV17Progress } from './publicWorldV17Validation'
import type { PublicV17Progress } from './publicWorldV17Validation'
import { settleTradeListings, stepRng } from './world'

export type PublicV17GreenwayFrameResult = Readonly<{
  progress: PublicV17Progress
  events: PublicWorldEvent[]
  rejections: PublicWorldRejection[]
}>

const STEP_SECONDS = 0.05
const GRAVITY = 9.8
const JUMP_SPEED = 5
const MAX_YAW = 1e6
const EPSILON = 0.001

function reject(progress: PublicV17Progress, intents: readonly PublicWorldIntent[], index: number,
  code: PublicWorldRejection['code'], message: string): PublicV17GreenwayFrameResult {
  return { progress, events: [], rejections: [{ intentIndex: index,
    intentType: intents?.[index]?.type ?? 'move', code, message }] }
}

/** One native v17 Greenway frame. The checked writer replays persisted witnesses here. */
export function advancePublicV17GreenwayFrame(progress: PublicV17Progress,
  intents: readonly PublicWorldIntent[], options: { walkRequested: boolean },
  policy?: PublicV17GroundStepPolicy): PublicV17GreenwayFrameResult {
  const { state, greenwayWorks } = progress
  if (state.movementOwner !== 'greenway') throw new RangeError('A Greenway v17 state is required.')
  if (!Array.isArray(intents) || typeof options?.walkRequested !== 'boolean'
    || intents.length > 2 || intents.length === 2
      && (intents[0]?.type !== 'look' || intents[1]?.type !== 'move')) {
    return reject(progress, intents, 0, 'invalid_frame',
      'A frame accepts one action or a look followed by a move.')
  }
  if (!Number.isSafeInteger(state.tick + 1)
    || !Number.isSafeInteger(state.eventSequence + intents.length)) {
    return reject(progress, intents, 0, 'invalid_value', 'The world clock is exhausted.')
  }
  const unsupported = intents.findIndex((intent) => !intent
    || !['look', 'move', 'jump'].includes(intent.type))
  if (unsupported >= 0) return reject(progress, intents, unsupported, 'unavailable_here',
    'This frame owns movement only; work requires a checked writer.')

  const context = { seed: state.seed, profile: state.generationProfile,
    route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: state.greenway.builtRouteIds.includes('greenway_ladder'), greenwayWorks }
  const player = { ...state.player, position: { ...state.player.position } }
  const events: PublicWorldEvent[] = []
  let sequence = state.eventSequence
  let discoveryMask = state.discoveryMask
  let movementSupport: PublicV17StarterSupport | null = null
  const tick = state.tick + 1

  for (const [index, intent] of intents.entries()) {
    if (intent.type === 'look') {
      const yaw = player.yaw + intent.yawDelta
      if (![intent.yawDelta, intent.pitchDelta, yaw].every(Number.isFinite)
        || Math.abs(yaw) > MAX_YAW) return reject(progress, intents, index, 'invalid_value',
        'The turn must be finite and within the allowed heading.')
      player.yaw = yaw
      player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2,
        player.pitch + intent.pitchDelta))
      events.push({ type: 'player_looked', tick, sequence: ++sequence,
        yaw: player.yaw, pitch: player.pitch })
      continue
    }
    if (intent.type === 'jump') {
      const support = publicV17StarterSupportAt(context, player.position)
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
    const move = publicV17StarterAdvanceMove(context, player.position, target,
      player.verticalVelocity, policy)
    if (!move.accepted) {
      const code = move.reason === 'cliff_blocked' || move.reason === 'creek_blocked'
        ? 'locked_area' : move.reason === 'off_ladder' || move.reason === 'off_bridge'
          ? 'off_connector' : 'invalid_value'
      let bridgeHint = 'Stay centered on the built bridge.'
      if (move.reason === 'off_bridge') {
        let nearest: { centerX: number; halfWidth: number } | null = null
        for (const id of greenwayWorks.builtBridgeIds) {
          if (!id.startsWith('works4:')) continue
          const bridge = resolvePublicV17GreenwaySite(state.seed, id)
          if (bridge?.kind !== 'bridge') continue
          if (!nearest || Math.abs(target.x - bridge.from.x)
            < Math.abs(target.x - nearest.centerX)) {
            nearest = { centerX: bridge.from.x, halfWidth: bridge.widthMeters / 2 }
          }
        }
        if (nearest) {
          const center = nearest.centerX.toFixed(1)
          const left = (nearest.centerX - nearest.halfWidth).toFixed(1)
          const right = (nearest.centerX + nearest.halfWidth).toFixed(1)
          bridgeHint = `Move to a dry-bank end of the built bridge centered at x=${center} m `
            + `(lane x=${left} to ${right} m), then cross straight along its rails.`
        }
      }
      const message = move.reason === 'creek_blocked'
        ? 'Build a Greenway bridge lane to cross the creek.'
        : move.reason === 'off_bridge' ? bridgeHint
          : move.reason === 'cliff_blocked' ? 'Build a ladder at this cliff face.'
            : move.reason === 'off_ladder' ? 'Stay within the ladder rails.'
              : 'The move has no valid v17 support.'
      return reject(progress, intents, index, code, message)
    }
    const moved = target.x !== player.position.x || target.z !== player.position.z
    player.position = move.position
    movementSupport = move.support
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

  const support = movementSupport ?? publicV17StarterSupportAt(context, player.position)
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
    player: sale.player, discoveryMask }, greenwayWorks },
  events: [...events, ...sale.events], rejections: [] }
}

/** Core actions retain v14 rules only at poses valid on both support surfaces. */
export function advancePublicV17GreenwayAction(before: PublicV17Progress,
  intent: PublicWorldIntent): PublicV17GreenwayFrameResult {
  const rejectAction = (code: PublicWorldRejection['code']) => ({ progress: before,
    events: [], rejections: [{ intentIndex: 0, intentType: intent?.type ?? 'move',
      code, message: 'The action is unavailable at this v17 position.' }] })
  const valid = decodePublicV17Progress(before, before?.state?.seed)
  if (!valid || valid.state.movementOwner !== 'greenway') return rejectAction('unavailable_here')
  const magic = intent?.type === 'study_inscription' || intent?.type === 'cast_spell'
  const state = valid.state
  const oldSupport = magic ? starterCliffSupportAt({ seed: state.seed,
    profile: state.generationProfile,
    route: state.greenway.routes.find((entry) => entry.id === 'greenway_ladder') ?? null,
    built: state.greenway.builtRouteIds.includes('greenway_ladder') },
  state.player.position) : null
  const core = magic ? { ...state, player: { ...state.player,
    position: oldSupport
      ? { ...state.player.position, y: oldSupport.floorY }
      : createFreshPublicV14State(state.seed).player.position,
    verticalVelocity: oldSupport ? state.player.verticalVelocity : 0 } } : state
  if (!validatePublicV14State(core, state.seed)) return rejectAction('unavailable_here')
  if (intent?.type === 'harvest' && publicWorldV15SuppressedStarterResourceIds(
    valid.state.seed, valid.state.greenway.resources).includes(intent.resourceId)) {
    return rejectAction('not_found')
  }
  try {
    const result = advancePublicV14GreenwayAction(core, intent, magic, state.player.position)
    if (result.rejections.length) return { progress: before, events: [], rejections: result.rejections }
    const nextState = magic ? { ...result.state, player: { ...result.state.player,
      position: { ...state.player.position } } } : result.state
    const next = decodePublicV17Progress({ state: nextState,
      greenwayWorks: valid.greenwayWorks }, valid.state.seed)
    return next ? { progress: next, events: result.events, rejections: [] }
      : rejectAction('invalid_value')
  } catch { return rejectAction('invalid_value') }
}
