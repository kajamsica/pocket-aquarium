import { resolveFieldCampSite } from './fieldCamp'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { isValidPublicWorldV7State } from './publicWorldV7'
import type { PublicWorldV7State } from './publicWorldV7'

export type PublicWorldV9State = PublicWorldV7State & {
  readonly fieldCampTileIds: readonly string[]
}

const STATE_KEYS = ['seed', 'generationProfile', 'movementOwner', 'tick', 'rng',
  'eventSequence', 'player', 'discoveredTileIds', 'greenway', 'mireglass', 'fieldCampTileIds']

/** V9 adds only canonical camp IDs; the exact v7 boundary remains authoritative. */
export function isValidPublicWorldV9State(value: unknown, bootstrap: PublicV6BootstrapRoot | null): value is PublicWorldV9State {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Reflect.ownKeys(value).length !== STATE_KEYS.length
    || !STATE_KEYS.every((key) => Object.hasOwn(value, key))) return false
  const { fieldCampTileIds, ...v7 } = value as Record<string, unknown>
  if (!Array.isArray(fieldCampTileIds) || fieldCampTileIds.length > 1
    || Reflect.ownKeys(fieldCampTileIds).length !== fieldCampTileIds.length + 1
    || fieldCampTileIds.length === 1 && !Object.hasOwn(fieldCampTileIds, '0')
    || !isValidPublicWorldV7State(v7, bootstrap)) return false
  return fieldCampTileIds.every((tileId) => typeof tileId === 'string'
    && v7.discoveredTileIds.includes(tileId) && resolveFieldCampSite(v7.seed, tileId) !== null)
}

/** The decoded v8 state is v7-shaped. Its migration adds only an empty camp list. */
export function withFreshPublicV9Camps(v8State: PublicWorldV7State): PublicWorldV9State {
  if (Object.hasOwn(v8State, 'fieldCampTileIds')) throw new RangeError('Camp history already exists on this state.')
  return { ...v8State, fieldCampTileIds: [] }
}
