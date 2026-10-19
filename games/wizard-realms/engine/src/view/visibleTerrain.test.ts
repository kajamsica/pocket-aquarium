import { describe, expect, it } from 'vitest'
import { activeChunkCoordinates, WORLD_CELL_METERS, WORLD_CHUNK_CELLS } from '../domain/worldChunks'
import type { WizardTerrainCell } from './contracts'
import { PUBLIC_VISUAL_RADIUS_CELLS, visibleTerrainCells } from './visibleTerrain'

const cell = (x: number, z: number): WizardTerrainCell => ({
  id: `tile-${x}-${z}`, position: [x * 4, 0, z * 4], size: [4, 4], height: 1, climate: 'temperate_forest',
})
const grid = (minX: number, maxX: number, minZ = minX, maxZ = maxX) =>
  Array.from({ length: (maxX - minX + 1) * (maxZ - minZ + 1) }, (_, index) => {
    const width = maxX - minX + 1
    return cell(minX + index % width, minZ + Math.floor(index / width))
  })

describe('bounded terrain presentation', () => {
  it('uses a 31 by 31 public scenery window', () => {
    expect(PUBLIC_VISUAL_RADIUS_CELLS).toBe(15)
    expect(visibleTerrainCells(grid(-24, 23), [0, 0, 0], PUBLIC_VISUAL_RADIUS_CELLS)).toHaveLength(961)
  })

  it('finds the full public window in the existing three by three chunk cache at seams', () => {
    for (const [x, z] of [[0, 0], [15, 15], [16, -1], [-1, 16]]) {
      const cached = activeChunkCoordinates({ x: x * WORLD_CELL_METERS, z: z * WORLD_CELL_METERS })
        .flatMap(({ chunkX, chunkZ }) => grid(chunkX * WORLD_CHUNK_CELLS,
          (chunkX + 1) * WORLD_CHUNK_CELLS - 1, chunkZ * WORLD_CHUNK_CELLS,
          (chunkZ + 1) * WORLD_CHUNK_CELLS - 1))
      expect(cached).toHaveLength(9 * WORLD_CHUNK_CELLS ** 2)
      const visible = visibleTerrainCells(cached, [x * WORLD_CELL_METERS, 0, z * WORLD_CELL_METERS],
        PUBLIC_VISUAL_RADIUS_CELLS)
      expect(visible).toHaveLength((PUBLIC_VISUAL_RADIUS_CELLS * 2 + 1) ** 2)
      expect(visible[0].position).toEqual([(x - PUBLIC_VISUAL_RADIUS_CELLS) * WORLD_CELL_METERS,
        0, (z - PUBLIC_VISUAL_RADIUS_CELLS) * WORLD_CELL_METERS])
      expect(visible.at(-1)?.position).toEqual([(x + PUBLIC_VISUAL_RADIUS_CELLS) * WORLD_CELL_METERS,
        0, (z + PUBLIC_VISUAL_RADIUS_CELLS) * WORLD_CELL_METERS])
    }
  })

  it('preserves every classic and expanded Greenway cell even when the player stands at an edge', () => {
    for (const size of [7, 16]) {
      const cells = grid(-3, size - 4)
      for (const player of [[-12, 0, -12], [(size - 4) * 4, 0, (size - 4) * 4]] as const) {
        expect(visibleTerrainCells(cells, player).map((tile) => tile.id)).toEqual(cells.map((tile) => tile.id))
      }
    }
  })

  it('caps a larger world at a 17 by 17 row-major window and clamps to active edges', () => {
    const cells = grid(-16, 15)
    const middle = visibleTerrainCells(cells, [0, 0, 0])
    expect(middle).toHaveLength(289)
    expect(middle[0].id).toBe('tile--8--8')
    expect(middle.at(-1)?.id).toBe('tile-8-8')
    const northwest = visibleTerrainCells(cells, [-64, 0, -64])
    expect(northwest).toHaveLength(289)
    expect(northwest[0].id).toBe('tile--16--16')
    expect(northwest.at(-1)?.id).toBe('tile-0-0')
    const southeast = visibleTerrainCells(cells, [60, 0, 60])
    expect(southeast).toHaveLength(289)
    expect(southeast[0].id).toBe('tile--1--1')
    expect(southeast.at(-1)?.id).toBe('tile-15-15')
  })

  it('keeps selection stable within a player cell and independent of input/chunk order', () => {
    const cells = grid(-16, 15)
    const expected = visibleTerrainCells(cells, [0, 0, 0]).map((tile) => tile.id)
    expect(visibleTerrainCells([...cells].reverse(), [1.9, 0, -1.9]).map((tile) => tile.id)).toEqual(expected)
    expect(visibleTerrainCells(cells, [2.1, 0, 0])[0].id).toBe('tile--7--8')
    expect(visibleTerrainCells(cells, [0, 0, 0], 2)).toHaveLength(25)
  })

  it('bounds duplicate cells, leaves inputs unchanged, and handles empty terrain', () => {
    const cells = grid(-16, 15)
    const withDuplicate = Object.freeze([...cells, cell(0, 0)])
    expect(visibleTerrainCells(withDuplicate, [0, 0, 0])).toHaveLength(289)
    expect(withDuplicate).toHaveLength(1025)
    expect(visibleTerrainCells([], [0, 0, 0])).toEqual([])
  })
})
