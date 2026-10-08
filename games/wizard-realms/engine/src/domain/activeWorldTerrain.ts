import type { WorldTile } from './types'
import { createCachePitOverlay } from './mireglassCachePitOverlay'
import type { TerrainFacts } from './mireglassCachePitOverlay'
import {
  activeChunkCoordinates as chunkWindow, WORLD_CELL_METERS, WORLD_CHUNK_CELLS,
  WORLD_GRID_MAX, WORLD_GRID_MIN, worldChunk,
} from './worldChunks'
import type { ChunkCoordinate } from './worldChunks'

export type ReadonlyWorldTile = Readonly<Omit<WorldTile, 'center'>> & { readonly center: Readonly<WorldTile['center']> }

export interface ActiveWorldTerrain {
  activate(position: { x: number; z: number }): readonly Readonly<ChunkCoordinate>[]
  tileAtGrid(gx: number, gz: number): ReadonlyWorldTile | null
  tileAtWorld(x: number, z: number): ReadonlyWorldTile | null
  activeTiles(): readonly ReadonlyWorldTile[]
  readonly activeChunkCoordinates: readonly Readonly<ChunkCoordinate>[]
  readonly activeChunkCount: number
}

const keyFor = (chunkX: number, chunkZ: number) => `${chunkX}:${chunkZ}`
const gridAtWorld = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
const validGrid = (grid: number) => Number.isSafeInteger(grid) && grid >= WORLD_GRID_MIN && grid <= WORLD_GRID_MAX

/** Keeps only the validated 3 by 3 chunk window; missing terrain is never treated as empty ground. */
export function createActiveWorldTerrain(seed: string, facts?: TerrainFacts): ActiveWorldTerrain {
  const overlayCachePit = createCachePitOverlay(seed, facts)
  let chunks = new Map<string, readonly ReadonlyWorldTile[]>()
  let coordinates: readonly Readonly<ChunkCoordinate>[] = Object.freeze([])
  let visibleTiles: readonly ReadonlyWorldTile[] = Object.freeze([])

  const tileAtGrid = (gx: number, gz: number): ReadonlyWorldTile | null => {
    if (!validGrid(gx) || !validGrid(gz)) return null
    const chunkX = Math.floor(gx / WORLD_CHUNK_CELLS)
    const chunkZ = Math.floor(gz / WORLD_CHUNK_CELLS)
    const tiles = chunks.get(keyFor(chunkX, chunkZ))
    if (!tiles) return null
    return tiles[(gz - chunkZ * WORLD_CHUNK_CELLS) * WORLD_CHUNK_CELLS + gx - chunkX * WORLD_CHUNK_CELLS]
  }

  return {
    activate(position) {
      if (!validGrid(gridAtWorld(position.x)) || !validGrid(gridAtWorld(position.z))) {
        throw new RangeError('Active terrain position is outside the world.')
      }
      const wanted = chunkWindow(position).map((coordinate) => Object.freeze(coordinate))
      if (wanted.length === coordinates.length
        && wanted.every((coordinate, index) => coordinate.chunkX === coordinates[index].chunkX
          && coordinate.chunkZ === coordinates[index].chunkZ)) return coordinates
      const next = new Map<string, readonly ReadonlyWorldTile[]>()
      for (const { chunkX, chunkZ } of wanted) {
        const key = keyFor(chunkX, chunkZ)
        let tiles = chunks.get(key)
        if (!tiles) {
          const generated = overlayCachePit(worldChunk(seed, chunkX, chunkZ).tiles)
          for (const tile of generated) {
            Object.freeze(tile.center)
            Object.freeze(tile)
          }
          tiles = Object.freeze(generated)
        }
        next.set(key, tiles)
      }
      const ordered: ReadonlyWorldTile[] = []
      for (let chunkZ = wanted[0].chunkZ; chunkZ <= wanted[wanted.length - 1].chunkZ; chunkZ += 1) {
        for (let localZ = 0; localZ < WORLD_CHUNK_CELLS; localZ += 1) {
          for (let chunkX = wanted[0].chunkX; chunkX <= wanted[wanted.length - 1].chunkX; chunkX += 1) {
            const tiles = next.get(keyFor(chunkX, chunkZ))!
            for (let localX = 0; localX < WORLD_CHUNK_CELLS; localX += 1) {
              ordered.push(tiles[localZ * WORLD_CHUNK_CELLS + localX])
            }
          }
        }
      }
      chunks = next
      coordinates = Object.freeze(wanted)
      visibleTiles = Object.freeze(ordered)
      return coordinates
    },
    tileAtGrid,
    tileAtWorld(x, z) {
      // Legacy nearest-center lookup resolves an exact half-cell tie toward the lower grid coordinate.
      return tileAtGrid(gridAtWorld(x), gridAtWorld(z))
    },
    activeTiles() { return visibleTiles },
    get activeChunkCoordinates() { return coordinates },
    get activeChunkCount() { return chunks.size },
  }
}
