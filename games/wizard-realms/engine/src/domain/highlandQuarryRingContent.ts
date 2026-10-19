import type { WorldTile } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const RING = Object.freeze({ id: 'ring-highland-quarry', x: 520, z: -488 })

/** V39 streamed Highland site, distinct from the classic generated Highland ring. */
export function highlandQuarryRing(seed: string): Readonly<{ id: typeof RING.id; tile: WorldTile }> {
  const tile = worldTileAtGrid(seed || 'wizard-realms',
    RING.x / WORLD_CELL_METERS, RING.z / WORLD_CELL_METERS)
  return Object.freeze({ id: RING.id,
    tile: Object.freeze({ ...tile, center: Object.freeze({ ...tile.center }) }) })
}
