import { describe, expect, it } from 'vitest'
import { highlandRidgeCellAt } from '../domain/highlandRidge'
import { WORLD_CELL_METERS } from '../domain/worldChunks'
import type { WizardTerrainCell } from './contracts'
import { highlandRidgeInstancesFor, shouldRenderHighlandRidgeFor } from './HighlandRidgeLayer'

const terrainCell = (x: number, z: number): WizardTerrainCell => ({
  id: `ridge-${x}-${z}`, position: [x, 1, z],
  size: [WORLD_CELL_METERS, WORLD_CELL_METERS], height: 1, climate: 'dry_highland',
})

const ridgeWindow = () => {
  const cells: WizardTerrainCell[] = []
  for (let z = -520; z <= -416; z += WORLD_CELL_METERS) {
    for (let x = 560; x <= 596; x += WORLD_CELL_METERS) cells.push(terrainCell(x, z))
  }
  return cells
}

describe('Highland ridge view geometry', () => {
  it('bounds the full ridge footprint to rock masses, gallery roofs, and exposed walls', () => {
    const cells = ridgeWindow()
    const { rocks, walls, roofs } = highlandRidgeInstancesFor(cells)

    expect(cells).toHaveLength(270)
    expect(rocks).toHaveLength(250)
    expect(roofs).toHaveLength(20)
    expect(walls).toHaveLength(90)
  })

  it('classifies exposed faces from the canonical mask beyond the visible window', () => {
    expect(highlandRidgeInstancesFor([terrainCell(576, -476)]).walls).toHaveLength(0)
    const gallerySide = highlandRidgeInstancesFor([terrainCell(576, -472)]).walls
    expect(gallerySide).toHaveLength(1)
    expect([gallerySide[0].x, gallerySide[0].z]).toEqual([576, -470])
    const galleryCorner = highlandRidgeInstancesFor([terrainCell(560, -472)]).walls
    expect(galleryCorner).toHaveLength(2)
    expect(new Set(galleryCorner.map(({ x, z }) => `${x}:${z}`)))
      .toEqual(new Set(['558:-472', '560:-470']))
  })

  it('leaves both complete gallery rows open beneath their roofs', () => {
    const { rocks, roofs } = highlandRidgeInstancesFor(ridgeWindow())
    const galleryCenters: string[] = []
    for (const z of [-468, -464]) {
      for (let x = 560; x <= 596; x += WORLD_CELL_METERS) galleryCenters.push(`${x}:${z}`)
    }

    expect(new Set(roofs.map(({ x, z }) => `${x}:${z}`))).toEqual(new Set(galleryCenters))
    expect(rocks.every(({ x, z }) => highlandRidgeCellAt(x, z) === 'rock')).toBe(true)
    expect(rocks.some(({ z }) => z === -468 || z === -464)).toBe(false)
  })

  it('hides every ridge mesh for an old save inside rock, then restores it in the gallery or open ground', () => {
    expect(shouldRenderHighlandRidgeFor([580, 2, -500])).toBe(false)
    expect(shouldRenderHighlandRidgeFor([580, 2, -468])).toBe(true)
    expect(shouldRenderHighlandRidgeFor([552, 2, -468])).toBe(true)
    // Exact ties belong to the lower grid cell, matching authoritative movement gating.
    expect(shouldRenderHighlandRidgeFor([580, 2, -470])).toBe(false)
    expect(shouldRenderHighlandRidgeFor([580, 2, -469.999])).toBe(true)
  })
})
