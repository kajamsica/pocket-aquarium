import { describe, expect, it } from 'vitest'

import { createPocketReefShowcase, projectPocketState } from '../integration/pocketAquariumBridge'
import { specimenAssetFor } from './specimens/assetRegistry'
import {
  assignPelletTargets,
  createAcceptedShowcaseCatalog,
  isRenderableLivestockSpecies,
  resolveSpecimenPopulations,
  resolveSpecimenVisualPlan,
} from './SpecimenFish'

describe('specimen primary visual selection', () => {
  it.each(['watchman_goby', 'pistol_shrimp', 'epaulette_shark'])('suppresses the %s procedural body when its accepted GLB exists', (speciesId) => {
    const plan = resolveSpecimenVisualPlan(speciesId, Boolean(specimenAssetFor(speciesId)))
    expect(plan).toEqual({ renderAcceptedAsset: true })
    expect(Number(plan.renderAcceptedAsset) + Number(Boolean(plan.proceduralFallback))).toBe(1)
  })

  it.each(['watchman_goby', 'pistol_shrimp', 'epaulette_shark'] as const)('keeps the %s fallback available when no accepted asset resolves', (speciesId) => {
    const plan = resolveSpecimenVisualPlan(speciesId, false)
    expect(plan).toEqual({ renderAcceptedAsset: false, proceduralFallback: speciesId })
    expect(Number(plan.renderAcceptedAsset) + Number(Boolean(plan.proceduralFallback))).toBe(1)
  })

  it('does not invent a procedural duplicate for Ocellaris or an unknown species', () => {
    expect(resolveSpecimenVisualPlan('ocellaris', true)).toEqual({ renderAcceptedAsset: true })
    expect(resolveSpecimenVisualPlan('unknown_species', false)).toEqual({ renderAcceptedAsset: false })
  })

  it('admits any livestock species with an accepted asset without a renderer catalog entry', () => {
    expect(isRenderableLivestockSpecies('future_livestock_species', true)).toBe(true)
    expect(isRenderableLivestockSpecies('future_livestock_species', false)).toBe(false)
  })
})

describe('accepted catalog showcase boundary', () => {
  it('presents one default per 33 species and all 25 non-coral animals as visual-only entries', () => {
    const catalog = createAcceptedShowcaseCatalog()

    expect(catalog.acceptedSpeciesCount).toBe(33)
    expect(catalog.defaultAssets).toHaveLength(33)
    expect(new Set(catalog.defaultAssets.map((asset) => asset.speciesId))).toHaveProperty('size', 33)
    expect(catalog.defaultAssets.every((asset) => asset.defaultForSpecies)).toBe(true)
    expect(catalog.animalAssets).toHaveLength(25)
    expect(new Set(catalog.animalAssets.map((asset) => asset.speciesId))).toHaveProperty('size', 25)
    expect(catalog.animalAssets.every((asset) => asset.defaultForSpecies && asset.category !== 'coral')).toBe(true)
    expect(catalog.animalAssets.filter((asset) => asset.category === 'fish')).toHaveLength(13)
    expect(catalog.animalAssets.filter((asset) => asset.category === 'cleanup_crew')).toHaveLength(9)
    expect(catalog.animalAssets.filter((asset) => asset.category === 'invertebrate')).toHaveLength(3)
    expect(catalog.coralAssets).toHaveLength(8)
  })

  it('replaces authoritative occupants only in the renderer and leaves no feeding targets or root mutations', () => {
    const state = createPocketReefShowcase()
    const before = structuredClone(state)
    const catalog = createAcceptedShowcaseCatalog()
    const populations = resolveSpecimenPopulations(projectPocketState(state).specimens, catalog)
    const assignments = assignPelletTargets(populations.authoritative,
      [{ id: 1, x: 0, y: 0, z: 0, sunk: true, ageDays: 0 }], new Map(), 1)

    expect(populations.authoritative).toHaveLength(0)
    expect(populations.visualOnly).toEqual(catalog.animalAssets)
    expect(assignments).toHaveProperty('size', 0)
    expect(state).toEqual(before)
  })
})
