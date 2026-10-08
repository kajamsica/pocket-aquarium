import { describe, expect, it } from 'vitest'
import type { WizardTerrainCell } from './contracts'
import { landscapeDressingFor, type LandscapeDetail } from './landscapeDressing'

const cell = (x: number, z: number, climate = 'temperate_forest'): WizardTerrainCell => ({
  id: `tile-${x}-${z}`, position: [x * 4, 1, z * 4], size: [4, 4], height: 1, climate,
})

const grid = (climate: string) => Array.from({ length: 17 * 17 }, (_, index) =>
  cell(index % 17 - 8, Math.floor(index / 17) - 8, climate))
const lowland = (surface: 'marsh' | 'wetland' | 'loam') => surface === 'marsh' ? grid('marsh')
  : grid('temperate_forest').map((source) => ({ ...source, mireglassTerrain: surface }))

function distanceToSegment(detail: LandscapeDetail, from: readonly [number, number], to: readonly [number, number]) {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const t = Math.max(0, Math.min(1, ((detail.position[0] - from[0]) * dx
    + (detail.position[2] - from[1]) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(detail.position[0] - from[0] - t * dx, detail.position[2] - from[1] - t * dz)
}

describe('landscape dressing layout', () => {
  it('is repeatable from cell facts and does not mutate its input', () => {
    const source = Object.freeze([Object.freeze(cell(0, 0)), Object.freeze(cell(1, 0, 'marsh'))])
    const first = landscapeDressingFor(source)
    expect(landscapeDressingFor(source)).toEqual(first)
    expect(source[0].position).toEqual([0, 1, 0])
  })

  it('keeps the full 17 by 17 window dense but bounded to four small details per cell', () => {
    const cells = grid('temperate_forest')
    const details = landscapeDressingFor(cells)
    expect(details.length).toBeGreaterThan(650)
    expect(details.length).toBeLessThanOrEqual(1200)
    for (const source of cells) {
      const local = details.filter(({ position }) =>
        Math.abs(position[0] - source.position[0]) <= 1.7
        && Math.abs(position[2] - source.position[2]) <= 1.7)
      expect(local.length).toBeGreaterThanOrEqual(2)
      expect(local.length).toBeLessThanOrEqual(4)
    }
    for (const detail of details) {
      expect([...detail.position, detail.yaw, detail.scale].every(Number.isFinite)).toBe(true)
      expect(detail.scale).toBeGreaterThan(0)
      expect(detail.scale).toBeLessThanOrEqual(0.8)
      expect(detail.color).toMatch(/^#[0-9a-f]{6}$/)
      if (detail.kind === 'ground' || detail.kind === 'shrub' || detail.kind === 'stone') {
        const source = cells.find((tile) => Math.abs(detail.position[0] - tile.position[0]) <= 1.7
          && Math.abs(detail.position[2] - tile.position[2]) <= 1.7)!
        const radius = detail.kind === 'stone' ? 0.7 * detail.scale
          : detail.kind === 'shrub' ? 1.05 * detail.scale : detail.scale
        expect(Math.abs(detail.position[0] - source.position[0]) + radius).toBeLessThanOrEqual(1.7)
        expect(Math.abs(detail.position[2] - source.position[2]) + radius).toBeLessThanOrEqual(1.7)
      }
    }
    expect(details.some((detail) => detail.kind === 'shrub')).toBe(true)
    expect(details.some((detail) => detail.kind === 'stone')).toBe(true)
  })

  it('changes density, kinds, and palette with climate and authored surfaces', () => {
    const forest = landscapeDressingFor(grid('temperate_forest'))
    const marsh = landscapeDressingFor(grid('marsh'))
    expect(forest.some((detail) => detail.kind === 'flower')).toBe(true)
    expect(marsh.some((detail) => detail.kind === 'reed')).toBe(true)
    expect(landscapeDressingFor(grid('dry_highland')).length).toBeGreaterThan(landscapeDressingFor(grid('alpine')).length)
    expect(new Set(forest.map((detail) => detail.color))).not.toEqual(new Set(marsh.map((detail) => detail.color)))
    const base = cell(0, 0, 'dry_highland')
    expect(landscapeDressingFor([{ ...base, mireglassTerrain: 'wetland' }]))
      .not.toEqual(landscapeDressingFor([{ ...base, highlandSurface: 'quarry' }]))
  })

  it('omits generic dressing on ridge rock and gallery cells', () => {
    const base = cell(0, 0, 'dry_highland')
    expect(landscapeDressingFor([base]).length).toBeGreaterThan(0)
    for (const highlandRidgeCell of ['rock', 'gallery'] as const) {
      expect(landscapeDressingFor([{ ...base, highlandRidgeCell }])).toEqual([])
    }
  })

  it('places sparse lowland snags and more leafy alders without adding resources', () => {
    for (const surface of ['marsh', 'wetland', 'loam'] as const) {
      const cells = lowland(surface)
      const details = landscapeDressingFor(cells)
      const alders = details.filter((detail) => detail.kind === 'alder')
      const snags = details.filter((detail) => detail.kind === 'snag')
      expect(snags.length).toBeGreaterThanOrEqual(surface === 'loam' ? 10 : 14)
      expect(snags.length).toBeLessThanOrEqual(surface === 'loam' ? 25 : 35)
      expect(alders.length).toBeGreaterThanOrEqual(23)
      expect(alders.length).toBeLessThanOrEqual(47)
      expect(alders.length).toBeGreaterThan(snags.length)
      expect(details.length).toBeLessThanOrEqual(cells.length * 4)
      for (const trunk of [...alders, ...snags]) {
        const source = cells.find((tile) => Math.abs(trunk.position[0] - tile.position[0]) <= 1.7
          && Math.abs(trunk.position[2] - tile.position[2]) <= 1.7)!
        expect(Math.abs(trunk.position[0] - source.position[0]) + 0.45).toBeLessThanOrEqual(1.7)
        expect(Math.abs(trunk.position[2] - source.position[2]) + 0.45).toBeLessThanOrEqual(1.7)
      }
    }
    expect(landscapeDressingFor(grid('temperate_forest')).some((detail) =>
      detail.kind === 'snag' || detail.kind === 'alder')).toBe(false)
    for (const climate of ['dry_highland', 'alpine']) {
      expect(landscapeDressingFor(grid(climate).map((source) => ({ ...source, mireglassTerrain: 'loam' })))
        .some((detail) => detail.kind === 'snag' || detail.kind === 'alder')).toBe(false)
    }
  })

  it('keeps the rendered footprint of every physical detail clear of trails in neighboring cells', () => {
    const mireglassTrail = { from: [-2, 0] as const, to: [2, 0] as const }
    const highlandTrail = { from: [6, 0] as const, to: [10, 0] as const }
    const cells = grid('marsh').map((source) => source.id === 'tile-0-0'
      ? { ...source, mireglassTrailSegment: mireglassTrail }
      : source.id === 'tile-2-0'
        ? { ...source, highlandSurface: 'trail' as const, highlandTrailSegment: highlandTrail }
        : source)
    const details = landscapeDressingFor(cells).filter((detail) => detail.kind !== 'ground')
    for (const kind of ['grass', 'reed', 'shrub', 'flower', 'stone', 'snag', 'alder']) {
      expect(details.some((detail) => detail.kind === kind)).toBe(true)
    }
    for (const detail of details) {
      const clearance = detail.kind === 'stone' ? 0.65 + 0.7 * detail.scale
        : detail.kind === 'grass' ? 1.3 + 0.45 * detail.scale
          : detail.kind === 'reed' ? 1.3 + 0.38 * detail.scale
            : detail.kind === 'flower' ? 1.3 + 0.16 * detail.scale
              : detail.kind === 'shrub' ? 1.3 + 1.05 * detail.scale : 2.25
      expect(distanceToSegment(detail, mireglassTrail.from, mireglassTrail.to)).toBeGreaterThanOrEqual(clearance)
      expect(distanceToSegment(detail, highlandTrail.from, highlandTrail.to)).toBeGreaterThanOrEqual(clearance)
    }
  })

  it('leaves static store and resource clearings around visual trunks', () => {
    const cells = grid('marsh')
    const baseline = landscapeDressingFor(cells)
    const alder = baseline.find((detail) => detail.kind === 'alder')!
    const snag = baseline.find((detail) => detail.kind === 'snag')!
    const storePoint = [alder.position[0], alder.position[2]] as const
    const resourcePoint = [snag.position[0], snag.position[2]] as const
    const clearings = [storePoint, resourcePoint] as const
    const withClearings = landscapeDressingFor(cells, clearings)
    expect(withClearings).not.toEqual(baseline)
    expect(landscapeDressingFor(cells, clearings)).toEqual(withClearings)
    expect(landscapeDressingFor(cells, [resourcePoint, storePoint])).toEqual(withClearings)
    expect(withClearings.length).toBeLessThanOrEqual(cells.length * 4)
    for (const trunk of withClearings.filter((detail) => detail.kind === 'snag' || detail.kind === 'alder')) {
      expect(Math.hypot(trunk.position[0] - storePoint[0], trunk.position[2] - storePoint[1])).toBeGreaterThanOrEqual(2.5)
      expect(Math.hypot(trunk.position[0] - resourcePoint[0], trunk.position[2] - resourcePoint[1])).toBeGreaterThanOrEqual(2.5)
    }
  })

})
