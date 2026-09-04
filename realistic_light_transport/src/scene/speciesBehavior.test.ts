import { describe, expect, it } from 'vitest'

import runtimeAcceptance from '../assets/specimens/runtime-acceptance.v1.json'
import {
  ACCEPTED_ANIMAL_SPECIES_IDS,
  fishHabitatPolicyFor,
  isAcceptedAnimalSpeciesId,
  isSurfaceBoundLocomotion,
  resolveSpecimenLocomotionPlan,
  speciesBehaviorPolicyFor,
  specimenSpeedMultiplierFor,
} from './speciesBehavior'

const acceptedAnimalIds = runtimeAcceptance.assets
  .filter((asset) => asset.defaultForSpecies && asset.category !== 'coral')
  .map((asset) => asset.speciesId)
  .sort()

describe('accepted animal behavior policy', () => {
  it('exhaustively matches the 25 accepted non-coral defaults', () => {
    expect(ACCEPTED_ANIMAL_SPECIES_IDS).toHaveLength(25)
    expect([...ACCEPTED_ANIMAL_SPECIES_IDS].sort()).toEqual(acceptedAnimalIds)
    expect(ACCEPTED_ANIMAL_SPECIES_IDS.every(isAcceptedAnimalSpeciesId)).toBe(true)
    for (const speciesId of ACCEPTED_ANIMAL_SPECIES_IDS) {
      expect(speciesBehaviorPolicyFor(speciesId).locomotion)
        .toBe(resolveSpecimenLocomotionPlan(speciesId))
    }
  })

  it('rejects unknown and coral IDs instead of silently using a generic policy', () => {
    expect(isAcceptedAnimalSpeciesId('zoanthid')).toBe(false)
    expect(() => speciesBehaviorPolicyFor('zoanthid')).toThrow('No accepted animal behavior policy')
    expect(() => speciesBehaviorPolicyFor('unknown_fish')).toThrow('No accepted animal behavior policy')
  })

  it('classifies the accepted fish and special invertebrate behaviors explicitly', () => {
    expect(resolveSpecimenLocomotionPlan('ocellaris')).toBe('rock_fish')
    expect(resolveSpecimenLocomotionPlan('black_storm_ocellaris')).toBe('rock_fish')
    expect(resolveSpecimenLocomotionPlan('six_line_wrasse')).toBe('rock_fish')
    expect(resolveSpecimenLocomotionPlan('yellow_tang')).toBe('open_water_fish')
    expect(resolveSpecimenLocomotionPlan('diamond_goby')).toBe('benthic_fish')
    expect(resolveSpecimenLocomotionPlan('cleaner_shrimp')).toBe('cleaner_station_crawler')
    expect(resolveSpecimenLocomotionPlan('pistol_shrimp')).toBe('burrow_crawler')
    expect(isSurfaceBoundLocomotion(resolveSpecimenLocomotionPlan('blue_linckia'))).toBe(true)
    expect(isSurfaceBoundLocomotion(resolveSpecimenLocomotionPlan('brittle_star'))).toBe(true)
    expect(isSurfaceBoundLocomotion(resolveSpecimenLocomotionPlan('emerald_crab'))).toBe(true)
    expect(isSurfaceBoundLocomotion(resolveSpecimenLocomotionPlan('scarlet_hermit'))).toBe(true)
  })

  it('keeps relative pace ordered from slow crawlers through open-water fish', () => {
    const ordered = ['astrea_snail', 'emerald_crab', 'watchman_goby', 'banggai_cardinal',
      'ocellaris', 'yellow_tang'] as const
    const multipliers = ordered.map(specimenSpeedMultiplierFor)
    multipliers.slice(1).forEach((value, index) => expect(value).toBeGreaterThan(multipliers[index]))
  })

  it('provides habitat policies for every accepted fish but never for a crawler', () => {
    const fishIds = ACCEPTED_ANIMAL_SPECIES_IDS.filter((speciesId) =>
      !isSurfaceBoundLocomotion(resolveSpecimenLocomotionPlan(speciesId)))
    expect(fishIds).toHaveLength(13)
    fishIds.forEach((speciesId) => expect(fishHabitatPolicyFor(speciesId).verticalBand).toHaveLength(2))
    expect(() => fishHabitatPolicyFor('astrea_snail')).toThrow('does not have fish habitat policy')
  })
})
