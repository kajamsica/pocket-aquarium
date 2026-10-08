import { applyMireglassExpeditionAction } from './mireglassExpedition'
import type { MireglassExpeditionAction, MireglassExpeditionEvent, MireglassExpeditionRejection } from './mireglassExpedition'
import type { PublicWorldState } from './publicWorldState'
import { createStreamedWorldFromState } from './streamedWorld'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

type PublicActionRejection = MireglassExpeditionRejection | {
  actionType: MireglassExpeditionAction['type'] | 'unknown'
  code: 'unavailable_here' | 'invalid_destination'
  message: string
}

export type PublicMireglassActionResult =
  | { state: PublicWorldState; event: MireglassExpeditionEvent & { sequence: number }; rejection?: never }
  | { state: PublicWorldState; rejection: PublicActionRejection; event?: never }

/** Public actions do not advance a movement tick or RNG. A success consumes exactly one event sequence. */
export function actPublicMireglass(state: PublicWorldState, action: MireglassExpeditionAction): PublicMireglassActionResult {
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
        verticalVelocity: result.player.verticalVelocity }, discoveredTileIds })
    return { state: { ...state, player: result.player, mireglass: result.region,
      discoveredTileIds: destination.state.discoveredTileIds, eventSequence: state.eventSequence + 1 },
    event: { ...result.event, sequence: state.eventSequence + 1 } }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return reject('invalid_destination', 'Mireglass action would leave an invalid streamed world position or discovery state.')
  }
}
