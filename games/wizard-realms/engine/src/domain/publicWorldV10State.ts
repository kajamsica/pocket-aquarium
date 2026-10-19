import { createActiveWorldTerrain } from './activeWorldTerrain'
import type { PublicV6BootstrapRoot } from './publicWorldV6'
import { isValidPublicWorldV9State } from './publicWorldV9State'
import type { PublicWorldV9State } from './publicWorldV9State'
import { createStreamedWorldFromState } from './streamedWorld'

export const PUBLIC_V10_TERRAIN_REVISION = 'mireglass-cache-pit-v1'

export type PublicWorldV10State = PublicWorldV9State & {
  readonly terrainRevision: typeof PUBLIC_V10_TERRAIN_REVISION
}

/** A detached v9-shaped proof only. Never persist or simulate this adjusted pose. */
export function publicV10BaseGroundWitness(state: PublicWorldV10State): PublicWorldV9State {
  const { terrainRevision: _revision, ...v9 } = state
  if (state.movementOwner !== 'streamed') return v9
  const position = state.player.position
  const terrain = createActiveWorldTerrain(state.seed)
  terrain.activate(position)
  const base = terrain.tileAtWorld(position.x, position.z)
  if (!base) throw new RangeError('Missing base ground for v10 pose.')
  return { ...v9, player: { ...state.player,
    position: { ...position, y: Math.max(position.y, base.center.y) } } }
}

const STATE_KEYS = ['seed', 'generationProfile', 'movementOwner', 'tick', 'rng',
  'eventSequence', 'player', 'discoveredTileIds', 'greenway', 'mireglass',
  'fieldCampTileIds', 'terrainRevision']

/** V9 remains seed-only. Only this validator accepts a landed pose on the lowered cache cell. */
export function isValidPublicWorldV10State(value: unknown,
  bootstrap: PublicV6BootstrapRoot | null): value is PublicWorldV10State {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Reflect.ownKeys(value).length !== STATE_KEYS.length
    || !STATE_KEYS.every((key) => Object.hasOwn(value, key))) return false
  if ((value as Record<string, unknown>).terrainRevision !== PUBLIC_V10_TERRAIN_REVISION) return false

  try {
    // The v9 content and camp validator still proves all old facts. Its temporary
    // witness uses seed ground; the persisted state and effective-pose check do not.
    const state = value as PublicWorldV10State
    if (!isValidPublicWorldV9State(publicV10BaseGroundWitness(state), bootstrap)) return false
    if (state.movementOwner === 'streamed') {
      createStreamedWorldFromState({ seed: state.seed, tick: state.tick,
        player: { position: state.player.position, yaw: state.player.yaw,
          pitch: state.player.pitch, verticalVelocity: state.player.verticalVelocity },
        discoveredTileIds: state.discoveredTileIds,
      }, { cachePitDug: state.mireglass.cacheExcavated })
    }
    return true
  } catch { return false }
}

/** Migration is additive and never mutates the validated v9 source. */
export function withPublicV10TerrainRevision(v9State: PublicWorldV9State): PublicWorldV10State {
  if (Object.hasOwn(v9State, 'terrainRevision')) {
    throw new RangeError('Terrain revision already exists on this state.')
  }
  return { ...v9State, terrainRevision: PUBLIC_V10_TERRAIN_REVISION }
}
