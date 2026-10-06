import { describe, expect, it } from 'vitest'

import { specimenAssetFor } from '../scene/specimens/assetRegistry'
import { createPocketReefShowcase, projectPocketState } from './pocketAquariumBridge'
import { REEF_SHOWCASE_PROFILES, reefShowcaseProfile } from './showcaseProfiles'

const total = (rows: readonly { readonly count: number }[]) =>
  rows.reduce((sum, row) => sum + row.count, 0)

describe('reef showcase preset registry', () => {
  it('publishes stable, distinct presets for every requested tank tier and form', () => {
    expect(REEF_SHOWCASE_PROFILES.map(({ id }) => id)).toEqual([
      'reef-nano-20', 'reef-standard-40', 'reef-standard-200', 'reef-250',
      'reef-500', 'reef-monster-1000', 'reef-cylinder-1500',
    ])
    expect(REEF_SHOWCASE_PROFILES.map(({ tierId }) => tierId)).toEqual([
      'nano20', 'mid151', 'xl757', 'xxl946', 'mega1893', 'monster3785', 'cylinder5678',
    ])
    expect(reefShowcaseProfile()).toBe(reefShowcaseProfile('reef-monster-1000'))
    expect(reefShowcaseProfile('unknown-reef')).toBe(reefShowcaseProfile('reef-monster-1000'))
    expect(reefShowcaseProfile('reef-cylinder-1500')).toMatchObject({ form: 'cylinder' })
    expect(total(reefShowcaseProfile('reef-500').fishRoster)).toBe(22)
    expect(reefShowcaseProfile('reef-500').coralGarden).toHaveLength(38)
    expect(total(reefShowcaseProfile('reef-cylinder-1500').fishRoster)).toBe(36)
    expect(reefShowcaseProfile('reef-cylinder-1500').coralGarden).toHaveLength(42)
    expect(new Set(REEF_SHOWCASE_PROFILES.map(({ composition }) => composition))).toHaveProperty(
      'size', REEF_SHOWCASE_PROFILES.length,
    )
  })

  it('resolves every resident and coral through accepted runtime assets within explicit caps', () => {
    for (const profile of REEF_SHOWCASE_PROFILES) {
      const fishCount = total(profile.fishRoster)
      const cleanupCount = total(profile.cleanupRoster)
      expect(fishCount, `${profile.id} fish`).toBeLessThanOrEqual(profile.performanceCaps.maxFish)
      expect(cleanupCount, `${profile.id} cleanup`).toBeLessThanOrEqual(profile.performanceCaps.maxCleanupCrew)
      expect(profile.coralGarden.length, `${profile.id} coral`).toBeLessThanOrEqual(profile.performanceCaps.maxCorals)
      expect(fishCount + cleanupCount + profile.coralGarden.length, `${profile.id} render budget`)
        .toBeLessThanOrEqual(profile.performanceCaps.maxRenderedResidents)
      for (const row of [...profile.fishRoster, ...profile.cleanupRoster]) {
        expect(specimenAssetFor(row.speciesId), `${profile.id}:${row.speciesId}`).toBeDefined()
      }
      for (const coral of profile.coralGarden) {
        expect(specimenAssetFor(coral.speciesId, coral.variantId), coral.key).toBeDefined()
        expect(coral.placement.surfaceId).toMatch(/^rock:(?:[0-9]|1[0-2])$/)
        expect(coral.placement.position.every((value) => Number.isFinite(value))).toBe(true)
      }
    }
  })

  it('builds the massive preset as a mature, layered display without predators', () => {
    const profile = reefShowcaseProfile('reef-monster-1000')
    const state = createPocketReefShowcase('reef-monster-1000')
    const view = projectPocketState(state)
    const tangs = ['blue_hippo_tang', 'tomini_tang', 'yellow_tang', 'purple_tang', 'gem_tang']

    expect(state).toMatchObject({ tier: 'monster3785', water: { levelL: 3785 },
      equipment: { light: 'pro_led', circulation: 'gyre', skimmer: 'cone' } })
    expect(total(profile.fishRoster)).toBe(30)
    expect(total(profile.cleanupRoster)).toBe(39)
    expect(state.livestock).toHaveLength(69)
    expect(view.placedCorals).toHaveLength(48)
    expect(view.coralInventory).toHaveLength(0)
    expect(new Set(profile.fishRoster.map(({ swimBand }) => swimBand)).size).toBe(3)
    expect(tangs.every((speciesId) => profile.fishRoster.some((row) => row.speciesId === speciesId))).toBe(true)
    expect(profile.fishRoster.find(({ speciesId }) => speciesId === 'banggai_cardinal')?.count).toBe(10)
    expect(profile.fishRoster.find(({ speciesId }) => speciesId === 'regal_angelfish')?.count).toBe(1)
    expect(profile.fishRoster.find(({ speciesId }) => speciesId === 'six_line_wrasse')?.count).toBe(1)
    expect(profile.fishRoster.find(({ speciesId }) => speciesId === 'royal_gramma')?.count).toBe(1)
    expect(view.specimens.every(({ runtimeProfile }) => !runtimeProfile.predator)).toBe(true)
    expect(new Set(view.specimens.filter(({ runtimeProfile }) => !runtimeProfile.coralSafe
      || !runtimeProfile.invertSafe).map(({ speciesId }) => speciesId)))
      .toEqual(new Set(['regal_angelfish', 'six_line_wrasse']))
    expect(view.specimens.some(({ speciesId }) => speciesId === 'epaulette_shark')).toBe(false)
    expect(state.rockscape.rocks.every(({ biology }) => biology.coralline >= .48
      && biology.encruster >= .42 && biology.nuisanceAlgae <= .03)).toBe(true)
  })

  it('uses mature morphology diversity and plausible 450 nm fluorescence instead of uniform neon', () => {
    const profile = reefShowcaseProfile('reef-monster-1000')
    const pigments = profile.coralGarden.map(({ presentation }) => presentation.fluorescence)
    const cyanGreen = pigments.filter(({ pigment }) => pigment === 'green_cyan_fp' || pigment === 'mixed_fp')
    const redOrange = pigments.filter(({ pigment }) => pigment === 'red_orange_fp')
    const chromoproteins = pigments.filter(({ pigment }) => pigment === 'chromoprotein')

    expect(profile.lighting).toMatchObject({ actinicPeakNanometers: 450, blueFraction: .82 })
    expect(new Set(profile.coralGarden.map(({ speciesId }) => speciesId))).toHaveProperty('size', 9)
    expect(new Set(profile.coralGarden.map(({ morphology }) => morphology))).toHaveProperty('size', 7)
    expect(cyanGreen.length).toBeGreaterThan(redOrange.length)
    expect(redOrange.length).toBeGreaterThan(0)
    expect(chromoproteins.length).toBeGreaterThan(0)
    expect(chromoproteins.every(({ intensity }) => intensity <= .06)).toBe(true)
    expect(redOrange.every(({ intensity }) => intensity >= .5 && intensity <= .6)).toBe(true)
    expect(pigments.every(({ color }) => !/^#(?:ffff|ffee|ffd)/i.test(color))).toBe(true)
  })

  it('varies large-preset colony scale, height, spacing, and morphology-bounded orientation', () => {
    const large = ['reef-500', 'reef-monster-1000', 'reef-cylinder-1500'].map(reefShowcaseProfile)
    expect(large.map((item) => [total(item.fishRoster), total(item.cleanupRoster), item.coralGarden.length]))
      .toEqual([[22, 28, 38], [30, 39, 48], [36, 36, 42]])

    for (const profile of large) {
      const heights = profile.coralGarden.map(({ placement }) => placement.position[1])
      for (const coral of profile.coralGarden) {
        const [x, y, z] = coral.placement.normal
        const tilt = Math.acos(y) * 180 / Math.PI
        expect(Math.hypot(x, y, z), coral.key).toBeCloseTo(1, 8)
        expect(y, coral.key).toBeGreaterThan(.92)
        expect(Math.hypot(x, z), coral.key).toBeGreaterThan(.015)
        if (coral.morphology === 'table' || coral.morphology === 'plating'
          || coral.morphology === 'encrusting') expect(tilt, coral.key).toBeLessThan(6.5)
        else expect(tilt, coral.key).toBeGreaterThan(3)
      }
      expect(Math.max(...heights) - Math.min(...heights), profile.id).toBeGreaterThan(.15)
    }

    const scales = reefShowcaseProfile('reef-monster-1000').coralGarden
      .map(({ presentation }) => presentation.colonyScale)
    expect(Math.max(...scales)).toBeLessThan(3.3)
    expect(new Set(scales.map((scale) => scale < 1.8 ? 'small' : scale < 2.7 ? 'medium' : 'hero')))
      .toEqual(new Set(['small', 'medium', 'hero']))
  })
})
