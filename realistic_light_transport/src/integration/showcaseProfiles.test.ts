import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { normalizedTankPointToLocal } from '../scene/CoralPlacement'
import { createLiveRockUpperSurfaceSamples, LIVE_ROCK_SEED_OFFSET } from '../scene/liveRockGeometry'
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
    expect(view.placedCorals).toHaveLength(43)
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

  it('samples deterministic upward faces from the transformed rendered rock mesh', () => {
    const position = new THREE.Vector3(.3, -.8, .15)
    const rotation = new THREE.Euler(.28, .71, -.19)
    const scale = new THREE.Vector3(.72, .46, .61)
    const samples = createLiveRockUpperSurfaceSamples(37, position, rotation, scale, 703, 12)
    const replay = createLiveRockUpperSurfaceSamples(37, position, rotation, scale, 703, 12)
    const translated = createLiveRockUpperSurfaceSamples(37,
      position.clone().add(new THREE.Vector3(.4, .2, -.3)), rotation, scale, 703, 12)
    const rotated = createLiveRockUpperSurfaceSamples(37, position,
      new THREE.Euler(.08, 1.13, .17), scale, 703, 12)
    const otherMesh = createLiveRockUpperSurfaceSamples(38, position, rotation, scale, 703, 12)

    expect(replay.map(({ position: point, normal }) => [point.toArray(), normal.toArray()]))
      .toEqual(samples.map(({ position: point, normal }) => [point.toArray(), normal.toArray()]))
    expect(translated[0].position.clone().sub(samples[0].position)
      .distanceTo(new THREE.Vector3(.4, .2, -.3))).toBeLessThan(1e-12)
    expect(rotated[0].normal.distanceTo(samples[0].normal)).toBeGreaterThan(.01)
    expect(otherMesh[0].position.distanceTo(samples[0].position)).toBeGreaterThan(.01)
    for (const sample of samples) {
      expect(sample.normal.length()).toBeCloseTo(1, 8)
      expect(sample.normal.y).toBeGreaterThanOrEqual(.24)
    }
  })

  it('ties massive-preset colonies to distinct exact rock faces with conservative clearance', () => {
    const profile = reefShowcaseProfile('reef-monster-1000')
    const state = createPocketReefShowcase('reef-monster-1000')
    const replay = createPocketReefShowcase('reef-monster-1000')
    const space = { halfWidth: 2.76, halfDepth: 1.18, floorY: -1.44,
      waterlineY: -1.56 + 3.1 * .78 }
    const samplesByRock = new Map<number,
      ReturnType<typeof createLiveRockUpperSurfaceSamples>>()
    const points = state.corals.map((coral, index) => {
      const entry = profile.coralGarden[index]
      const rockId = Number(/^rock:(\d+)$/.exec(coral.placement?.surfaceId ?? '')?.[1])
      const rock = state.rockscape.rocks.find(({ id }) => id === rockId)!
      let samples = samplesByRock.get(rock.id)
      if (!samples) {
        samples = createLiveRockUpperSurfaceSamples(rock.index + LIVE_ROCK_SEED_OFFSET,
          new THREE.Vector3(...rock.position), new THREE.Euler(...rock.rotation),
          new THREE.Vector3(...rock.scale), rock.index + 701, 192)
        samplesByRock.set(rock.id, samples)
      }
      const point = normalizedTankPointToLocal(coral.placement!.position, space)
      const normal = new THREE.Vector3(...coral.placement!.normal)
      expect(normal.length(), entry.key).toBeCloseTo(1, 8)
      expect(coral.placement?.surfaceId, entry.key).toBe(entry.placement.surfaceId)
      expect(normal.y, entry.key).toBeGreaterThanOrEqual(
        entry.morphology === 'table' || entry.morphology === 'plating' ? .56
          : entry.morphology === 'encrusting' ? .42 : .3)
      expect(samples.some((sample) => {
        const delta = point.clone().sub(sample.position)
        return sample.normal.distanceTo(normal) < 1e-8 && delta.length() <= .035001
          && (delta.length() < 1e-8 || Math.abs(delta.normalize().dot(normal)) > .999999)
      }), entry.key).toBe(true)
      return point
    })
    expect(replay.corals.map(({ placement }) => placement))
      .toEqual(state.corals.map(({ placement }) => placement))
    expect(new Set(points.map((point) => point.toArray().map((value) => value.toFixed(4)).join(':'))).size)
      .toBe(points.length)
    expect(Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y)))
      .toBeGreaterThan(.5)
    expect(new Set(state.corals.map(({ placement }) => placement!.normal
      .map((value) => value.toFixed(3)).join(':'))).size).toBeGreaterThan(24)

    const sceneDepth = Math.cbrt(3.785 / (2.4 * 1.1 * .78))
    const sceneUnitsPerMeter = 5.52 / (sceneDepth * 2.4)
    const radii = profile.coralGarden.map((entry) => {
      const asset = specimenAssetFor(entry.speciesId, entry.variantId)!
      const factor = entry.morphology === 'table' || entry.morphology === 'plating' ? .5
        : entry.morphology === 'encrusting' ? .44 : entry.morphology === 'lps' ? .43
          : entry.morphology === 'soft_colony' ? .41 : entry.morphology === 'blade' ? .4 : .36
      return asset.referenceAdultLengthMeters * sceneUnitsPerMeter
        * entry.presentation.colonyScale * 1.2576 * factor
    })
    let minimumClearance = Infinity
    let closestPair = ''
    for (let index = 0; index < points.length; index += 1) {
      for (let other = index + 1; other < points.length; other += 1) {
        const clearance = points[index].distanceTo(points[other]) - radii[index] - radii[other]
        if (clearance < minimumClearance) {
          minimumClearance = clearance
          closestPair = `${profile.coralGarden[index].key}/${profile.coralGarden[other].key}`
        }
      }
    }
    // The radii deliberately overestimate sparse branches and irregular encrusting rims;
    // even that conservative envelope may overlap by no more than this shallow margin.
    expect(minimumClearance, closestPair).toBeGreaterThanOrEqual(-.07)
  })

  it('keeps large-preset counts, rosters, and scale bands within their intended budgets', () => {
    const large = ['reef-500', 'reef-monster-1000', 'reef-cylinder-1500'].map(reefShowcaseProfile)
    expect(large.map((item) => [total(item.fishRoster), total(item.cleanupRoster), item.coralGarden.length]))
      .toEqual([[22, 28, 38], [30, 39, 43], [36, 36, 42]])
    expect(large.map((item) => item.coralGarden[0].presentation.colonyScale))
      .toEqual([1.9564743102388455, 1.2580686460025814, 1.4366439854151563])
    expect(large[1].coralGarden[0].presentation.colonyScale)
      .toBeCloseTo(1.3978540511139796 * .9, 12)

    const scales = reefShowcaseProfile('reef-monster-1000').coralGarden
      .map(({ presentation }) => presentation.colonyScale)
    expect(Math.max(...scales)).toBeLessThan(3)
    expect(new Set(scales.map((scale) => scale < 1.62 ? 'small' : scale < 2.43 ? 'medium' : 'hero')))
      .toEqual(new Set(['small', 'medium', 'hero']))
  })
})
