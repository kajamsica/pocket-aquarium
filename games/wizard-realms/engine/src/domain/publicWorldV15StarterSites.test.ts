import { describe, expect, it } from 'vitest'
import { nearbyWorldTileIds, PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { PUBLIC_V15_STARTER_BRIDGE_ID, PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS,
  PUBLIC_V15_STARTER_CREEK_BOUNDS, PUBLIC_V15_STARTER_RESOURCE_CLEARANCE_METERS,
  PUBLIC_V15_STARTER_DIG_ID, publicWorldV15StarterSites,
  publicWorldV15StarterTileAtGrid, publicWorldV15ClearStarterResources,
  publicWorldV15SuppressedStarterResourceIds,
  resolvePublicWorldV15StarterSite } from './publicWorldV15StarterSites'
import { createStarterCliffGreenwayFacts, starterCliffWorldTileAtGrid } from './starterCliffWorld'

const seeds = ['greenway-alpha', 'region-0', 'wizard-realms', 'starter-seed-17',
  '4d3b-fog', 'wide-river', 'odd-string', '']
const generationSeeds = [...seeds,
  ...Array.from({ length: 48 }, (_, index) => 'resource-probe-' + index)]

describe('v15 authored Greenway works', () => {
  it.each(seeds)('keeps the first bridge and bank dig canonical for seed %s', (seed) => {
    const [bridge, dig] = publicWorldV15StarterSites(seed)
    expect(bridge).toMatchObject({ id: PUBLIC_V15_STARTER_BRIDGE_ID, kind: 'bridge',
      obstacle: 'greenway_creek', widthMeters: PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS,
      logCost: 8, xpReward: 80 })
    expect(dig).toMatchObject({ id: PUBLIC_V15_STARTER_DIG_ID, kind: 'dig',
      reward: { itemId: 'stone', quantity: 1, xp: 30 }, depthMeters: 0.24 })
    if (bridge.kind !== 'bridge' || dig.kind !== 'dig') throw new Error('Wrong starter-site kind')
    expect([bridge.approach, bridge.from, bridge.gapCenter, bridge.to, bridge.exit]
      .map(({ x, z }) => [x, z])).toEqual([[0, 0], [0, 4], [0, 8], [0, 12], [0, 16]])
    expect(bridge.footprintTileIds).toEqual(['tile-3-3', 'tile-3-4', 'tile-3-5',
      'tile-3-6', 'tile-3-7'])
    expect(bridge.wetGapTileIds).toEqual(['tile-1-5', 'tile-2-5', 'tile-3-5',
      'tile-4-5', 'tile-5-5'])
    expect(bridge.gapBounds).toEqual(PUBLIC_V15_STARTER_CREEK_BOUNDS)
    expect(bridge.supportPath.map(({ x, z }) => [x, z])).toEqual([[0, 4], [0, 8], [0, 12]])
    expect(bridge.supportPath[1].y).toBeGreaterThan(bridge.from.y)
    expect(bridge.supportPath[1].y).toBeGreaterThan(bridge.to.y)
    expect(dig.center).toMatchObject({ x: 4, z: 12 })
    expect(dig.footprintTileIds).toEqual(['tile-4-6', 'tile-3-6'])
    expect(dig.loweredCenter.y).toBeCloseTo(dig.center.y - 0.24)
    expect(Math.hypot(dig.adjacentStance.x - dig.center.x,
      dig.adjacentStance.z - dig.center.z)).toBeLessThan(3)
    expect(publicWorldV15StarterTileAtGrid(seed, 0, 3).center.y).toBe(dig.adjacentStance.y)
    expect(bridge.footprintTileIds.every((id) => nearbyWorldTileIds({ x: 0, z: 4 },
      PUBLIC_WALK_REVEAL_RADIUS_METERS).includes(id))).toBe(true)
    expect(publicWorldV15StarterSites(seed)).toEqual([bridge, dig])
  })

  it.each(seeds)('overlays only the v15 creek and its dry work cells for seed %s', (seed) => {
    for (let gx = -3; gx <= 3; gx++) {
      const v14 = starterCliffWorldTileAtGrid(seed, gx, 2)
      const v15 = publicWorldV15StarterTileAtGrid(seed, gx, 2)
      if (Math.abs(gx) <= 2) {
        expect(v15.terrain).toBe('wetland')
        expect(v15.biome).toBe('marsh')
        expect(v15.center.y).toBeLessThan(
          Math.min(starterCliffWorldTileAtGrid(seed, gx, 1).center.y,
            starterCliffWorldTileAtGrid(seed, gx, 3).center.y))
      } else expect(v15).toEqual(v14)
      expect(starterCliffWorldTileAtGrid(seed, gx, 2)).toEqual(v14)
    }
    for (const [gx, gz] of [[0, 0], [0, 1], [0, 3], [0, 4], [1, 3]]) {
      expect(publicWorldV15StarterTileAtGrid(seed, gx, gz).terrain).toBe('loam')
    }
    expect(publicWorldV15StarterTileAtGrid(seed, 3, 3))
      .toEqual(starterCliffWorldTileAtGrid(seed, 3, 3))
  })

  it('resolves exact authored IDs only and never interprets client coordinates', () => {
    const [bridge, dig] = publicWorldV15StarterSites('greenway-alpha')
    expect(resolvePublicWorldV15StarterSite('greenway-alpha', bridge.id)).toEqual(bridge)
    expect(resolvePublicWorldV15StarterSite('greenway-alpha', dig.id)).toEqual(dig)
    for (const id of ['works1:bridge:0:2:z', 'works2:bridge:0:8:z',
      'works2:dig:tile-4-6', PUBLIC_V15_STARTER_BRIDGE_ID + ':other',
      { id: PUBLIC_V15_STARTER_BRIDGE_ID }, null]) {
      expect(resolvePublicWorldV15StarterSite('greenway-alpha', id)).toBeNull()
    }
    expect(() => publicWorldV15StarterSites(null as never)).toThrow(TypeError)
  })

  it.each(generationSeeds)('keeps inherited resources intact while clearing a reachable starter path for seed %s', (seed) => {
    const source = createStarterCliffGreenwayFacts(seed).resources
    const original = structuredClone(source)
    const [bridge, dig] = publicWorldV15StarterSites(seed)
    if (bridge.kind !== 'bridge' || dig.kind !== 'dig') throw new Error('Wrong starter-site kind')
    const reserved = new Set([...bridge.footprintTileIds,
      ...bridge.wetGapTileIds, ...dig.footprintTileIds])
    const cleared = publicWorldV15ClearStarterResources(seed, source)
    const suppressed = publicWorldV15SuppressedStarterResourceIds(seed, source)
    expect(source).toEqual(original)
    expect(cleared).not.toBe(source)
    expect(cleared.length).toBeLessThan(source.length)
    expect(cleared.length).toBeGreaterThan(0)
    expect(cleared.every(({ tileId, position }) =>
      !reserved.has(tileId)
      && Math.hypot(position.x,
        position.z - Math.max(-2, Math.min(18, position.z)))
        >= PUBLIC_V15_STARTER_RESOURCE_CLEARANCE_METERS
      && Math.hypot(position.x - dig.center.x, position.z - dig.center.z)
        >= PUBLIC_V15_STARTER_RESOURCE_CLEARANCE_METERS)).toBe(true)
    expect(cleared.every((resource) => original.includes(resource))).toBe(false)
    expect(suppressed).toEqual(source.filter((resource) =>
      !cleared.some((visible) => visible.id === resource.id)).map(({ id }) => id).sort())
    expect(suppressed.length).toBeGreaterThan(0)
    // Two ordinary oaks suffice for eight logs. They stay on the spawn side
    // of the creek and within a short Greenway walk rather than beyond it.
    expect(cleared.filter((resource) => resource.kind === 'tree'
      && resource.position.z < bridge.gapBounds.nearZ
      && resource.position.z >= -5
      && Math.hypot(resource.position.x, resource.position.z) < 18
      && publicWorldV15StarterTileAtGrid(seed,
        Math.ceil(resource.position.x / 4 - 0.5),
        Math.ceil(resource.position.z / 4 - 0.5)).terrain !== 'wetland').length)
      .toBeGreaterThanOrEqual(2)
    expect(publicWorldV15ClearStarterResources(seed, source)).toEqual(cleared)
  })
})
