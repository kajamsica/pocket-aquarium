import { describe, expect, it } from 'vitest'

import { resolveSpecimenLocomotionPlan } from './speciesBehavior'
import {
  createSurfaceCircuit,
  isSurfaceSpeciesId,
  sampleSurfaceCircuit,
  SURFACE_SPECIES_IDS,
  surfaceModeForSpecies,
} from './surfaceLocomotion'

const EXPECTED_MODES = {
  astrea_snail: 'glass_rock',
  blue_linckia: 'sand_rock',
  brittle_star: 'sand_rock',
  cerith_snail: 'sand_glass',
  cleaner_shrimp: 'rock_station',
  emerald_crab: 'sand_rock',
  fighting_conch: 'sand',
  nassarius_snail: 'sand',
  pistol_shrimp: 'sand_burrow',
  scarlet_hermit: 'sand_rock',
  trochus_snail: 'glass_rock',
  turbo_snail: 'glass_rock',
} as const

describe('surface locomotion policy', () => {
  it('classifies every accepted surface-bound animal with no fallback', () => {
    expect(SURFACE_SPECIES_IDS).toHaveLength(12)
    expect(Object.keys(EXPECTED_MODES).sort()).toEqual([...SURFACE_SPECIES_IDS].sort())
    for (const speciesId of SURFACE_SPECIES_IDS) {
      expect(isSurfaceSpeciesId(speciesId)).toBe(true)
      expect(surfaceModeForSpecies(speciesId)).toBe(EXPECTED_MODES[speciesId])
      expect(resolveSpecimenLocomotionPlan(speciesId)).toMatch(/_crawler$/)
    }
    expect(() => surfaceModeForSpecies('ocellaris')).toThrow('No surface locomotion mode')
    expect(() => createSurfaceCircuit('zoanthid', 1)).toThrow('No surface locomotion mode')
  })

  it('keeps sand residents on sand and gives specialist modes their required surfaces', () => {
    const segmentKinds = (speciesId: string) =>
      new Set(createSurfaceCircuit(speciesId, 17).segments.map((segment) => segment.kind))

    expect(segmentKinds('nassarius_snail')).toEqual(new Set(['sand']))
    expect(segmentKinds('fighting_conch')).toEqual(new Set(['sand']))
    expect(segmentKinds('pistol_shrimp')).toEqual(new Set(['sand']))
    expect(segmentKinds('cerith_snail')).toEqual(new Set(['sand', 'glass']))
    expect(segmentKinds('astrea_snail')).toEqual(new Set(['sand', 'glass', 'rock']))
    expect(segmentKinds('cleaner_shrimp')).toEqual(new Set(['sand', 'rock']))
    for (const speciesId of ['blue_linckia', 'brittle_star', 'emerald_crab', 'scarlet_hermit']) {
      expect(segmentKinds(speciesId)).toEqual(new Set(['sand', 'rock']))
    }
  })

  it('samples finite closed circuits with unit normals and tangents', () => {
    for (const [index, speciesId] of SURFACE_SPECIES_IDS.entries()) {
      const circuit = createSurfaceCircuit(speciesId, index + 1)
      expect(circuit.totalLength).toBeGreaterThan(0)
      expect(sampleSurfaceCircuit(circuit, 1).position.toArray())
        .toEqual(sampleSurfaceCircuit(circuit, 0).position.toArray())
      for (let step = 0; step < 64; step += 1) {
        const pose = sampleSurfaceCircuit(circuit, step / 64)
        expect(pose.position.toArray().every(Number.isFinite)).toBe(true)
        expect(pose.normal.length()).toBeCloseTo(1, 6)
        expect(pose.tangent.length()).toBeCloseTo(1, 6)
        expect(Math.abs(pose.normal.dot(pose.tangent))).toBeLessThan(1e-6)
      }
    }
  })
})
