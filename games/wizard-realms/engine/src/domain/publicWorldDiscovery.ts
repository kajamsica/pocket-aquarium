import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

export const PUBLIC_START_REVEAL_RADIUS_METERS = 12
export const PUBLIC_WALK_REVEAL_RADIUS_METERS = 16
export const PUBLIC_SPELL_REVEAL_RADIUS_METERS = 24
export const PUBLIC_START_TILE_ID = 'tile-3-3'

const frozenDiscoverySets = new WeakMap<readonly string[], ReadonlySet<string>>()

/** Reuse membership for immutable snapshots without caching mutable test or legacy input. */
export function discoveredTileSet(ids: readonly string[]): ReadonlySet<string> {
  if (!Object.isFrozen(ids)) return new Set(ids)
  const cached = frozenDiscoverySets.get(ids)
  if (cached) return cached
  const known = new Set(ids)
  frozenDiscoverySets.set(ids, known)
  return known
}

/** A bounded circle of canonical tile centers, independent of terrain-cache ownership. */
export function nearbyWorldTileIds(position: { x: number; z: number }, radius: number): string[] {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)
    || !Number.isFinite(radius) || radius < 0 || radius > PUBLIC_SPELL_REVEAL_RADIUS_METERS) {
    throw new RangeError('Invalid public-world discovery circle.')
  }
  const minX = Math.max(WORLD_GRID_MIN, Math.ceil((position.x - radius) / WORLD_CELL_METERS))
  const maxX = Math.min(WORLD_GRID_MAX, Math.floor((position.x + radius) / WORLD_CELL_METERS))
  const minZ = Math.max(WORLD_GRID_MIN, Math.ceil((position.z - radius) / WORLD_CELL_METERS))
  const maxZ = Math.min(WORLD_GRID_MAX, Math.floor((position.z + radius) / WORLD_CELL_METERS))
  const ids: string[] = []
  for (let z = minZ; z <= maxZ; z += 1) for (let x = minX; x <= maxX; x += 1) {
    if (Math.hypot(x * WORLD_CELL_METERS - position.x,
      z * WORLD_CELL_METERS - position.z) <= radius) ids.push(`tile-${x + 3}-${z + 3}`)
  }
  return ids.sort()
}
