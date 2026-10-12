import { isValidDiscoveryMask } from './discoveryMask'
import { activeChunkCoordinates, WORLD_CHUNK_CELLS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

const GRID_WIDTH = WORLD_GRID_MAX - WORLD_GRID_MIN + 1

/** Project only the nine or fewer chunks around the player, never the full discovery mask. */
export function discoveredTileIdsInActiveWindow(mask: unknown,
  position: { x: number; z: number }): readonly string[] {
  if (!isValidDiscoveryMask(mask) || !position
    || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return Object.freeze([])

  const ids: string[] = []
  for (const { chunkX, chunkZ } of activeChunkCoordinates(position)) {
    for (let localZ = 0; localZ < WORLD_CHUNK_CELLS; localZ += 1) {
      const gz = chunkZ * WORLD_CHUNK_CELLS + localZ
      const rowBit = (gz - WORLD_GRID_MIN) * GRID_WIDTH
      for (let localX = 0; localX < WORLD_CHUNK_CELLS; localX += 1) {
        const gx = chunkX * WORLD_CHUNK_CELLS + localX
        const bit = rowBit + gx - WORLD_GRID_MIN
        if ((mask[bit >> 3] & (1 << (bit & 7))) !== 0) ids.push(`tile-${gx + 3}-${gz + 3}`)
      }
    }
  }
  return Object.freeze(ids.sort())
}
