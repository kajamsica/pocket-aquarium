import { describe, expect, it } from 'vitest'

import {
  createLiveRockSurfaceContour,
  LIVE_ROCK_SEED_OFFSET,
} from './liveRockGeometry'
import { REEF_ROCKS, REEF_SAND_Y } from './reefLayout'

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

  it('samples a deterministic, continuous outer contour with outward unit normals', () => {
    const rock = REEF_ROCKS[4]
    const seed = LIVE_ROCK_SEED_OFFSET + 4
    const contour = createLiveRockSurfaceContour(seed, rock.position, rock.rotation, rock.scale)
    const replay = createLiveRockSurfaceContour(seed, rock.position, rock.rotation, rock.scale)

    expect(contour.map(({ position }) => position.toArray()))
      .toEqual(replay.map(({ position }) => position.toArray()))
    expect(contour[0].position.distanceTo(contour[contour.length - 1].position)).toBeLessThan(1e-8)
    for (let index = 0; index < contour.length; index += 1) {
      const sample = contour[index]
      expect(sample.position.toArray().every(Number.isFinite)).toBe(true)
      expect(sample.normal.length()).toBeCloseTo(1, 6)
      expect(sample.normal.dot(sample.position.clone().sub(rock.position))).toBeGreaterThan(0)
      if (index > 0) expect(sample.position.distanceTo(contour[index - 1].position)).toBeLessThan(.09)
    }
  })

  it.each(['blue_linckia', 'brittle_star'])(
    '%s follows the rendered jagged-rock contour with continuous outward poses', (speciesId) => {
      const circuit = createSurfaceCircuit(speciesId, 17)
      const rock = circuit.segments.find((segment) => segment.kind === 'rock')
      expect(rock?.kind).toBe('rock')
      if (!rock || rock.kind !== 'rock') return
      const rockIndex = REEF_ROCKS.indexOf(rock.rock)
      const renderedContour = createLiveRockSurfaceContour(
        rockIndex + LIVE_ROCK_SEED_OFFSET, rock.rock.position, rock.rock.rotation, rock.rock.scale)
      const distanceBefore = circuit.segments.slice(0, circuit.segments.indexOf(rock))
        .reduce((sum, segment) => sum + segment.length, 0)

      expect(rock.points[0].y).toBeCloseTo(REEF_SAND_Y, 8)
      expect(rock.points[rock.points.length - 1].y).toBeCloseTo(REEF_SAND_Y, 8)
      for (let index = 1; index < rock.points.length - 1; index += 1) {
        expect(renderedContour.some(({ position }) => position.distanceTo(rock.points[index]) < 1e-8))
          .toBe(true)
      }

      let previous = sampleSurfaceCircuit(circuit, distanceBefore / circuit.totalLength).position.clone()
      for (let step = 1; step <= 96; step += 1) {
        const progress = (distanceBefore + rock.length * step / 96) / circuit.totalLength
        const pose = sampleSurfaceCircuit(circuit, progress)
        expect(pose.position.y).toBeGreaterThanOrEqual(REEF_SAND_Y - 1e-8)
        expect(pose.position.distanceTo(previous)).toBeLessThan(.035)
        expect(pose.normal.dot(pose.position.clone().sub(rock.rock.position))).toBeGreaterThan(0)
        expect(pose.normal.length()).toBeCloseTo(1, 6)
        expect(Math.abs(pose.normal.dot(pose.tangent))).toBeLessThan(1e-6)
        previous = pose.position.clone()
      }
    },
  )
})
