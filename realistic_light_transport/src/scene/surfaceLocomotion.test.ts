import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import {
  createLiveRockSurfaceContour,
  LIVE_ROCK_SEED_OFFSET,
} from './liveRockGeometry'
import { REEF_ROCKS, REEF_SAND_Y } from './reefLayout'

import { resolveSpecimenLocomotionPlan } from './speciesBehavior'
import {
  createSurfaceCircuit,
  isSurfaceSpeciesId,
  sampleReefScapeSupport,
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
  function starfishRockSegment() {
    const segment = createSurfaceCircuit('blue_linckia', 17).segments
      .find((candidate) => candidate.kind === 'rock')
    expect(segment?.kind).toBe('rock')
    if (!segment || segment.kind !== 'rock') throw new Error('Missing deterministic rock segment')
    return segment
  }

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

  it('selects the exact rendered rock support near a rock surface', () => {
    const rock = starfishRockSegment()
    const index = Math.floor(rock.points.length / 2)
    const surfacePoint = rock.points[index]
    const surfaceNormal = rock.normals[index]
    const probe = surfacePoint.clone().addScaledVector(surfaceNormal, .025)

    const support = sampleReefScapeSupport(probe, surfaceNormal, .08)

    expect(support.kind).toBe('rock')
    expect(support.position.distanceTo(surfacePoint)).toBeLessThan(1e-5)
    expect(support.distance).toBeCloseTo(.025, 5)
    expect(support.normal.length()).toBeCloseTo(1, 6)
    expect(support.normal.dot(surfaceNormal)).toBeGreaterThan(.95)
  })

  it('selects analytic sand away from every rendered rock', () => {
    const probe = new THREE.Vector3(8, REEF_SAND_Y + .04, 0)

    const support = sampleReefScapeSupport(probe, new THREE.Vector3(0, 1, 0), .08)

    expect(support.kind).toBe('sand')
    expect(support.position.toArray()).toEqual([probe.x, REEF_SAND_Y, probe.z])
    expect(support.normal.toArray()).toEqual([0, 1, 0])
    expect(support.distance).toBeCloseTo(.04)
  })

  it('resolves adjacent arm samples independently across a rock and sand seam', () => {
    const rock = starfishRockSegment()
    const sandPoint = rock.points[0]
    const rockIndex = rock.points.findIndex((point) => point.y > REEF_SAND_Y + .04)
    expect(rockIndex).toBeGreaterThan(0)
    const rockPoint = rock.points[rockIndex]
    const rockNormal = rock.normals[rockIndex]

    const sandSupport = sampleReefScapeSupport(
      sandPoint, new THREE.Vector3(0, 1, 0), .12)
    const rockSupport = sampleReefScapeSupport(
      rockPoint.clone().addScaledVector(rockNormal, .02), rockNormal, .12)

    expect(sandPoint.distanceTo(rockPoint)).toBeLessThan(.2)
    expect(sandSupport.kind).toBe('sand')
    expect(rockSupport.kind).toBe('rock')
    expect(sandSupport.position.y).toBeCloseTo(REEF_SAND_Y, 8)
    expect(rockSupport.position.distanceTo(rockPoint)).toBeLessThan(1e-5)
  })

  it('keeps invalid and degenerate support inputs finite', () => {
    const target = {
      position: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      kind: 'rock' as const,
      distance: Number.NaN,
    }
    const support = sampleReefScapeSupport(
      new THREE.Vector3(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
      new THREE.Vector3(0, 0, 0), Number.NaN, target)

    expect(support).toBe(target)
    expect(support.kind).toBe('sand')
    expect(support.position.toArray().every(Number.isFinite)).toBe(true)
    expect(support.normal.toArray()).toEqual([0, 1, 0])
    expect(Number.isFinite(support.distance)).toBe(true)

    const invalidNormal = sampleReefScapeSupport(
      new THREE.Vector3(8, REEF_SAND_Y + .02, 0),
      new THREE.Vector3(Number.NaN, 0, 0), .08)
    expect(invalidNormal.position.toArray().every(Number.isFinite)).toBe(true)
    expect(invalidNormal.normal.toArray().every(Number.isFinite)).toBe(true)
    expect(Number.isFinite(invalidNormal.distance)).toBe(true)
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

describe('reef scape support preparation', () => {
  it('holds the authored pose while browser rock surfaces prepare one slice at a time', async () => {
    const slices: Array<() => void> = []
    vi.stubGlobal('window', {
      requestIdleCallback(callback: () => void) {
        slices.push(callback)
        return slices.length
      },
      setTimeout(callback: () => void) {
        slices.push(callback)
        return slices.length
      },
    })
    vi.resetModules()
    try {
      const { prepareReefScapeSupport, sampleReefScapeSupport } = await import('./surfaceLocomotion')
      const probe = new THREE.Vector3(0, REEF_SAND_Y + .04, 0)
      const maximumDistance = .08

      prepareReefScapeSupport()
      expect(slices).toHaveLength(1)
      const pending = sampleReefScapeSupport(probe, new THREE.Vector3(0, 1, 0), maximumDistance)
      expect(pending.position.toArray()).toEqual(probe.toArray())
      expect(pending.distance).toBeGreaterThan(maximumDistance)
      expect(Number.isFinite(pending.distance)).toBe(true)

      slices.shift()?.()
      expect(slices).toHaveLength(1)
      const stillPending = sampleReefScapeSupport(
        probe, new THREE.Vector3(0, 1, 0), maximumDistance)
      expect(stillPending.position.toArray()).toEqual(probe.toArray())
      expect(stillPending.distance).toBeGreaterThan(maximumDistance)
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })
})
