import { HIGHLAND_WIND_CONTENT_REVISION, HIGHLAND_WINDWARD_STEP,
  isHighlandWindTrailSegmentIndex } from './highlandWindContent'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { isValidPublicWorldV11State } from './publicWorldV11State'
import type { PublicWorldV11State } from './publicWorldV11State'

export type PublicWorldV12State = PublicWorldV11State & {
  readonly windContentRevision: typeof HIGHLAND_WIND_CONTENT_REVISION
  readonly windstep: {
    readonly learned: boolean
    readonly activeUntilTick: number
    readonly nextCastTick: number
    readonly practicedRouteIndices: readonly number[]
  }
}

const STATE_KEYS = ['seed', 'generationProfile', 'movementOwner', 'tick', 'rng',
  'eventSequence', 'player', 'discoveredTileIds', 'greenway', 'mireglass',
  'fieldCampTileIds', 'terrainRevision', 'highlandContentRevision', 'highland',
  'windContentRevision', 'windstep']
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

/** The v12 wind ledger is additive; v11 continues to reject its extra keys. */
export function isValidPublicWorldV12State(value: unknown,
  bootstrap: PublicV6BootstrapRoot | null): value is PublicWorldV12State {
  if (!exact(value, STATE_KEYS)
    || value.windContentRevision !== HIGHLAND_WIND_CONTENT_REVISION
    || !exact(value.windstep, ['learned', 'activeUntilTick', 'nextCastTick',
      'practicedRouteIndices'])) return false
  try {
    const { windContentRevision: _revision, windstep: _windstep, ...v11 } = value
    if (!isValidPublicWorldV11State(v11, bootstrap)) return false
    const windstep = value.windstep
    if (typeof windstep.learned !== 'boolean'
      || !Number.isSafeInteger(windstep.activeUntilTick)
      || !Number.isSafeInteger(windstep.nextCastTick)
      || (windstep.activeUntilTick as number) < 0
      || (windstep.nextCastTick as number) < 0
      || (windstep.activeUntilTick as number) > (windstep.nextCastTick as number)
      || !Array.isArray(windstep.practicedRouteIndices)) return false

    const activeUntilTick = windstep.activeUntilTick as number
    const nextCastTick = windstep.nextCastTick as number
    if ((activeUntilTick > v11.tick
        && activeUntilTick - v11.tick > HIGHLAND_WINDWARD_STEP.durationTicks)
      || (nextCastTick > v11.tick
        && nextCastTick - v11.tick > HIGHLAND_WINDWARD_STEP.cooldownTicks)) return false
    // The authority only writes both clocks from one cast. Retain the pair after
    // expiry, so a partial reset or independently forged clock cannot be loaded.
    if (activeUntilTick !== 0 || nextCastTick !== 0) {
      const castTick = nextCastTick - HIGHLAND_WINDWARD_STEP.cooldownTicks
      if (castTick < 0 || castTick > v11.tick
        || activeUntilTick !== castTick + HIGHLAND_WINDWARD_STEP.durationTicks) return false
    }
    if (!windstep.learned && (activeUntilTick !== 0 || nextCastTick !== 0
      || windstep.practicedRouteIndices.length !== 0)) return false
    if (windstep.learned && !v11.highland.landmarkDiscovered) return false
    if (windstep.practicedRouteIndices.length > 0 && activeUntilTick === 0) return false
    let previous = -1
    for (const index of windstep.practicedRouteIndices) {
      if (!isHighlandWindTrailSegmentIndex(index) || index <= previous) return false
      previous = index
    }
    return true
  } catch { return false }
}

/** Additive, deterministic migration from an already validated v11 source. */
export function withPublicV12Windstep(v11State: PublicWorldV11State): PublicWorldV12State {
  if (Object.hasOwn(v11State, 'windContentRevision') || Object.hasOwn(v11State, 'windstep')) {
    throw new RangeError('Windward Step revision already exists on this state.')
  }
  return { ...v11State, windContentRevision: HIGHLAND_WIND_CONTENT_REVISION,
    windstep: { learned: false, activeUntilTick: 0, nextCastTick: 0,
      practicedRouteIndices: [] } }
}
