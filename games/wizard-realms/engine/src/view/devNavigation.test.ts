import { describe, expect, it } from 'vitest'
import { publicV25RiverTouchesSegment } from '../domain/publicWorldV25RiverSweep'
import type { WizardViewProjection } from './contracts'
import { planDevRoute } from './devNavigation'

function view(options: { minX?: number; maxX?: number; minZ?: number; maxZ?: number;
  hidden?: string; highNorth?: boolean; bridge?: boolean; ladder?: boolean } = {}) {
  const cells = [], tiles = []
  for (let gx = options.minX ?? -3; gx <= (options.maxX ?? 3); gx++) {
    for (let gz = options.minZ ?? -3; gz <= (options.maxZ ?? 4); gz++) {
      const id = `tile-${gx + 3}-${gz + 3}`, discovered = id !== options.hidden
      cells.push({ id, position: [gx * 4, options.highNorth && gz <= -2 ? 3 : 0, gz * 4],
        size: [4, 4], height: 1, climate: 'loam' })
      tiles.push({ id, gridX: gx + 3, gridZ: gz + 3, discovered })
    }
  }
  const bridge = { id: 'built-bridge', kind: 'bridge', widthMeters: 1.4,
    supportPath: [{ x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: 12 }],
    from: { x: 0, y: 0, z: 4 }, to: { x: 0, y: 0, z: 12 } }
  const ladder = { id: 'built-ladder', kind: 'ladder', widthMeters: 1.05,
    supportPath: [{ x: 0, y: 0, z: -4 }, { x: 0, y: 3, z: -8 }],
    from: { x: 0, y: 0, z: -4 }, to: { x: 0, y: 3, z: -8 } }
  return { seed: 'wizard-realms', terrain: cells, map: { tiles },
    resources: [],
    stores: [], routes: [],
    savedTerrainWorks: { builtSites: [
      ...(options.bridge ? [bridge] : []), ...(options.ladder ? [ladder] : [])],
    dugTileIds: [], preview: null },
    ...(options.highNorth ? { v26ValleyRimSegments: [{ id: 'north', kind: 'cliff',
      from: { x: -12, z: -6 }, to: { x: 12, z: -6 },
      ...(options.ladder ? { ladderAperture: true } : {}) }] } : {}) } as unknown as WizardViewProjection
}

describe('dev navigation route hint', () => {
  it('takes a direct known dry route and rejects an unrevealed destination', () => {
    expect(planDevRoute(view(), { x: 0, z: 0 }, { x: 8, z: 0 }))
      .toEqual({ ok: true, waypoints: [{ x: 8, z: 0 }] })
    const full = view()
    const visual = { ...full, terrain: full.terrain.filter((cell) => cell.id !== 'tile-5-3'),
      visualWorld: { terrain: full.terrain,
        discoveredTileIds: full.map.tiles.filter((tile) => tile.discovered).map((tile) => tile.id) } } as unknown as WizardViewProjection
    expect(planDevRoute(visual, { x: 0, z: 0 }, { x: 8, z: 0 }).ok).toBe(true)
    expect(planDevRoute(view({ hidden: 'tile-5-3' }), { x: 0, z: 0 }, { x: 8, z: 0 }).ok)
      .toBe(false)
  })

  it('uses the visible-world resource and store lists for remote obstacle clearance', () => {
    const base = view()
    for (const kind of ['resource', 'store'] as const) {
      const visible = { ...base, visualWorld: { terrain: base.terrain,
        discoveredTileIds: base.map.tiles.map((tile) => tile.id),
        resources: kind === 'resource' ? [{ available: true, position: [0, 0, 0] }] : [],
        stores: kind === 'store' ? [{ position: [0, 0, 0] }] : [] } } as unknown as WizardViewProjection
      const result = planDevRoute(visible, { x: -4, z: 0 }, { x: 4, z: 0 })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.waypoints.some((point) => Math.abs(point.z) > 0.7)).toBe(true)
    }
  })

  it('does not cut a canonical wet corner between two dry diagonal tiles', () => {
    const seed = 'wizard-realms'
    // The fixed seed has dry diagonal cells here, separated by a wet corner.
    const gx = -22, gz = 1
    const start = { x: gx * 4 + 1.75, z: gz * 4 + 1.75 }
    const end = { x: gx * 4 + 2.25, z: gz * 4 + 2.25 }
    expect(publicV25RiverTouchesSegment(seed, start, end)).toBe(true)
    const base = view({ minX: gx, maxX: gx + 1, minZ: gz, maxZ: gz + 1 })
    const known = new Set([`tile-${gx + 3}-${gz + 3}`, `tile-${gx + 4}-${gz + 4}`])
    const isolated = { ...base, map: { ...base.map,
      tiles: base.map.tiles.map((tile) => ({ ...tile, discovered: known.has(tile.id) })) } } as WizardViewProjection
    const result = planDevRoute(isolated, start, end)
    if (result.ok) {
      expect(result.waypoints).not.toEqual([end])
      let previous = start
      for (const next of result.waypoints) {
        expect(publicV25RiverTouchesSegment(seed, previous, next)).toBe(false)
        previous = next
      }
    }
  })

  it('uses only a built bridge to cross the connected river', () => {
    const start = { x: 0, z: 0 }, end = { x: 0, z: 16 }
    expect(planDevRoute(view(), start, end).ok).toBe(false)
    expect(planDevRoute(view({ bridge: true }), start, end))
      .toEqual({ ok: true, waypoints: [end] })
  })

  it('uses only a built ladder to cross the raised north face', () => {
    const start = { x: 0, z: -4 }, end = { x: 0, z: -8 }
    expect(planDevRoute(view({ highNorth: true }), start, end).ok).toBe(false)
    const unsupported = { ...view({ highNorth: true }), routes: [{ id: 'other-bridge',
      built: true, from: [0, 0, -4], to: [0, 3, -8] }] } as unknown as WizardViewProjection
    expect(planDevRoute(unsupported, start, end).ok).toBe(false)
    expect(planDevRoute(view({ highNorth: true, ladder: true }), start, end).ok).toBe(true)
  })

  it('approaches a short ladder face through its foot rather than entering from the side', () => {
    const base = view({ highNorth: true, ladder: true })
    const ladder = { ...base.savedTerrainWorks!.builtSites[0], supportPath: [
      { x: 0, y: 0, z: -4 }, { x: 0, y: 0, z: -5.35 },
      { x: 0, y: 3, z: -6 }, { x: 0, y: 3, z: -8 }] }
    const aperture = { ...base,
      savedTerrainWorks: { ...base.savedTerrainWorks!, builtSites: [ladder] },
      v26ValleyRimSegments: [
        { id: 'left', kind: 'cliff', from: { x: -12, z: -6 }, to: { x: -0.525, z: -6 } },
        { id: 'opening', kind: 'cliff', ladderAperture: true,
          from: { x: -0.525, z: -6 }, to: { x: 0.525, z: -6 } },
        { id: 'right', kind: 'cliff', from: { x: 0.525, z: -6 }, to: { x: 12, z: -6 } },
      ] } as WizardViewProjection
    const destination = { x: 0, z: -6.1 }
    const result = planDevRoute(aperture, { x: 0.6, z: -5.8 }, destination)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.waypoints).not.toEqual([destination])
  })

  it('does not admit an ordinary terrain rise above the checked 0.8 m step', () => {
    const base = view({ minX: 0, maxX: 1, minZ: -1, maxZ: -1 })
    const raised = { ...base, terrain: base.terrain.map((cell) => cell.id === 'tile-4-2'
      ? { ...cell, position: [cell.position[0], 0.82, cell.position[2]] as const } : cell) }
    expect(planDevRoute(raised, { x: 0, z: -4 }, { x: 4, z: -4 }).ok).toBe(false)
  })

  it('rejects requests beyond its bounded local search', () => {
    expect(planDevRoute(view(), { x: 0, z: 0 }, { x: 101, z: 0 })).toMatchObject({ ok: false })
  })

})
