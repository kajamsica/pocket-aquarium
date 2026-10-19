import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './generation'
import {
  activeChunkCoordinates, WORLD_CHUNK_CELLS, WORLD_GRID_MAX, WORLD_GRID_MIN, worldChunk, worldTileAtGrid,
} from './worldChunks'

const seeds = ['greenway-alpha', 'region-0', 'expedition-19078', 'stream-1', '']
// SHA-256 of the full tile arrays produced by c03b25d, before legacyTileAtGrid was extracted.
const legacyTileHashes: Record<string, readonly [string, string]> = {
  'greenway-alpha': ['a0bfd07ce6eebcb3712a9017b50cc2740ec7f9e7397a7106e6307da879f32c6e', '94ef0369fc9b55a5284a53132de004c3902220b5d49c796b6ca88c76e4d05849'],
  'region-0': ['8bc76f896c87b1e198bc13946b61d16f7885325e1b7cb1bc069eb4bf621a5342', '4ff618de84661fcbbbdf434d8026721bc0416b6bc4f02f2521aee190223e0046'],
  'expedition-19078': ['9642eaf332c8c1397d581e852b469b5e488dfad873634ad1ce75eee7e81a36b4', '69662e2a42dd3b1a30d5dad378df9ce30522af7401233f80636b303b06c39719'],
  'stream-1': ['0122e0153c444fe2a33dd35cc23d147cd5d2caaca2d8b79162de8fc71ab4bb5e', 'a23e28f038573cf30a60cdb2e10ccbc7169ce6c637b750c5e6e84d7828d9ace4'],
  '': ['088df261715bdbdca79644019f544eebb7fd6d8b28242d16173d2e931574b164', '74b56e5d6b720fa33327eca40176ad49420a860c8e20f6cce6651ca31a1eda83'],
}

async function tileHash(tiles: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(tiles))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('streamed terrain cells', () => {
  it.each(seeds)('preserves every classic and expanded legacy tile exactly for seed %j', async (seed) => {
    for (const profile of ['greenway-classic-v1', 'greenway-expanded-v1'] as const) {
      const world = createGeneratedWorld(seed, profile)
      for (const tile of world.tiles) {
        expect(worldTileAtGrid(seed, tile.gridX - 3, tile.gridZ - 3)).toEqual(tile)
      }
      expect(await tileHash(world.tiles)).toBe(legacyTileHashes[seed][profile === 'greenway-classic-v1' ? 0 : 1])
    }
  })

  it('anchors global zero and accepts the negative and positive world edges', () => {
    expect(worldTileAtGrid('edges', 0, 0).center).toMatchObject({ x: 0, z: 0 })
    for (const [gx, gz] of [[WORLD_GRID_MIN, WORLD_GRID_MIN], [WORLD_GRID_MAX, WORLD_GRID_MAX]]) {
      const tile = worldTileAtGrid('edges', gx, gz)
      expect(tile.id).toBe(`tile-${gx + 3}-${gz + 3}`)
      expect(tile.center).toMatchObject({ x: gx * 4, z: gz * 4 })
      expect(Number.isFinite(tile.center.y)).toBe(true)
    }
    for (const [gx, gz] of [[-257, 0], [256, 0], [0, -257], [0, 256], [0.5, 0], [NaN, 0], [0, Infinity]]) {
      expect(() => worldTileAtGrid('edges', gx, gz)).toThrow(RangeError)
    }
  })

  it.each(seeds)('has woodland, wetland, and highland outer climates with local variation for %j', (seed) => {
    const woodland = worldTileAtGrid(seed, 0, 160)
    const wetland = worldTileAtGrid(seed, -160, 160)
    const highland = worldTileAtGrid(seed, 160, -160)
    expect([woodland.biome, woodland.terrain]).toEqual(['temperate_forest', 'loam'])
    expect([wetland.biome, wetland.terrain]).toEqual(['marsh', 'wetland'])
    expect([highland.biome, highland.terrain]).toEqual(['dry_highland', 'rocky'])
    for (const [gx, gz] of [[0, 160], [-160, 160], [160, -160]]) {
      expect(worldTileAtGrid(seed, gx, gz).elevation).not.toBe(worldTileAtGrid(seed, gx + 1, gz).elevation)
    }
  })

  it.each(seeds)('meets legacy and chunk boundaries without a height jump for %j', (seed) => {
    const adjacent = (ax: number, az: number, bx: number, bz: number) =>
      Math.abs(worldTileAtGrid(seed, ax, az).center.y - worldTileAtGrid(seed, bx, bz).center.y)
    const differences: number[] = []
    for (const coordinate of [-160, -16, -8, 0, 8, 160]) {
      differences.push(adjacent(15, coordinate, 16, coordinate))
      differences.push(adjacent(-1, coordinate, 0, coordinate))
      differences.push(adjacent(coordinate, 15, coordinate, 16))
      differences.push(adjacent(coordinate, -1, coordinate, 0))
    }
    differences.push(adjacent(159, -160, 160, -160))
    differences.push(adjacent(-161, 160, -160, 160))
    differences.push(adjacent(0, 159, 0, 160))
    for (let coordinate = -7; coordinate <= 8; coordinate += 1) {
      differences.push(adjacent(8, coordinate, 9, coordinate))
      differences.push(adjacent(-7, coordinate, -8, coordinate))
      differences.push(adjacent(coordinate, 8, coordinate, 9))
      differences.push(adjacent(coordinate, -7, coordinate, -8))
    }
    expect(Math.max(...differences)).toBeLessThanOrEqual(0.9)
  })
})

describe('streamed terrain chunks', () => {
  it('generates exactly 16 by 16 cells in row-major order with floor-indexed negative chunks', () => {
    const chunk = worldChunk('chunk-order', -1, 0)
    expect(chunk).toMatchObject({ chunkX: -1, chunkZ: 0 })
    expect(chunk.tiles).toHaveLength(WORLD_CHUNK_CELLS ** 2)
    expect(chunk.tiles[0]).toEqual(worldTileAtGrid('chunk-order', -16, 0))
    expect(chunk.tiles[15]).toEqual(worldTileAtGrid('chunk-order', -1, 0))
    expect(chunk.tiles[16]).toEqual(worldTileAtGrid('chunk-order', -16, 1))
    expect(chunk.tiles[255]).toEqual(worldTileAtGrid('chunk-order', -1, 15))
    expect(worldChunk('chunk-order', -16, -16).tiles[0]).toEqual(worldTileAtGrid('chunk-order', -256, -256))
    expect(worldChunk('chunk-order', 15, 15).tiles[255]).toEqual(worldTileAtGrid('chunk-order', 255, 255))
    for (const [cx, cz] of [[-17, 0], [16, 0], [0, -17], [0, 16], [0.5, 0], [0, NaN]]) {
      expect(() => worldChunk('chunk-order', cx, cz)).toThrow(RangeError)
    }
  })

  it('regenerates bit-identical cells independently of chunk request order and mutation', () => {
    const original = worldChunk('revisit', -1, -1)
    worldChunk('revisit', 9, 7)
    const regenerated = worldChunk('revisit', -1, -1)
    expect(regenerated).toEqual(original)
    original.tiles[0].center.y = -99
    expect(worldChunk('revisit', -1, -1)).toEqual(regenerated)
  })

  it('bounds active chunks to a clamped, ordered three-by-three window', () => {
    const center = activeChunkCoordinates({ x: 0, z: 0 })
    expect(center).toHaveLength(9)
    expect(center[0]).toEqual({ chunkX: -1, chunkZ: -1 })
    expect(center[8]).toEqual({ chunkX: 1, chunkZ: 1 })
    expect(activeChunkCoordinates({ x: -0.01, z: -0.01 }, 0)).toEqual([{ chunkX: -1, chunkZ: -1 }])
    expect(activeChunkCoordinates({ x: -1024, z: -1024 })).toEqual([
      { chunkX: -16, chunkZ: -16 }, { chunkX: -15, chunkZ: -16 },
      { chunkX: -16, chunkZ: -15 }, { chunkX: -15, chunkZ: -15 },
    ])
    expect(activeChunkCoordinates({ x: 1020, z: 1020 })).toHaveLength(4)
    for (const radius of [-1, 0.5, 2, Infinity]) {
      expect(() => activeChunkCoordinates({ x: 0, z: 0 }, radius)).toThrow(RangeError)
    }
    expect(() => activeChunkCoordinates({ x: NaN, z: 0 })).toThrow(RangeError)
  })
})
