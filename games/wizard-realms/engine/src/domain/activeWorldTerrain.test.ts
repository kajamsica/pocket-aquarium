import { describe, expect, it } from 'vitest'
import { createActiveWorldTerrain } from './activeWorldTerrain'
import { mireglassAnchors } from './mireglassContent'
import { createCachePitOverlay } from './mireglassCachePitOverlay'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS, worldChunk, worldTileAtGrid } from './worldChunks'

describe('active streamed terrain', () => {
  it.each(['greenway-alpha', 'wizard-realms', 'chunk-edge-probe'])(
    'keeps a one-chunk surface window equal to the full window at tile and world edges for %s', (seed) => {
      for (const point of [{ x: 63.99, z: 63.99 }, { x: 64, z: -64.001 },
        { x: -64.001, z: 62.01 }, { x: -1026 + 1e-7, z: 1022 }]) {
        const full = createActiveWorldTerrain(seed)
        full.activate(point)
        const nearest = { x: Math.ceil(point.x / WORLD_CELL_METERS - 0.5) * WORLD_CELL_METERS,
          z: Math.ceil(point.z / WORLD_CELL_METERS - 0.5) * WORLD_CELL_METERS }
        const surface = createActiveWorldTerrain(seed)
        surface.activate(nearest, 0)
        expect(surface.activeChunkCount).toBe(1)
        expect(surface.activeTiles()).toHaveLength(WORLD_CHUNK_CELLS ** 2)
        expect(surface.tileAtWorld(point.x, point.z)).toEqual(full.tileAtWorld(point.x, point.z))
      }
    })

  it('switches one-chunk surface reads back to the unchanged full movement window', () => {
    const terrain = createActiveWorldTerrain('radius-switch')
    terrain.activate({ x: 0, z: 0 }, 0)
    expect(terrain.activeChunkCount).toBe(1)
    terrain.activate({ x: 0, z: 0 })
    expect(terrain.activeChunkCount).toBe(9)
    expect(terrain.activeTiles()).toHaveLength(9 * WORLD_CHUNK_CELLS ** 2)
  })

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

  it('reuses overlapping chunks and restores cached cells on revisit', () => {
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
    expect(terrain.tileAtGrid(-16, 0)).toBe(evicted)
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

  it.each(['mireglass-seed', 'pit-seed-two', 'pit-seed-three'])(
    'overlays only the canonical cache cell for %s without mutating generated terrain', (seed) => {
      const cache = mireglassAnchors(seed).sealCache.tile
      const chunkX = Math.floor((cache.gridX - 3) / WORLD_CHUNK_CELLS)
      const chunkZ = Math.floor((cache.gridZ - 3) / WORLD_CHUNK_CELLS)
      const base = worldChunk(seed, chunkX, chunkZ).tiles
      const baseBytes = JSON.stringify(base)
      const overlaid = createCachePitOverlay(seed, { cachePitDug: true })(base)
      expect(overlaid).not.toBe(base)
      expect(overlaid.filter((tile, index) => tile !== base[index]).map((tile) => tile.id)).toEqual([cache.id])
      const edited = overlaid.find((tile) => tile.id === cache.id)!
      expect(edited).toEqual({ ...cache, elevation: 0.55, center: { ...cache.center, y: 1.65 } })
      expect(edited.center).not.toBe(base.find((tile) => tile.id === cache.id)!.center)
      expect(JSON.stringify(base)).toBe(baseBytes)
      expect(createCachePitOverlay(seed)(base)).toBe(base)
      expect(createCachePitOverlay(seed, { cachePitDug: false })(base)).toBe(base)
      const remote = worldChunk(seed, 0, 0).tiles
      expect(createCachePitOverlay(seed, { cachePitDug: true })(remote)).toBe(remote)
      expect(worldTileAtGrid(seed, cache.gridX - 3, cache.gridZ - 3)).toEqual(cache)
    },
  )

  it.each(['pit-chunk-reload', 'pit-seed-two', 'pit-seed-three'])('retains the pit after chunk eviction for %s', (seed) => {
    const cache = mireglassAnchors(seed).sealCache.tile
    const position = cache.center
    const facts = { cachePitDug: true }
    const direct = createActiveWorldTerrain(seed, facts)
    direct.activate(position)
    const first = direct.tileAtWorld(position.x, position.z)!
    expect(first).toMatchObject({ id: cache.id, terrain: cache.terrain, elevation: 0.55, center: { y: 1.65 } })
    expect(direct.activeTiles().filter((tile) => tile.id === cache.id)).toEqual([first])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.center)).toBe(true)
    expect(Reflect.set(first, 'elevation', 0)).toBe(false)
    expect(Reflect.set(first.center, 'y', 0)).toBe(false)

    direct.activate({ x: 0, z: 0 })
    expect(direct.tileAtWorld(position.x, position.z)).toBeNull()
    direct.activate(position)
    expect(direct.tileAtWorld(position.x, position.z)).toEqual(first)
    expect(direct.tileAtWorld(position.x, position.z)).not.toBe(first)

    const remoteFirst = createActiveWorldTerrain(seed, facts)
    remoteFirst.activate({ x: 0, z: 0 })
    remoteFirst.activate(position)
    expect(remoteFirst.activeTiles()).toEqual(direct.activeTiles())
    const legacy = createActiveWorldTerrain(seed)
    legacy.activate(position)
    expect(legacy.tileAtWorld(position.x, position.z)).toEqual(cache)
    expect(legacy.tileAtWorld(position.x, position.z)!.elevation).toBe(0.80)
    const explicitFalse = createActiveWorldTerrain(seed, { cachePitDug: false })
    explicitFalse.activate(position)
    expect(JSON.stringify(explicitFalse.activeTiles())).toBe(JSON.stringify(legacy.activeTiles()))
  })

  it.each(['base-cache-one', 'base-cache-two', 'base-cache-three'])(
    'reuses immutable base chunks with deterministic parity across the world for %s', (seed) => {
      for (const [chunkX, chunkZ] of [[-16, -16], [0, 0], [15, 15]]) {
        const position = { x: chunkX * 64, z: chunkZ * 64 }
        const first = createActiveWorldTerrain(seed)
        first.activate(position)
        const second = createActiveWorldTerrain(seed)
        second.activate(position)
        const expected = worldChunk(seed, chunkX, chunkZ).tiles
        for (let localZ = 0; localZ < WORLD_CHUNK_CELLS; localZ += 1) {
          for (let localX = 0; localX < WORLD_CHUNK_CELLS; localX += 1) {
            const gx = chunkX * WORLD_CHUNK_CELLS + localX
            const gz = chunkZ * WORLD_CHUNK_CELLS + localZ
            expect(first.tileAtGrid(gx, gz)).toEqual(expected[localZ * WORLD_CHUNK_CELLS + localX])
            expect(second.tileAtGrid(gx, gz)).toBe(first.tileAtGrid(gx, gz))
          }
        }
      }
    },
  )

  it('keeps mutable public chunks and pit overlays out of the cached base', () => {
    const seed = 'base-cache-pit-isolation'
    const cache = mireglassAnchors(seed).sealCache.tile
    const position = cache.center
    const plain = createActiveWorldTerrain(seed, { cachePitDug: false })
    plain.activate(position)
    const baseTile = plain.tileAtWorld(position.x, position.z)!
    const dug = createActiveWorldTerrain(seed, { cachePitDug: true })
    dug.activate(position)
    const dugTile = dug.tileAtWorld(position.x, position.z)!
    expect(dugTile).toEqual({ ...baseTile, elevation: 0.55, center: { ...baseTile.center, y: 1.65 } })
    expect(dugTile).not.toBe(baseTile)
    expect(Object.isFrozen(dugTile)).toBe(true)
    expect(Object.isFrozen(dugTile.center)).toBe(true)

    const publicChunk = worldChunk(seed, Math.floor(position.x / (WORLD_CHUNK_CELLS * WORLD_CELL_METERS)),
      Math.floor(position.z / (WORLD_CHUNK_CELLS * WORLD_CELL_METERS)))
    const publicTile = publicChunk.tiles.find((tile) => tile.id === baseTile.id)!
    expect(publicTile).not.toBe(baseTile)
    publicTile.elevation = -1
    publicTile.center.y = -1
    expect(Reflect.set(baseTile, 'elevation', -1)).toBe(false)
    expect(Reflect.set(baseTile.center, 'y', -1)).toBe(false)
    const plainAgain = createActiveWorldTerrain(seed, { cachePitDug: false })
    plainAgain.activate(position)
    expect(plainAgain.tileAtWorld(position.x, position.z)).toBe(baseTile)
    expect(plainAgain.tileAtWorld(position.x, position.z)).toEqual(cache)
  })

  it('keeps two full windows of base chunks and evicts the least recently used chunk', () => {
    const position = { x: 0, z: 0 }
    const seeds = ['base-lru-one', 'base-lru-two']
    const samples = seeds.map((seed) => {
      const terrain = createActiveWorldTerrain(seed)
      terrain.activate(position)
      return terrain.tileAtGrid(-16, 0)
    })
    const warm = createActiveWorldTerrain(seeds[0])
    warm.activate(position)
    expect(warm.tileAtGrid(-16, 0)).toBe(samples[0])

    const overflow = createActiveWorldTerrain('base-lru-overflow')
    overflow.activate({ x: -1024, z: -1024 })
    const recentlyUsed = createActiveWorldTerrain(seeds[0])
    recentlyUsed.activate(position)
    expect(recentlyUsed.tileAtGrid(-16, 0)).toBe(samples[0])
    const evicted = createActiveWorldTerrain(seeds[1])
    evicted.activate(position)
    expect(evicted.tileAtGrid(-16, 0)).toEqual(samples[1])
    expect(evicted.tileAtGrid(-16, 0)).not.toBe(samples[1])
  })
})
