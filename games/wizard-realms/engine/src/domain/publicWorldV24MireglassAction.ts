import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './discoveryMask'
import { applyMireglassExpeditionAction } from './mireglassExpedition'
import { applyMireglassHerbForage } from './mireglassHerbForaging'
import type { PublicMireglassAction, PublicMireglassEvent } from './publicWorldActions'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { decodePublicV23Progress, exactPublicV23 } from './publicWorldV23Snapshot'
import type { PublicV23Progress } from './publicWorldV23Snapshot'

export type PublicV24MireglassAction = PublicMireglassAction
  | { type: 'cast_wayfinder_glow_wide' }

const boundedId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 160
const positiveCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0

/** V24 accepts only an exact action request, never a proposed result or route teleport. */
export function decodePublicV24MireglassAction(raw: unknown): PublicV24MireglassAction | null {
  if (!raw || typeof raw !== 'object') return null
  const type = Object.getOwnPropertyDescriptor(raw, 'type')?.value
  if (type === 'study_fringe_marker' || type === 'discover_fairy_ring'
    || type === 'cast_wayfinder_glow' || type === 'cast_wayfinder_glow_wide'
    || type === 'excavate_cache') {
    return exactPublicV23(raw, ['type']) ? { type } : null
  }
  if (type === 'chop_tree' || type === 'dig_tree_stump') {
    return exactPublicV23(raw, ['type', 'resourceId']) && boundedId(raw.resourceId)
      ? { type, resourceId: raw.resourceId } : null
  }
  if (type === 'build_route') return exactPublicV23(raw, ['type', 'siteId']) && boundedId(raw.siteId)
    ? { type, siteId: raw.siteId } : null
  if (type === 'forage_herb') return exactPublicV23(raw, ['type', 'patchId']) && boundedId(raw.patchId)
    ? { type, patchId: raw.patchId } : null
  if (type === 'buy_item') return exactPublicV23(raw, ['type', 'itemId'])
    && (raw.itemId === 'field_spade' || raw.itemId === 'mireglass_reach/item/waders')
    ? { type, itemId: raw.itemId } : null
  if (type === 'equip_item') return exactPublicV23(raw, ['type', 'itemId'])
    && (raw.itemId === 'woodcutters_axe' || raw.itemId === 'field_spade'
      || raw.itemId === 'leather_boots' || raw.itemId === 'mireglass_reach/item/waders')
    ? { type, itemId: raw.itemId } : null
  if (type === 'sell_item') return exactPublicV23(raw, ['type', 'itemId', 'quantity'])
    && (raw.itemId === 'logs' || raw.itemId === 'mireglass_reach/item/seal')
    && positiveCount(raw.quantity)
    ? { type, itemId: raw.itemId, quantity: raw.quantity } : null
  return null
}

export type PublicV24MireglassActionResult =
  | { progress: PublicV23Progress; events: readonly (PublicMireglassEvent & { sequence: number })[];
      rejection?: never }
  | { rejection: string; progress?: never; events?: never }

/** Authoritative action transition over V23-compatible progress. No movement tick or RNG step. */
export function applyPublicV24MireglassAction(progress: PublicV23Progress,
  action: PublicV24MireglassAction): PublicV24MireglassActionResult {
  try {
    const request = decodePublicV24MireglassAction(action)
    if (!request) return { rejection: 'invalid-action' }
    const owned = decodePublicV23Progress(progress, progress?.state?.seed)
    if (!owned) return { rejection: 'invalid-progress' }
    const { state } = owned
    if (state.movementOwner !== 'streamed') return { rejection: 'unavailable_here' }
    const position = state.player.position
    const surface = resolvePublicV23Surface(state, position, owned.regionalWorks.builtLadderIds)
    if (!surface || state.player.verticalVelocity !== 0
      || Math.abs(position.y - surface.floorY) > 1e-6) return { rejection: 'invalid-pose' }
    if (!Number.isSafeInteger(state.eventSequence + 1)) return { rejection: 'invalid-sequence' }

    const discovered = decodeDiscoveredTileIds(state.discoveryMask)
    const result = request.type === 'forage_herb'
      ? applyMireglassHerbForage(state.seed, state.player, state.mireglass, state.tick, request.patchId)
      : applyMireglassExpeditionAction(state.seed, state.player, state.mireglass,
        request.type === 'cast_wayfinder_glow_wide' ? { type: 'cast_wayfinder_glow' } : request,
        discovered, true, request.type === 'cast_wayfinder_glow_wide')
    if (result.rejection) return { rejection: result.rejection.code }
    const revealed = result.event.type === 'terrain_revealed' || result.event.type === 'cache_revealed'
      ? result.event.revealedTileIds : []
    const mask = new Uint8Array(state.discoveryMask)
    if (revealed.length) {
      const added = encodeDiscoveredTileIds([...new Set(revealed)].sort())
      for (let index = 0; index < mask.length; index++) mask[index] |= added[index]
    }
    const postDigSurface = request.type === 'excavate_cache'
      ? resolvePublicV23Surface({ ...state, mireglass: { ...state.mireglass, ...result.region } }, result.player.position,
        owned.regionalWorks.builtLadderIds) : null
    if (request.type === 'excavate_cache' && !postDigSurface) return { rejection: 'invalid-destination' }
    const landedPlayer = postDigSurface && result.player.position.y !== postDigSurface.floorY
      ? { ...result.player, position: { ...result.player.position, y: postDigSurface.floorY },
        verticalVelocity: 0 }
      : result.player
    const sequence = state.eventSequence + 1
    const next = decodePublicV23Progress({ ...owned, state: { ...state,
      player: landedPlayer, mireglass: result.region, discoveryMask: mask,
      eventSequence: sequence } }, state.seed)
    return next ? { progress: next, events: [{ ...result.event, sequence }] }
      : { rejection: 'invalid-destination' }
  } catch { return { rejection: 'invalid-progress' } }
}
