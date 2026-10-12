import { describe, expect, it } from 'vitest'
import { PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS,
  publicWorldV15ClearStarterResources } from './publicWorldV15StarterSites'
import { resolvePublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import { placementId, resolvePublicV17GreenwaySite as resolve } from './publicWorldV17GreenwaySites'
import { publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { createStarterCliffGreenwayFacts } from './starterCliffWorld'

const seed = 'wizard-realms'
const bridge = (worldSeed: string, q: number) => resolve(worldSeed,
  `works4:bridge:greenway-creek:${q}`)
const ladder = (worldSeed: string, q: number) => resolve(worldSeed,
  `works4:ladder:greenway-north-cliff:${q}`)

describe('pure v17 Greenway free-placement sites', () => {
  it('rejects a seeded hard ore just inside ladder clearance but accepts the adjacent outside snap', () => {
    const ore = publicWorldV15ClearStarterResources(seed,
      createStarterCliffGreenwayFacts(seed).resources)
      .find(({ id }) => id === 'resource-tile-4-1')
    expect(ore).toMatchObject({ kind: 'ore', position: { x: 4, z: -6.25 } })
    // The ore is within the ladder's z segment. Its deterministic ID scale
    // lies between 0.98 and 0.99, so the clearance edge is 1.226..1.233 m.
    expect(Math.abs(ore!.position.x - 2.8)).toBeLessThan(0.7 * 0.98 + 0.54)
    expect(Math.abs(ore!.position.x - 2.7)).toBeGreaterThan(0.7 * 0.99 + 0.54)
    expect(ladder(seed, 28)).toBeNull()
    expect(ladder(seed, 27)?.kind).toBe('ladder')
  })

  it('rejects a seeded waystone just inside bridge clearance but accepts the outside snap', () => {
    const waystone = createStarterCliffGreenwayFacts(seed).inscriptions
      .find(({ id }) => id === 'greenway_waystone')
    expect(waystone?.position).toMatchObject({ x: 3, z: 3 })
    // Bridge collision runs from z=3.5; the waystone is 0.5 m before it.
    const distance = (x: number) => Math.hypot(waystone!.position.x - x, 0.5)
    const clearance = 0.9 + PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS / 2 + 0.04
    expect(distance(1.4)).toBeLessThan(clearance)
    expect(distance(1.3)).toBeGreaterThan(clearance)
    expect(bridge(seed, 14)).toBeNull()
    expect(bridge(seed, 13)?.kind).toBe('bridge')
  })
  it('snaps half-decimetre ties canonically and rejects out-of-range aims', () => {
    expect(placementId('bridge', -0.05)).toBe('works4:bridge:greenway-creek:0')
    expect(placementId('bridge', 0.05)).toBe('works4:bridge:greenway-creek:1')
    expect(placementId('bridge', -9.1)).toBe('works4:bridge:greenway-creek:-91')
    expect(placementId('bridge', 9.15)).toBeNull()
    expect(placementId('ladder', 1.04)).toBeNull()
    expect(placementId('ladder', 1.05)).toBe('works4:ladder:greenway-north-cliff:11')
    expect(placementId('ladder', 29.4)).toBe('works4:ladder:greenway-north-cliff:294')
    expect(placementId('ladder', 29.45)).toBeNull()
    expect(placementId('bridge', NaN)).toBeNull()
    expect(placementId('ladder', Infinity)).toBeNull()
  })

  it('rejects forged, mismatched, noncanonical, and bounded-out IDs', () => {
    const canonical = bridge(seed, 1)
    expect(canonical?.id).toBe('works4:bridge:greenway-creek:1')
    for (const id of ['works4:bridge:greenway-creek:-0',
      'works4:bridge:greenway-creek:01', 'works4:bridge:greenway-creek:+1',
      'works4:bridge:greenway-creek:1.0', 'works4:bridge:greenway-creek:92',
      'works4:bridge:greenway-north-cliff:1', 'works4:ladder:greenway-creek:11',
      'works4:ladder:greenway-north-cliff:0', 'works4:ladder:greenway-north-cliff:10',
      'works4:ladder:greenway-north-cliff:295',
      'works4:bridge:greenway-creek:9007199254740992']) {
      expect(resolve(seed, id), id).toBeNull()
    }
    expect(resolve(seed, {})).toBeNull()
    expect(resolve(42 as unknown as string, 'works4:bridge:greenway-creek:0')).toBeNull()
    expect(bridge(seed, 1)).toEqual(canonical)
  })

  it('uses distinct snapped X positions without a hidden automatic shift', () => {
    const a = bridge(seed, 0), b = bridge(seed, 1)
    expect(a?.kind).toBe('bridge')
    expect(b?.kind).toBe('bridge')
    if (a?.kind !== 'bridge' || b?.kind !== 'bridge') return
    expect(a.from.x).toBe(0)
    expect(b.from.x).toBe(0.1)
    expect(a.widthMeters).toBe(PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS)
    expect(a.supportPath[1].x).toBe(a.from.x)
    expect(b.supportPath[1].x).toBe(b.from.x)
    expect(a.footprintTileIds).toEqual(b.footprintTileIds)
  })

  it('keeps a real upright ladder at the selected snap', () => {
    const a = ladder(seed, 11), b = ladder(seed, 12)
    expect(a?.kind).toBe('ladder')
    expect(b?.kind).toBe('ladder')
    if (a?.kind !== 'ladder' || b?.kind !== 'ladder') return
    expect(a.from.x).toBe(1.1)
    expect(b.from.x).toBe(1.2)
    expect(a.supportPath.map(({ z }) => z)).toEqual([-4, -5.35, -6, -8])
    expect(a.supportPath[2].y - a.supportPath[1].y).toBeGreaterThan(0.55)
    expect(a.widthMeters).toBe(1.05)
  })

  it('covers both canonical tile columns when the physical deck crosses their seam', () => {
    const site = bridge(seed, 12)
    expect(site?.kind).toBe('bridge')
    if (site?.kind !== 'bridge') return
    for (const gz of [0, 1, 2, 3, 4]) for (const gx of [0, 1]) {
      expect(site.footprintTileIds, `${gx},${gz}`).toContain(publicWorldV16TileAtGrid(seed, gx, gz).id)
    }
    expect(site.wetGapTileIds).toEqual([0, 1].map((gx) =>
      publicWorldV16TileAtGrid(seed, gx, 2).id))
    expect(site.footprintTileIds).toHaveLength(10)
  })

  it('requires actual terrain and rejects hard props at multiple seeds', () => {
    for (const worldSeed of [seed, 'p29-seed-0', 'v17-terrain-second']) {
      expect(bridge(worldSeed, 92)).toBeNull()
      expect(ladder(worldSeed, 0)).toBeNull()
      const highlandStore = createStarterCliffGreenwayFacts(worldSeed).stores[1]
      expect(highlandStore.position).toMatchObject({ x: 8, z: -6 })
      // Highland Arcanum occupies the north cliff near x=8, z=-6.
      expect(ladder(worldSeed, 80)).toBeNull()
      const farRise = publicWorldV16TileAtGrid(worldSeed, 7, -2).center.y
        - publicWorldV16TileAtGrid(worldSeed, 7, -1).center.y
      expect(farRise).toBeLessThanOrEqual(0.55)
      expect(ladder(worldSeed, 294)).toBeNull()
    }
  })

  it('returns stable sorted tree blockers and never mutates retained facts', () => {
    const a = bridge('p29-seed-0', 48)
    const b = bridge('p29-seed-0', 48)
    expect(a).toEqual(b)
    expect(a?.kind).toBe('bridge')
    if (a?.kind !== 'bridge' || b?.kind !== 'bridge') return
    expect(a.blockingResourceIds).toEqual([...a.blockingResourceIds].sort())
    expect(a.blockingResourceIds.length).toBeGreaterThan(0)
    const mutableBlockers = a.blockingResourceIds as string[]
    mutableBlockers.push('forged')
    expect(b.blockingResourceIds).not.toContain('forged')
    expect(bridge('p29-seed-0', 48)).toEqual(b)
  })

  it('repeats the same canonical bridge and ladder geometry without sharing results', () => {
    for (const id of ['works4:bridge:greenway-creek:12',
      'works4:ladder:greenway-north-cliff:11']) {
      const first = resolve(seed, id)
      const again = resolve(seed, id)
      expect(first?.id).toBe(id)
      expect(again).toEqual(first)
      expect(again).not.toBe(first)
    }
  })

  it('keeps same-ID resolutions separated by seed', () => {
    const id = 'works4:bridge:greenway-creek:48'
    const first = resolve('p29-seed-0', id)
    const other = resolve(seed, id)
    expect(first?.kind).toBe('bridge')
    expect(other).not.toEqual(first)
    expect(resolve('p29-seed-0', id)).toEqual(first)
    expect(resolve(seed, id)).toEqual(other)
  })

  it('detaches nested geometry and footprint arrays from later resolutions', () => {
    const first = bridge(seed, 12)
    expect(first?.kind).toBe('bridge')
    if (first?.kind !== 'bridge') return
    const expected = structuredClone(first)
    const footprint = first.footprintTileIds as string[]
    try {
      expect(Reflect.set(first.supportPath[0], 'x', -900)).toBe(true)
      expect(Reflect.set(first.gapBounds, 'minX', -900)).toBe(true)
      footprint.push('forged-tile')
      expect(bridge(seed, 12)).toEqual(expected)
    } finally {
      Reflect.set(first.supportPath[0], 'x', expected.supportPath[0].x)
      Reflect.set(first.gapBounds, 'minX', expected.gapBounds.minX)
      footprint.pop()
    }
  })

  it('returns the same null for canonical but blocked sites after valid resolutions', () => {
    expect(bridge(seed, 12)?.kind).toBe('bridge')
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(bridge(seed, 14)).toBeNull()
      expect(ladder(seed, 28)).toBeNull()
    }
    expect(bridge(seed, 12)?.kind).toBe('bridge')
  })

  it('delegates works3 lookup exactly, including malformed and rejected IDs', () => {
    for (const id of ['works3:bridge:1', 'works3:ladder:2', 'works3:dig:1:3',
      'works3:bridge:01', 'works3:ladder:999']) {
      expect(resolve(seed, id)).toEqual(resolvePublicV16GreenwaySite(seed, id))
    }
  })
})
