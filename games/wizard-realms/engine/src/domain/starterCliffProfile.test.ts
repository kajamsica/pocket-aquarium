import { describe, expect, it } from 'vitest'
import { legacyTileAtGrid } from './generation'
import { STARTER_CLIFF_PROFILE, STARTER_CLIFF_RISE, STARTER_CLIFF_SITE_ID,
  starterCliffFace, starterCliffTile } from './starterCliffProfile'
import type { RouteProfile, WorldTile } from './types'

const seed = 'wizard-realms'
const publicSeed = 'greenway-alpha'
const tile = (x: number, z: number, sourceSeed = seed) =>
  legacyTileAtGrid(sourceSeed, x / 4 + 3, z / 4 + 3)
const raised = (x: number, z: number, sourceSeed = seed) =>
  starterCliffTile(sourceSeed, STARTER_CLIFF_PROFILE, tile(x, z, sourceSeed))
const uplift = (x: number, z: number) => raised(x, z).center.y - tile(x, z).center.y

function route(from: WorldTile, to: WorldTile): RouteProfile {
  return {
    id: 'greenway_ladder', name: 'Greenway ladder', fromAreaId: 'greenway',
    toAreaId: 'northern_ridge', siteId: null, from: from.center, to: to.center,
  }
}

const canonicalBuiltRoute = () => ({
  ...route(raised(0, -4, publicSeed), raised(0, -8, publicSeed)),
  siteId: STARTER_CLIFF_SITE_ID,
})

describe('opt-in Greenway starter cliff profile', () => {
  it('passes legacy and unknown profiles through by identity without changing their bytes', () => {
    for (const sourceSeed of [seed, 'greenway-alpha', 'legacy-progress']) {
      for (const [x, z] of [[0, -8], [20, -12], [0, -16]]) {
        const original = Object.freeze(tile(x, z, sourceSeed))
        const before = JSON.stringify(original)
        for (const profile of ['greenway-classic-v1', 'greenway-expanded-v1', 'unknown']) {
          expect(starterCliffTile(sourceSeed, profile, original)).toBe(original)
          expect(JSON.stringify(original)).toBe(before)
        }
      }
    }
  })

  it('forms a true 1.56m ladder rise with a walkable reference-seed approach and exit', () => {
    const spawn = raised(0, 0)
    const lower = raised(0, -4)
    const upper = raised(0, -8)
    const exit = raised(0, -12)
    expect(lower.center.y).toBeCloseTo(1.415318, 5)
    expect(upper.center.y - lower.center.y).toBeCloseTo(STARTER_CLIFF_RISE, 10)
    expect(upper.center.y).toBeCloseTo(2.975318, 5)
    expect(Math.abs(lower.center.y - spawn.center.y)).toBeLessThan(0.8)
    expect(Math.abs(exit.center.y - upper.center.y)).toBeLessThan(0.8)
    expect(raised(0, -8).center.y).toBe(upper.center.y)
    expect(tile(0, -8).center.y).toBeLessThan(upper.center.y)
  })

  it('keeps the rise seed-derived and deterministic', () => {
    for (const sourceSeed of [seed, 'greenway-alpha', 'other-new-world']) {
      const lower = raised(0, -4, sourceSeed)
      const upper = raised(0, -8, sourceSeed)
      expect(upper.center.y - lower.center.y).toBeCloseTo(STARTER_CLIFF_RISE, 10)
      expect(raised(0, -8, sourceSeed)).toEqual(upper)
    }
  })

  it('keeps full uplift on the ridge and tapers to zero outside the starter area', () => {
    expect(uplift(0, -8)).toBeCloseTo(uplift(16, -12), 10)
    expect(uplift(20, -12)).toBeCloseTo(uplift(0, -8) * 0.75, 10)
    expect(uplift(0, -16)).toBeCloseTo(uplift(0, -8) * 0.75, 10)
    for (const [x, z] of [[32, -8], [0, -28], [36, -8], [0, -4], [0, 0]]) {
      const original = tile(x, z)
      expect(starterCliffTile(seed, STARTER_CLIFF_PROFILE, original)).toBe(original)
    }
  })

  it('exposes only the canonical 0.65m, 1.05m-wide built ladder face', () => {
    const canonical = canonicalBuiltRoute()
    const face = starterCliffFace(publicSeed, canonical, STARTER_CLIFF_PROFILE, true)
    expect(face).toEqual({
      siteId: STARTER_CLIFF_SITE_ID, from: { x: 0, y: canonical.from.y, z: -5.35 },
      to: { x: 0, y: canonical.to.y, z: -6 }, width: 1.05,
    })
    expect(face!.to.y - face!.from.y).toBeCloseTo(STARTER_CLIFF_RISE, 10)
    expect(Math.abs(face!.to.z - face!.from.z)).toBeCloseTo(0.65, 10)
    expect(starterCliffFace(publicSeed, canonical, 'greenway-classic-v1', true)).toBeNull()
    expect(starterCliffFace(publicSeed, route(tile(0, -4, publicSeed), tile(0, -8, publicSeed)),
      STARTER_CLIFF_PROFILE, true)).toBeNull()
    expect(starterCliffFace(publicSeed, { ...canonical, from: { ...canonical.from, x: 2 } },
      STARTER_CLIFF_PROFILE, true)).toBeNull()
    expect(starterCliffFace(publicSeed, { ...canonical, siteId: 'greenway_ladder:x:2' },
      STARTER_CLIFF_PROFILE, true)).toBeNull()
    expect(starterCliffFace(seed, canonical, STARTER_CLIFF_PROFILE, true)).toBeNull()
    expect(starterCliffFace('', canonical, STARTER_CLIFF_PROFILE, true)).toBeNull()
  })

  it('never exposes support for an unbuilt route', () => {
    expect(starterCliffFace(publicSeed, canonicalBuiltRoute(), STARTER_CLIFF_PROFILE, false)).toBeNull()
  })

  it('requires the persisted canonical site ID as well as built state', () => {
    expect(starterCliffFace(publicSeed, { ...canonicalBuiltRoute(), siteId: null },
      STARTER_CLIFF_PROFILE, true)).toBeNull()
  })

  it('rejects forged absolute heights even when the rise is still 1.56m', () => {
    const canonical = canonicalBuiltRoute()
    const forged = { ...canonical, from: { ...canonical.from, y: canonical.from.y + 0.2 },
      to: { ...canonical.to, y: canonical.to.y + 0.2 } }
    expect(forged.to.y - forged.from.y).toBeCloseTo(STARTER_CLIFF_RISE, 10)
    expect(starterCliffFace(publicSeed, forged, STARTER_CLIFF_PROFILE, true)).toBeNull()
  })
})
