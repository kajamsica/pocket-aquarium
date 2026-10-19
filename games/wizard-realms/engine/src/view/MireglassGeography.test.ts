import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { mireglassBermFaceRowAt, mireglassFenDepthAt, mireglassPlateauAt } from '../domain/mireglassTerrain'
import { publicWorldV16TileAtGrid } from '../domain/publicWorldV16GreenwaySites'
import { publicV25RiverCellAtGrid, publicV25RiverCenterZ } from '../domain/publicWorldV25River'
import { placementId, resolvePublicV17GreenwaySite } from '../domain/publicWorldV17GreenwaySites'
import { worldTileAtGrid } from '../domain/worldChunks'
import type { WizardTerrainCell } from './contracts'
import { mireglassCliffFacesFor } from './MireglassCliffLayer'
import { GreenwayCreekWaterLayer, greenwayCreekWaterCellsFor, mireglassWaterTilesFor,
  v25RiverWaterCellsFor } from './MireglassWaterLayer'
import { buildTerrainSurfaceGeometry } from './TerrainSurfaceLayer'
import { visibleTerrainCells } from './visibleTerrain'

const seeds = ['greenway-alpha', 'mireglass-corpus-0', 'mireglass-corpus-1'] as const

function cellAt(seed: string, x: number, z: number): WizardTerrainCell {
  const tile = worldTileAtGrid(seed, x / 4, z / 4)
  return { id: tile.id, position: [x, tile.center.y, z], size: [4, 4],
    height: 0.7 + tile.elevation * 3, climate: tile.biome }
}

function greenwayCellAt(seed: string, x: number, z: number): WizardTerrainCell {
  const tile = publicWorldV16TileAtGrid(seed, x / 4, z / 4)
  return { id: tile.id, position: [x, tile.center.y, z], size: [4, 4],
    height: 0.7 + tile.center.y, climate: tile.biome }
}

describe('v17 Greenway creek water', () => {
  it('renders only the five authoritative wet cells and stays below the supported bridge', () => {
    const seed = 'wizard-realms'
    const allCells = [4, 8, 12].flatMap((z) =>
      [-12, -8, -4, 0, 4, 8, 12].map((x) => greenwayCellAt(seed, x, z)))
    const wet = greenwayCreekWaterCellsFor(seed, allCells)
    expect(wet.map((cell) => cell.position[0])).toEqual([-8, -4, 0, 4, 8])
    expect(wet.every((cell) => cell.position[2] === 8)).toBe(true)
    const appearanceFor = () => ({ top: new THREE.Color('#466f62'), side: new THREE.Color('#345047') })
    const markup = renderToStaticMarkup(createElement(GreenwayCreekWaterLayer,
      { seed, cells: allCells, allCells, appearanceFor }))
    expect(markup).toContain('name="Greenway creek water"')
    expect(markup).toContain('position="0,0.03,0"')
    const geometry = buildTerrainSurfaceGeometry(seed, wet, allCells, appearanceFor)
    const positions = geometry.top.getAttribute('position') as THREE.BufferAttribute
    const xs = Array.from({ length: positions.count }, (_, i) => positions.getX(i))
    const zs = Array.from({ length: positions.count }, (_, i) => positions.getZ(i))
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-10, 10])
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([6, 10])
    const bridgeId = placementId('bridge', -1.4)
    const bridge = bridgeId ? resolvePublicV17GreenwaySite(seed, bridgeId) : null
    if (bridge?.kind !== 'bridge') throw new Error('Missing off-center bridge')
    const center = wet.find((cell) => cell.position[0] === 0)!
    expect(center.position[1] + 0.03).toBeLessThan(bridge.supportPath[1].y)
    geometry.top.dispose(); geometry.sides.dispose()
  })

  it('renders nothing for dry, noncanonical, or unrevealed creek cells', () => {
    const seed = 'wizard-realms'
    const wet = greenwayCellAt(seed, 0, 8)
    const dry = greenwayCellAt(seed, 0, 4)
    const noncanonical = { ...wet, id: 'dry-impostor' }
    const wrongHeight = { ...wet, position: [0, wet.position[1] + 0.24, 8] as const }
    expect(greenwayCreekWaterCellsFor(seed, [dry, noncanonical, wrongHeight])).toEqual([])
    const appearanceFor = () => ({ top: new THREE.Color(), side: new THREE.Color() })
    expect(renderToStaticMarkup(createElement(GreenwayCreekWaterLayer,
      { seed, cells: [dry], allCells: [dry, wet], appearanceFor }))).toBe('')
    expect(renderToStaticMarkup(createElement(GreenwayCreekWaterLayer,
      { seed, cells: [], allCells: [dry, wet], appearanceFor }))).toBe('')
  })
})

describe('V25 connected river water', () => {
  const appearanceFor = () => ({ top: new THREE.Color('#466f62'), side: new THREE.Color('#345047') })

  it('uses exactly the five central canonical cells and retains the bridge-height mesh', () => {
    const seed = 'wizard-realms'
    const cells = [4, 8, 12].flatMap((z) => [-8, -4, 0, 4, 8].map((x) => greenwayCellAt(seed, x, z)))
    const wet = v25RiverWaterCellsFor(seed, cells)
    expect(wet.map((cell) => cell.position[0])).toEqual([-8, -4, 0, 4, 8])
    expect(wet.every((cell) => cell.position[2] === 8)).toBe(true)
    expect(renderToStaticMarkup(createElement(GreenwayCreekWaterLayer,
      { seed, cells, allCells: cells, appearanceFor, v25RiverActive: true })))
      .toContain('name="Greenway creek water" position="0,0.03,0"')
  })

  it('draws a bent downstream cell only in V25, never in the default V24 creek', () => {
    const seed = 'wizard-realms'
    let gx = 3
    while (gx < 255 && publicV25RiverCenterZ(seed, gx) === 2) gx += 1
    expect(gx).toBeLessThan(255)
    const center = publicV25RiverCenterZ(seed, gx)
    const cells = [center - 1, center, center + 1].map((gz) => cellAt(seed, gx * 4, gz * 4))
    const wet = v25RiverWaterCellsFor(seed, cells)
    expect(wet.map((cell) => cell.position[2] / 4))
      .toEqual([center - 1, center, center + 1].filter((gz) => publicV25RiverCellAtGrid(seed, gx, gz)))
    expect(wet.length).toBeGreaterThan(0)
    expect(renderToStaticMarkup(createElement(GreenwayCreekWaterLayer,
      { seed, cells, allCells: cells, appearanceFor }))).toBe('')
    expect(renderToStaticMarkup(createElement(GreenwayCreekWaterLayer,
      { seed, cells, allCells: cells, appearanceFor, v25RiverActive: true })))
      .toContain('name="Greenway creek water"')
  })

  it('selects only the supplied bounded and revealed window, rejecting malformed cells', () => {
    const seed = 'wizard-realms'
    const all = Array.from({ length: 11 * 11 }, (_, index) =>
      cellAt(seed, (index % 11 - 5) * 4, (Math.floor(index / 11) - 3) * 4))
    const visible = visibleTerrainCells(all, [0, 0, 8], 2)
    const revealedIds = new Set(visible.filter((cell) => cell.position[0] <= 0).map((cell) => cell.id))
    const revealed = visible.filter((cell) => revealedIds.has(cell.id))
    const wet = v25RiverWaterCellsFor(seed, revealed)
    expect(visible).toHaveLength(25)
    expect(wet.length).toBeGreaterThan(0)
    expect(wet.every((cell) => revealedIds.has(cell.id) && visible.includes(cell))).toBe(true)
    expect(v25RiverWaterCellsFor(seed, [{ ...wet[0], size: [8, 4] },
      { ...wet[0], position: [1, wet[0].position[1], 8] }])).toEqual([])
  })
})

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
