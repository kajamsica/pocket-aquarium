import { describe, expect, it } from 'vitest'
import { createActiveWorldTerrain } from './activeWorldTerrain'
import { worldTileAtGrid } from './worldChunks'

describe('active streamed terrain', () => {
  it('keeps missing terrain null, then exposes an immutable, row-major 3 by 3 window', () => {
    const terrain = createActiveWorldTerrain('active-center')
    expect(terrain.activeChunkCount).toBe(0)
    expect(terrain.activeTiles()).toEqual([])
    expect(terrain.tileAtGrid(0, 0)).toBeNull()
    expect(terrain.tileAtWorld(0, 0)).toBeNull()

    const coordinates = terrain.activate({ x: 0, z: 0 })
    expect(coordinates).toBe(terrain.activeChunkCoordinates)
    expect(coordinates).toHaveLength(9)
    expect(terrain.activeChunkCount).toBe(9)
    const tiles = terrain.activeTiles()
    expect(tiles).toHaveLength(2304)
    expect(tiles[0]).toEqual(worldTileAtGrid('active-center', -16, -16))
    expect(tiles[47]).toEqual(worldTileAtGrid('active-center', 31, -16))
    expect(tiles[48]).toEqual(worldTileAtGrid('active-center', -16, -15))
    expect(tiles.at(-1)).toEqual(worldTileAtGrid('active-center', 31, 31))
    expect(terrain.tileAtGrid(0, 0)).toEqual(worldTileAtGrid('active-center', 0, 0))
    expect(terrain.tileAtGrid(100, 100)).toBeNull()

    expect(Object.isFrozen(tiles)).toBe(true)
    expect(Object.isFrozen(tiles[0])).toBe(true)
    expect(Object.isFrozen(tiles[0].center)).toBe(true)
    expect(Reflect.set(tiles[0], 'elevation', -1)).toBe(false)
    expect(Reflect.set(tiles[0].center, 'y', -1)).toBe(false)
    expect(Object.isFrozen(coordinates)).toBe(true)
    expect(Object.isFrozen(coordinates[0])).toBe(true)
    expect(Reflect.set(coordinates[0], 'chunkX', 99)).toBe(false)
    expect(terrain.tileAtGrid(-16, -16)).toEqual(worldTileAtGrid('active-center', -16, -16))
  })

  it('resolves world coordinates like legacy nearest-center lookup, including negative half-cell ties', () => {
    const terrain = createActiveWorldTerrain('world-lookup')
    terrain.activate({ x: 0, z: 0 })
    expect(terrain.tileAtWorld(1.99, 0)).toBe(terrain.tileAtGrid(0, 0))
    expect(terrain.tileAtWorld(2, 0)).toBe(terrain.tileAtGrid(0, 0))
    expect(terrain.tileAtWorld(2.01, 0)).toBe(terrain.tileAtGrid(1, 0))
    expect(terrain.tileAtWorld(-2, 0)).toBe(terrain.tileAtGrid(-1, 0))
    expect(terrain.tileAtWorld(-1.99, 0)).toBe(terrain.tileAtGrid(0, 0))
    expect(terrain.tileAtWorld(NaN, 0)).toBeNull()
    expect(terrain.tileAtGrid(0.5, 0)).toBeNull()
  })

  it('reuses overlapping chunks, evicts old ones, and regenerates identical cells on revisit', () => {
    const terrain = createActiveWorldTerrain('revisit-window')
    const originalWindow = terrain.activate({ x: 0, z: 0 })
    const originalTiles = terrain.activeTiles()
    const retained = terrain.tileAtGrid(0, 0)
    const evicted = terrain.tileAtGrid(-16, 0)
    expect(terrain.activate({ x: 1, z: 1 })).toBe(originalWindow)
    expect(terrain.activeTiles()).toBe(originalTiles)

    terrain.activate({ x: 64, z: 0 })
    expect(terrain.activeChunkCount).toBe(9)
    expect(terrain.tileAtGrid(0, 0)).toBe(retained)
    expect(terrain.tileAtGrid(-16, 0)).toBeNull()
    expect(terrain.tileAtGrid(32, 0)).toEqual(worldTileAtGrid('revisit-window', 32, 0))
    terrain.activate({ x: 0, z: 0 })
    expect(terrain.tileAtGrid(-16, 0)).toEqual(evicted)
    expect(terrain.tileAtGrid(-16, 0)).not.toBe(evicted)
  })

  it('stays bounded at world edges and rejects out-of-world activation without changing the cache', () => {
    const terrain = createActiveWorldTerrain('world-edges')
    terrain.activate({ x: -1024, z: -1024 })
    expect(terrain.activeChunkCount).toBe(4)
    expect(terrain.activeTiles()).toHaveLength(1024)
    expect(terrain.activeTiles()[0]).toEqual(worldTileAtGrid('world-edges', -256, -256))
    expect(terrain.tileAtGrid(-257, -256)).toBeNull()
    terrain.activate({ x: 1022, z: 1022 })
    expect(terrain.activeChunkCount).toBe(4)
    expect(terrain.tileAtWorld(1022, 1022)).toEqual(worldTileAtGrid('world-edges', 255, 255))
    expect(terrain.tileAtWorld(1022.01, 1022)).toBeNull()
    const beforeCoordinates = terrain.activeChunkCoordinates
    const beforeTiles = terrain.activeTiles()
    for (const position of [{ x: 1022.01, z: 0 }, { x: -1026, z: 0 }, { x: 5000, z: 5000 }, { x: NaN, z: 0 }]) {
      expect(() => terrain.activate(position)).toThrow(RangeError)
      expect(terrain.activeChunkCoordinates).toBe(beforeCoordinates)
      expect(terrain.activeTiles()).toBe(beforeTiles)
      expect(terrain.activeChunkCount).toBe(4)
    }
    for (const position of [{ x: 0, z: 0 }, { x: -64, z: -64 }, { x: 500, z: -500 }, { x: -1024, z: 1020 }]) {
      terrain.activate(position)
      expect(terrain.activeChunkCount).toBeLessThanOrEqual(9)
      expect(terrain.activeTiles()).toHaveLength(terrain.activeChunkCount * 256)
    }
  })
})
