import { describe, expect, it } from 'vitest'

import { specimenAssetFor } from './specimens/assetRegistry'
import { resolveSpecimenVisualPlan } from './SpecimenFish'

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
})
