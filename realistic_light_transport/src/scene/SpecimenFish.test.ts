import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { createPocketReefShowcase, projectPocketState } from '../integration/pocketAquariumBridge'
import { specimenAssetFor } from './specimens/assetRegistry'
import { REEF_ROCKS } from './reefLayout'
import {
  advanceSpecimenMotionState,
  assignPelletTargets,
  createSpecimenMotionState,
  createSpecimenMotionRoute,
  createAcceptedShowcaseCatalog,
  constrainSpecimenHardscapeTravel,
  constrainSpecimenHardscapeTurn,
  decideSpecimenDirection,
  isRenderableLivestockSpecies,
  guideSpecimenAroundHardscape,
  limitSpecimenFrameTravel,
  limitSpecimenFrameTurn,
  measureSpecimenCrowd,
  minimumSpecimenHardscapeClearance,
  resolveSpecimenPopulations,
  resolveSpecimenVisualPlan,
  sampleSpecimenMotionRoute,
  specimenBehaviorProfile,
  specimenCollisionEnvelope,
  specimenDirectionInterval,
  specimenReversalThreshold,
  steerSpecimenHeading,
} from './SpecimenFish'

const TEST_ENVELOPE = { longitudinal: .3, lateral: .14 }
const neighbor = (x: number, z: number, velocityX: number, velocityZ: number,
  profile: ReturnType<typeof specimenBehaviorProfile> = 'reef_cruise') => ({
  position: new THREE.Vector3(x, 0, z), velocity: new THREE.Vector3(velocityX, 0, velocityZ),
  profile, ...TEST_ENVELOPE, verticalClearance: .2,
})
describe('specimen motion continuity', () => {
  it('caps travel at the frame delta and at 50 ms after a stall', () => {
    const regularFrame = new THREE.Vector3(10, 0, 0)
    const stalledFrame = new THREE.Vector3(10, 0, 0)
    expect(limitSpecimenFrameTravel(new THREE.Vector3(), regularFrame, 2, 1 / 60)).toBeCloseTo(2 / 60)
    expect(regularFrame.x).toBeCloseTo(2 / 60)
    expect(limitSpecimenFrameTravel(new THREE.Vector3(), stalledFrame, 2, .18)).toBeCloseTo(.1)
    expect(stalledFrame.x).toBeCloseTo(.1)
  })
  it('caps a 180 degree turn and crosses the wrap boundary by the shortest arc', () => {
    expect(limitSpecimenFrameTurn(0, Math.PI, 5.2, 1 / 60)).toBeCloseTo(5.2 / 60)
    expect(limitSpecimenFrameTurn(Math.PI - .01, -Math.PI + .01, 5.2, 1 / 60)).toBeCloseTo(Math.PI + .01)
  })
  it('replays identical seeds and varies route, phase, and speed across seeds', () => {
    const first = createSpecimenMotionRoute(7, 'mid', .86, .16)
    const replay = createSpecimenMotionRoute(7, 'mid', .86, .16)
    const other = createSpecimenMotionRoute(8, 'mid', .86, .16)
    const samples = (route: ReturnType<typeof createSpecimenMotionRoute>) => [0, .2, .4, .6, .8]
      .map((progress) => sampleSpecimenMotionRoute(route, progress, .16, new THREE.Vector3()).toArray())
    expect(samples(replay)).toEqual(samples(first))
    expect({ phase: replay.phase, speed: replay.speed, direction: replay.direction })
      .toEqual({ phase: first.phase, speed: first.speed, direction: first.direction })
    expect(samples(other)).not.toEqual(samples(first))
    expect([other.phase, other.speed]).not.toEqual([first.phase, first.speed])
    expect([0, 1, 2].map((index) => specimenDirectionInterval(other, index)))
      .not.toEqual([0, 1, 2].map((index) => specimenDirectionInterval(first, index)))
  })
  it('makes a direction decision without changing progress at the boundary', () => {
    const route = createSpecimenMotionRoute(7, 'mid', .86, .16)
    const state = createSpecimenMotionState(route)
    const initialProgress = state.progress
    const initialDirection = state.direction
    const switchAfter = state.secondsUntilSwitch
    advanceSpecimenMotionState(state, route, switchAfter)
    expect(state.progress).toBeCloseTo(THREE.MathUtils.euclideanModulo(
      initialProgress + switchAfter * route.speed * initialDirection, 1))
    expect(state.direction).toBe(initialDirection)
    expect(state.secondsUntilSwitch).toBeGreaterThanOrEqual(8)
    expect(state.secondsUntilSwitch).toBeLessThanOrEqual(20)
  })
  it('seeds mixed initial and later directions while retaining distinct phase and speed', () => {
    const routes = [1, 2, 3, 4].map((seed) => createSpecimenMotionRoute(seed, 'mid', .86, .16))
    const states = routes.map(createSpecimenMotionState)
    expect(new Set(routes.map((route) => route.direction))).toEqual(new Set([-1, 1]))
    expect(new Set(routes.map((route) => route.phase))).toHaveProperty('size', routes.length)
    expect(new Set(routes.map((route) => route.speed))).toHaveProperty('size', routes.length)
    states.forEach((state, index) => advanceSpecimenMotionState(state, routes[index], state.secondsUntilSwitch))
    expect(new Set(states.map((state) => state.direction))).toEqual(new Set([-1, 1]))
  })
  it('does not avoid a diverging neighbor', () => {
    const position = new THREE.Vector3(-.2, .07, 0)
    const heading = new THREE.Vector3(-1, 0, 0)
    expect(steerSpecimenHeading(heading, heading.clone(), heading.clone(), position, 1, .2, TEST_ENVELOPE,
      new Map([[2, neighbor(.2, 0, 1, 0)]]), 'reef_cruise', 1 / 60)).toBe(0)
    expect(position).toEqual(new THREE.Vector3(-.2, .07, 0))
  })
  it('does not falsely avoid an equal-speed parallel neighbor', () => {
    const heading = new THREE.Vector3(1, 0, 0)
    const velocity = new THREE.Vector3(.4, 0, 0)
    expect(steerSpecimenHeading(heading, heading.clone(), velocity, new THREE.Vector3(-.4, 0, 0),
      1, .2, TEST_ENVELOPE, new Map([[2, neighbor(.4, 0, .4, 0)]]), 'reef_cruise', 1 / 60)).toBe(0)
  })
  it('lets a faster follower pass without overlap and releases avoidance after divergence', () => {
    const routeHeading = new THREE.Vector3(1, 0, 0)
    const leader = new THREE.Vector3(0, 0, 0)
    const follower = new THREE.Vector3(-.7, 0, 0)
    const followerHeading = routeHeading.clone()
    const leaderSpeed = .2
    const followerSpeed = .6
    const delta = .05
    let minimumDistance = Infinity
    let maximumTurn = 0
    for (let frame = 0; frame < 160; frame += 1) {
      maximumTurn = Math.max(maximumTurn, steerSpecimenHeading(followerHeading, routeHeading,
        followerHeading.clone().multiplyScalar(followerSpeed), follower, 1, .2, TEST_ENVELOPE,
        new Map([[2, neighbor(leader.x, leader.z, leaderSpeed, 0)]]), 'reef_cruise', delta))
      follower.addScaledVector(followerHeading, followerSpeed * delta)
      leader.x += leaderSpeed * delta
      minimumDistance = Math.min(minimumDistance, follower.distanceTo(leader))
    }
    expect(maximumTurn).toBeGreaterThan(0)
    expect(minimumDistance).toBeGreaterThanOrEqual(TEST_ENVELOPE.lateral * 2)
    expect(follower.x).toBeGreaterThan(leader.x)
    expect(steerSpecimenHeading(followerHeading, routeHeading,
      followerHeading.clone().multiplyScalar(followerSpeed), follower, 1, .2, TEST_ENVELOPE,
      new Map([[2, neighbor(leader.x, leader.z, leaderSpeed, 0)]]), 'reef_cruise', delta)).toBe(0)
  })
  it('turns a head-on pair reciprocally without moving position or reversing forward progress', () => {
    const left = new THREE.Vector3(-.2, .07, 0)
    const right = new THREE.Vector3(.2, .07, 0)
    const leftHeading = new THREE.Vector3(1, 0, 0)
    const rightHeading = new THREE.Vector3(-1, 0, 0)
    const leftTurn = steerSpecimenHeading(leftHeading, new THREE.Vector3(1, 0, 0), leftHeading.clone(), left, 1, .2,
      TEST_ENVELOPE, new Map([[2, neighbor(.2, 0, -1, 0)]]), 'reef_cruise', 1 / 60)
    steerSpecimenHeading(rightHeading, new THREE.Vector3(-1, 0, 0), rightHeading.clone(), right, 2, .2,
      TEST_ENVELOPE, new Map([[1, neighbor(-.2, 0, 1, 0)]]), 'reef_cruise', 1 / 60)
    expect(Math.sign(leftHeading.z)).toBe(-Math.sign(rightHeading.z))
    expect(leftTurn).toBeLessThanOrEqual(3.2 / 60 + Number.EPSILON)
    expect(leftHeading.x).toBeGreaterThan(0)
    expect(left).toEqual(new THREE.Vector3(-.2, .07, 0))
  })
  it.each(['pair', 'shoal'] as const)('lets compatible %s turn less than independent comfort and contact', (profile) => {
    const socialHeading = new THREE.Vector3(1, 0, 0)
    const independentHeading = new THREE.Vector3(1, 0, 0)
    const collisionHeading = new THREE.Vector3(1, 0, 0)
    const compatible = new Map([[2, neighbor(.7, .1, .8, -.6, profile)]])
    const socialTurn = steerSpecimenHeading(socialHeading, socialHeading.clone(), socialHeading.clone(), new THREE.Vector3(),
      1, .2, TEST_ENVELOPE, compatible, profile, 1, 100)
    const independentTurn = steerSpecimenHeading(independentHeading, independentHeading.clone(), independentHeading.clone(), new THREE.Vector3(),
      1, .2, TEST_ENVELOPE, compatible, 'reef_cruise', 1, 100)
    const collisionTurn = steerSpecimenHeading(collisionHeading, collisionHeading.clone(), collisionHeading.clone(), new THREE.Vector3(-.2, 0, 0),
      1, .2, TEST_ENVELOPE, new Map([[2, neighbor(.2, 0, -1, 0)]]), profile, 1, 100)
    expect(socialTurn).toBeLessThan(independentTurn)
    expect(independentTurn).toBeLessThan(collisionTurn)
  })
  it('uses crowd for territorial decisions without applying direct positional pressure', () => {
    const route = createSpecimenMotionRoute(7, 'mid', .86, .16)
    const target = new THREE.Vector3()
    const positions = new Map([[2, { ...neighbor(.2, 0, 1, 0, 'territorial_cruise'), position: new THREE.Vector3(.2, 10, 0) }]])
    const crowd = measureSpecimenCrowd(target, 1, .2, positions, 3)
    expect(target).toEqual(new THREE.Vector3())
    expect(decideSpecimenDirection(1, new THREE.Vector3(1, 0, 0), crowd, .5)).toBe(-1)
    expect(decideSpecimenDirection(1, new THREE.Vector3(1, 0, 0), { pressure: 0, awayX: 0, awayZ: 0 }, .5)).toBe(1)
    expect(specimenDirectionInterval(route, 1, crowd.pressure)).toBeLessThan(specimenDirectionInterval(route, 1, 0))
    expect(specimenReversalThreshold(crowd.pressure)).toBeGreaterThan(specimenReversalThreshold(0))
  })
  it('anticipates contact for elongated fish before narrow body radii overlap', () => {
    const envelope = specimenCollisionEnvelope(1, .1)
    const target = new THREE.Vector3(-.2, 0, 0)
    const heading = new THREE.Vector3(1, 0, 0)
    expect(.4).toBeGreaterThan(.1 + .1)
    expect(.4).toBeLessThan(envelope.longitudinal * 2)
    steerSpecimenHeading(heading, heading.clone(), heading.clone(), target, 1, .1, envelope,
      new Map([[2, { ...neighbor(.2, 0, -1, 0), ...envelope, verticalClearance: .1 }]]), 'reef_cruise', 1, 100)
    expect(heading.z).not.toBe(0)
    expect(target).toEqual(new THREE.Vector3(-.2, 0, 0))
  })
  it('covers both tank axes inside the glass and separates bottom and mid-water bands', () => {
    const bodyRadius = .16
    const routes = (['bottom', 'mid', 'top'] as const)
      .map((layer) => createSpecimenMotionRoute(7, layer, .86, bodyRadius))
    const sampled = routes.map((route) => Array.from({ length: 240 }, (_, index) =>
      sampleSpecimenMotionRoute(route, index / 240, bodyRadius, new THREE.Vector3())))
    for (const points of sampled) {
      expect(Math.min(...points.map(({ x }) => x))).toBeLessThan(-1.7)
      expect(Math.max(...points.map(({ x }) => x))).toBeGreaterThan(1.7)
      expect(Math.min(...points.map(({ z }) => z))).toBeLessThan(-.65)
      expect(Math.max(...points.map(({ z }) => z))).toBeGreaterThan(.65)
      expect(points.every(({ x, z }) => Math.abs(x) <= 2.76 - bodyRadius && Math.abs(z) <= 1.2 - bodyRadius)).toBe(true)
    }
    expect(Math.max(...sampled[0].map(({ y }) => y))).toBeLessThan(Math.min(...sampled[1].map(({ y }) => y)))
  })

  it.each([
    ['diamond_goby', 'bottom', .34],
    ['watchman_goby', 'bottom', .31],
    ['epaulette_shark', 'bottom', .72],
    ['royal_gramma', 'mid', .30],
    ['banggai_cardinal', 'mid', .36],
  ] as const)('%s keeps its whole body outside every rock without changing Y guidance',
  (speciesId, layer, length) => {
    const bodyRadius = THREE.MathUtils.clamp(length * .24, .05, .18)
    const halfSpan = length * .52
    const route = createSpecimenMotionRoute(37, layer, .86, bodyRadius)
    const profile = specimenBehaviorProfile(speciesId)
    const envelope = specimenCollisionEnvelope(length, bodyRadius)
    const delta = 1 / 60
    const speed = Math.max(.35, length * 1.8)

    for (const [rockIndex, rock] of REEF_ROCKS.entries()) {
      const guideY = THREE.MathUtils.clamp(rock.position.y, route.yBounds[0], route.yBounds[1])
      const radius = Math.max(rock.scale.x, rock.scale.z) * 1.2 + halfSpan + bodyRadius + .34
      let position = new THREE.Vector3()
      let bestClearance = -Infinity
      for (let spoke = 0; spoke < 24; spoke += 1) {
        const angle = spoke / 24 * Math.PI * 2
        const candidate = new THREE.Vector3(rock.position.x + Math.cos(angle) * radius, guideY,
          rock.position.z + Math.sin(angle) * radius)
        const clearance = minimumSpecimenHardscapeClearance(candidate,
          new THREE.Vector3(-Math.cos(angle), 0, -Math.sin(angle)), halfSpan, bodyRadius)
        if (clearance > bestClearance) { bestClearance = clearance; position = candidate }
      }
      expect(bestClearance, `${speciesId} rock ${rockIndex} start`).toBeGreaterThanOrEqual(1)
      const goal = rock.position.clone().multiplyScalar(2).sub(position).setY(guideY)
      const heading = goal.clone().sub(position).setY(0).normalize()
      const velocity = heading.clone().multiplyScalar(speed)

      for (let frame = 0; frame < 180; frame += 1) {
        const desired = goal.clone().sub(position).setY(0).normalize()
        guideSpecimenAroundHardscape(desired, heading, position,
          1000 + rockIndex, halfSpan, bodyRadius)
        const beforeHeading = heading.clone()
        steerSpecimenHeading(heading, desired, velocity, position, 1000 + rockIndex,
          bodyRadius, envelope, new Map(), profile, delta)
        constrainSpecimenHardscapeTurn(position, beforeHeading, heading, halfSpan, bodyRadius)
        const proposed = position.clone().addScaledVector(heading, speed * delta).setY(guideY)
        limitSpecimenFrameTravel(position, proposed, speed, delta)
        constrainSpecimenHardscapeTravel(position, proposed, heading, halfSpan, bodyRadius)
        expect(position.distanceTo(proposed), `${speciesId} rock ${rockIndex} frame ${frame} travel`)
          .toBeLessThanOrEqual(speed * delta + 1e-8)
        expect(beforeHeading.angleTo(heading), `${speciesId} rock ${rockIndex} frame ${frame} turn`)
          .toBeLessThanOrEqual(3.2 * delta + 1e-8)
        expect(proposed.y).toBe(guideY)
        expect(minimumSpecimenHardscapeClearance(proposed, heading, halfSpan, bodyRadius),
          `${speciesId} rock ${rockIndex} frame ${frame} clearance`).toBeGreaterThanOrEqual(1 - 1e-8)
        velocity.copy(proposed).sub(position).divideScalar(delta)
        position.copy(proposed)
      }
    }
  })
})
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
