import { describe, expect, it } from 'vitest'
import type { WizardTerrainCell } from './contracts'
import { visibleTerrainCells } from './visibleTerrain'

const cell = (x: number, z: number): WizardTerrainCell => ({
  id: `tile-${x}-${z}`, position: [x * 4, 0, z * 4], size: [4, 4], height: 1, climate: 'temperate_forest',
})
const grid = (minX: number, maxX: number, minZ = minX, maxZ = maxX) =>
  Array.from({ length: (maxX - minX + 1) * (maxZ - minZ + 1) }, (_, index) => {
    const width = maxX - minX + 1
    return cell(minX + index % width, minZ + Math.floor(index / width))
  })

describe('bounded terrain presentation', () => {
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
