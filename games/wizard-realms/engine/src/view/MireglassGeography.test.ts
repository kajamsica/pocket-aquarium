import { describe, expect, it } from 'vitest'
import { mireglassBermFaceRowAt, mireglassFenDepthAt, mireglassPlateauAt } from '../domain/mireglassTerrain'
import { worldTileAtGrid } from '../domain/worldChunks'
import type { WizardTerrainCell } from './contracts'
import { mireglassCliffFacesFor } from './MireglassCliffLayer'
import { mireglassWaterTilesFor } from './MireglassWaterLayer'

const seeds = ['greenway-alpha', 'mireglass-corpus-0', 'mireglass-corpus-1'] as const

function cellAt(seed: string, x: number, z: number): WizardTerrainCell {
  const tile = worldTileAtGrid(seed, x / 4, z / 4)
  return { id: tile.id, position: [x, tile.center.y, z], size: [4, 4],
    height: 0.7 + tile.elevation * 3, climate: tile.biome }
}

describe('Mireglass visible geography', () => {
  it('skins exactly the seed-authoritative fen cells, not dry or noncanonical cells', () => {
    const cells: WizardTerrainCell[] = []
    for (let z = 344; z <= 384; z += 4) {
      for (let x = -396; x <= -316; x += 4) cells.push(cellAt('greenway-alpha', x, z))
    }
    const layouts = seeds.map((seed) => {
      const actual = mireglassWaterTilesFor(seed, cells)
      const expected = cells.flatMap((cell) => {
        const [x, , z] = cell.position
        const depth = mireglassFenDepthAt(seed, x, z)
        return depth ? [{ x, z, depth }] : []
      })
      expect(actual).toEqual(expected)
      expect(actual.length).toBeGreaterThan(0)
      expect(actual.length).toBeLessThan(cells.length)
      expect(mireglassWaterTilesFor(seed, [cellAt(seed, -300, 300)])).toEqual([])
      const wet = actual[0]
      expect(mireglassWaterTilesFor(seed, [{ ...cellAt(seed, wet.x, wet.z), size: [8, 4] }])).toEqual([])
      return actual
    })
    expect(new Set(layouts.map((layout) => JSON.stringify(layout))).size).toBeGreaterThan(1)
  })

  it('aligns front and side rock faces with the real plateau seams across seeds', () => {
    for (const seed of seeds) {
      const x = -400
      const row = mireglassBermFaceRowAt(seed, x)
      const upper = cellAt(seed, x, row)
      const lower = cellAt(seed, x, row - 4)
      expect(mireglassPlateauAt(seed, x, row)).not.toBeNull()
      expect(mireglassPlateauAt(seed, x, row - 4)).toBeNull()
      const [front] = mireglassCliffFacesFor(seed, [upper, lower])
      expect(mireglassCliffFacesFor(seed, [upper, lower])).toHaveLength(1)
      expect(front).toMatchObject({ x, yaw: 0, rise: upper.position[1] - lower.position[1] })
      expect(front.z).toBeCloseTo(row - 2 + 0.02, 8)
      expect(front.y - front.rise / 2).toBeCloseTo(lower.position[1], 8)
      expect(front.y + front.rise / 2).toBeCloseTo(upper.position[1], 8)
      expect(front.rise).toBeGreaterThanOrEqual(0.8)

      const sideX = -440
      const sideZ = mireglassBermFaceRowAt(seed, sideX) + 8
      const sideUpper = cellAt(seed, sideX, sideZ)
      const sideLower = cellAt(seed, sideX - 4, sideZ)
      const [side] = mireglassCliffFacesFor(seed, [sideUpper, sideLower])
      expect(mireglassCliffFacesFor(seed, [sideUpper, sideLower])).toHaveLength(1)
      expect(side.x).toBeCloseTo(sideX - 2 + 0.02, 8)
      expect(side.z).toBe(sideZ)
      expect(side.yaw).toBe(Math.PI / 2)
      expect(side.rise).toBeGreaterThanOrEqual(0.8)
    }
  })

  it('does not invent walls at window edges, flat ground, or below the step threshold', () => {
    for (const seed of seeds) {
      const x = -400
      const row = mireglassBermFaceRowAt(seed, x)
      const upper = cellAt(seed, x, row)
      const lower = cellAt(seed, x, row - 4)
      expect(mireglassCliffFacesFor(seed, [upper])).toEqual([])
      expect(mireglassCliffFacesFor(seed, [lower])).toEqual([])
      expect(mireglassCliffFacesFor(seed, [upper, {
        ...lower, position: [x, upper.position[1] - 0.79, row - 4],
      }])).toEqual([])
      expect(mireglassCliffFacesFor(seed, [cellAt(seed, 0, 0), cellAt(seed, 4, 0)])).toEqual([])
      expect(mireglassCliffFacesFor(seed, [upper, cellAt(seed, x, row + 4)])).toEqual([])
    }
  })
})
