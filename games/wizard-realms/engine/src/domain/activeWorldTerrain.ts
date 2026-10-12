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
  activate(position: { x: number; z: number }, radiusChunks?: 0 | 1): readonly Readonly<ChunkCoordinate>[]
  tileAtGrid(gx: number, gz: number): ReadonlyWorldTile | null
  tileAtWorld(x: number, z: number): ReadonlyWorldTile | null
  activeTiles(): readonly ReadonlyWorldTile[]
  readonly activeChunkCoordinates: readonly Readonly<ChunkCoordinate>[]
  readonly activeChunkCount: number
}

const keyFor = (chunkX: number, chunkZ: number) => `${chunkX}:${chunkZ}`
const gridAtWorld = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
const validGrid = (grid: number) => Number.isSafeInteger(grid) && grid >= WORLD_GRID_MIN && grid <= WORLD_GRID_MAX
const BASE_CHUNK_LIMIT = 18
const baseChunks = new Map<string, readonly WorldTile[]>()

function baseChunk(seed: string, chunkX: number, chunkZ: number): readonly WorldTile[] {
  const key = JSON.stringify([seed, chunkX, chunkZ])
  const cached = baseChunks.get(key)
  if (cached) {
    baseChunks.delete(key)
    baseChunks.set(key, cached)
    return cached
  }
  const tiles = worldChunk(seed, chunkX, chunkZ).tiles
  for (const tile of tiles) {
    Object.freeze(tile.center)
    Object.freeze(tile)
  }
  const frozen = Object.freeze(tiles)
  baseChunks.set(key, frozen)
  if (baseChunks.size > BASE_CHUNK_LIMIT) baseChunks.delete(baseChunks.keys().next().value!)
  return frozen
}

/** Keeps only a validated one-chunk or 3 by 3 window; missing terrain is never empty ground. */
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
    activate(position, radiusChunks = 1) {
      if (!validGrid(gridAtWorld(position.x)) || !validGrid(gridAtWorld(position.z))) {
        throw new RangeError('Active terrain position is outside the world.')
      }
      const wanted = chunkWindow(position, radiusChunks).map((coordinate) => Object.freeze(coordinate))
      if (wanted.length === coordinates.length
        && wanted.every((coordinate, index) => coordinate.chunkX === coordinates[index].chunkX
          && coordinate.chunkZ === coordinates[index].chunkZ)) return coordinates
      const next = new Map<string, readonly ReadonlyWorldTile[]>()
      for (const { chunkX, chunkZ } of wanted) {
        const key = keyFor(chunkX, chunkZ)
        let tiles = chunks.get(key)
        if (!tiles) {
          const base = baseChunk(seed, chunkX, chunkZ)
          // The overlay reads base tiles and copies the one cell it changes; frozen bases stay private.
          const generated = overlayCachePit(base as WorldTile[])
          if (generated !== base) {
            for (const tile of generated) {
              if (!Object.isFrozen(tile)) {
                Object.freeze(tile.center)
                Object.freeze(tile)
              }
            }
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
