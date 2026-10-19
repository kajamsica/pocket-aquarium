import { applyMireglassExpeditionAction } from './mireglassExpedition'
import type { MireglassExpeditionAction, MireglassExpeditionEvent, MireglassExpeditionRejection } from './mireglassExpedition'
import { applyMireglassHerbForage } from './mireglassHerbForaging'
import type { MireglassHerbForageResult, MireglassHerbRegionProgress } from './mireglassHerbForaging'
import type { PublicWorldState } from './publicWorldState'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { isValidPublicWorldV10State } from './publicWorldV10State'
import type { PublicWorldV10State } from './publicWorldV10State'
import { createStreamedWorldFromState } from './streamedWorld'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

type PublicActionRejection = {
  actionType: PublicMireglassAction['type'] | 'unknown'
  code: MireglassExpeditionRejection['code']
    | NonNullable<MireglassHerbForageResult['rejection']>['code'] | 'unavailable_here' | 'invalid_destination'
  message: string
}

export type PublicMireglassAction = MireglassExpeditionAction | { type: 'forage_herb'; patchId: string }
export type PublicMireglassEvent = MireglassExpeditionEvent
  | NonNullable<MireglassHerbForageResult['event']>

export type PublicMireglassActionResult =
  | { state: PublicWorldState; event: PublicMireglassEvent & { sequence: number }; rejection?: never }
  | { state: PublicWorldState; rejection: PublicActionRejection; event?: never }
export type PublicMireglassV10ActionResult =
  | { state: PublicWorldV10State; event: PublicMireglassEvent & { sequence: number }; rejection?: never }
  | { state: PublicWorldV10State; rejection: PublicActionRejection; event?: never }

/** Public actions do not advance a movement tick or RNG. A success consumes exactly one event sequence. */
function actPublicMireglassInternal(state: PublicWorldState, action: PublicMireglassAction,
  useV10Terrain: boolean): PublicMireglassActionResult {
  const reject = (code: PublicActionRejection['code'], message: string): PublicMireglassActionResult => ({
    state, rejection: { actionType: action?.type ?? 'unknown', code, message },
  })
  if (state.movementOwner !== 'streamed') {
    return reject('unavailable_here', 'Mireglass actions are unavailable while Greenway owns movement.')
  }
  if (!Number.isSafeInteger(state.eventSequence) || state.eventSequence < 0
    || !Number.isSafeInteger(state.eventSequence + 1)
    || !Number.isSafeInteger(state.tick) || state.tick < 0) {
    return reject('invalid_value', 'The public world clock or event sequence is invalid.')
  }
  if (action.type === 'forage_herb') {
    if (!Array.isArray((state.mireglass as Partial<MireglassHerbRegionProgress>).herbHarvestCycles)) {
      return reject('invalid_progress', 'This world needs the v7 herb save before foraging.')
    }
    const result = applyMireglassHerbForage(state.seed, state.player,
      state.mireglass as MireglassHerbRegionProgress, state.tick, action.patchId)
    if (result.rejection) return { state, rejection: { actionType: action.type, ...result.rejection } }
    return { state: { ...state, player: result.player, mireglass: result.region,
      eventSequence: state.eventSequence + 1 },
    event: { ...result.event, sequence: state.eventSequence + 1 } }
  }
  const result = applyMireglassExpeditionAction(state.seed, state.player, state.mireglass, action,
    state.discoveredTileIds)
  if (result.rejection) return { state, rejection: result.rejection }

  const { position } = result.player
  try {
    const revealedTileIds = result.event.type === 'route_traversed'
      ? [worldTileAtGrid(state.seed, position.x / WORLD_CELL_METERS, position.z / WORLD_CELL_METERS).id]
      : result.event.type === 'terrain_revealed' || result.event.type === 'cache_revealed'
        ? result.event.revealedTileIds : []
    const discoveredTileIds = [...new Set([...state.discoveredTileIds, ...revealedTileIds])].sort()
    // Restore validates the actual destination, current-tile discovery, and serializable streamed pose.
    const destination = createStreamedWorldFromState({ seed: state.seed, tick: state.tick,
      player: { position, yaw: result.player.yaw, pitch: result.player.pitch,
        verticalVelocity: result.player.verticalVelocity }, discoveredTileIds },
    useV10Terrain ? { cachePitDug: result.region.cacheExcavated } : undefined)
    return { state: { ...state, player: result.player, mireglass: result.region,
      discoveredTileIds: destination.state.discoveredTileIds, eventSequence: state.eventSequence + 1 },
    event: { ...result.event, sequence: state.eventSequence + 1 } }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return reject('invalid_destination', 'Mireglass action would leave an invalid streamed world position or discovery state.')
  }
}

export function actPublicMireglass(state: PublicWorldState, action: PublicMireglassAction): PublicMireglassActionResult {
  return actPublicMireglassInternal(state, action, false)
}

/** V10 accepts only its validated shape and derives terrain from the committed dig fact. */
export function actPublicV10Mireglass(state: PublicWorldV10State, action: PublicMireglassAction,
  bootstrap: PublicV6BootstrapRoot | null = null): PublicMireglassV10ActionResult {
  if (!isValidPublicWorldV10State(state, bootstrap)) return { state,
    rejection: { actionType: action?.type ?? 'unknown', code: 'invalid_progress',
      message: 'The v10 world state is invalid.' } }
  const result = actPublicMireglassInternal(state, action, true)
  if (result.rejection) return { state, rejection: result.rejection }
  const next = result.state as PublicWorldV10State
  if (!isValidPublicWorldV10State(next, bootstrap)) return { state,
    rejection: { actionType: action?.type ?? 'unknown', code: 'invalid_destination',
      message: 'The v10 action would leave an invalid world state.' } }
  return { state: next, event: result.event }
}
