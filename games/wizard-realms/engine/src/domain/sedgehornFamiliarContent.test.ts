import { describe, expect, it } from 'vitest'
import { createFreshPublicV42Root } from './publicWorldV42Snapshot'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'

const threePatchSeeds = ['mireglass-corpus-2', 'mireglass-corpus-44', 'mireglass-corpus-74']
const canonical = createFreshPublicV42Root('wizard-realms').head

// Fresh roots are canonical-only, so noncanonical seeds are resolver probes,
// not claims that a fresh noncanonical V42 save can be created.
const progressForSeed = (seed: string) => ({
  ...canonical, state: { ...canonical.state, seed },
})

describe('seed-bound Sedgehorn encounter site', () => {
  it('preserves the shipped canonical four-anchor placement', () => {
    const site = resolveSedgehornFamiliarSite(canonical)!
    expect(site).not.toBeNull()
    expect([site.tracks.center, site.shelter.center,
      site.dryApproach.center, site.keeper.center].map(({ x, z }) => [x, z]))
      .toEqual([[-340, 320], [-372, 320], [-344, 344], [-376, 348]])
  })

  it('uses a distinct reachable dry keeper anchor for three-patch seeds without changing herb IDs', () => {
    for (const seed of threePatchSeeds) {
      const before = mireglassHerbPatches(seed)
      expect(before, seed).toHaveLength(3)
      const site = resolveSedgehornFamiliarSite(progressForSeed(seed))
      expect(site, seed).not.toBeNull()
      const anchors = [site!.tracks, site!.shelter, site!.dryApproach, site!.keeper]
      expect(new Set(anchors.map(({ id }) => id)).size, seed).toBe(4)
      expect(anchors.every(({ terrain }) => terrain === 'loam'), seed).toBe(true)
      expect(before.some(({ tile }) => Math.hypot(tile.center.x - site!.keeper.center.x,
        tile.center.z - site!.keeper.center.z) === 4
        && mireglassMoveBarrier(seed, tile.center, site!.keeper.center) === null), seed).toBe(true)
      expect(mireglassHerbPatches(seed).map(({ id }) => id), seed)
        .toEqual(before.map(({ id }) => id))
    }
  })

  it('resolves all corpus seeds and retains the existing four-patch ordering', () => {
    for (let index = 0; index < 100; index += 1) {
      const seed = `mireglass-corpus-${index}`
      const patches = mireglassHerbPatches(seed)
      const site = resolveSedgehornFamiliarSite(progressForSeed(seed))
      expect(site, seed).not.toBeNull()
      if (patches.length !== 4) continue
      const bell = site!.habitat.center
      const ranked = patches.map(({ tile }) => tile).sort((a, b) =>
        Math.hypot(a.center.x - bell.x, a.center.z - bell.z)
        - Math.hypot(b.center.x - bell.x, b.center.z - bell.z)
        || a.id.localeCompare(b.id))
      expect([site!.shelter.id, site!.tracks.id, site!.dryApproach.id,
        site!.keeper.id], seed).toEqual(ranked.map(({ id }) => id))
    }
  })
})
