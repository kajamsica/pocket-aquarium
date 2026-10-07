import { describe, expect, it } from 'vitest'

import {
  createPocketReefShowcase,
  createStarterPocketState,
  dispatchPocketAction,
  projectPocketState,
} from './pocketAquariumBridge'
import { cameraDistanceForAspect, resolveReefLightRig } from '../scene/ReefScene'
import { opticalTankShape } from '../scene/OpticalTank'
import { cameraFitForEnvelope, resolveTankSceneEnvelope } from '../scene/tankSceneEnvelope'

describe('tank care guidance and resident inspection', () => {
  it('keeps dead residents visible until the keeper removes them', () => {
    const state = createPocketReefShowcase()
    const deceased = state.livestock[0]
    deceased.alive = false
    deceased.health = 0
    deceased.causeOfDeath = 'starvation'
    deceased.decayDays = 1.25
    state.selection = { entityType: 'livestock', id: deceased.id }

    const view = projectPocketState(state)
    expect(view.specimens.some((item) => item.id === deceased.id)).toBe(false)
    expect(view.residents.find((item) => item.id === deceased.id)).toMatchObject({
      alive: false,
      causeOfDeath: 'starvation',
      decayDays: 1.25,
    })
    expect(view.selectedSpecimen?.id).toBe(deceased.id)
    expect(view.objective.destination).toBe('care')
    expect(view.careRecommendations[0].title).toContain('Remove 1 dead resident')

    const cleaned = dispatchPocketAction(state, { type: 'REMOVE_DEAD', id: deceased.id })
    expect(projectPocketState(cleaned).residents.some((item) => item.id === deceased.id)).toBe(false)
  })

  it('connects evaporation symptoms to immediate top-off and the durable ATO upgrade', () => {
    const state = createPocketReefShowcase()
    state.equipment.ato = 'none'
    state.water.levelL = 60
    state.water.salinity = 38
    const tested = dispatchPocketAction(state, { type: 'WATER_TEST' })

    const recommendation = projectPocketState(tested).careRecommendations
      .find((item) => item.title.includes('Evaporation'))
    expect(recommendation?.action).toEqual({ type: 'WATER_TOP_OFF' })
    expect(recommendation?.suggestedOfferId).toBe('ato:ato')
  })

  it('does not mislabel the deliberate fishless ammonia dose as an emergency', () => {
    let state = createStarterPocketState()
    state = dispatchPocketAction(state, { type: 'CHOOSE_HABITAT', habitat: 'freshwater' })
    state = dispatchPocketAction(state, { type: 'SETUP_FILL' })
    state = dispatchPocketAction(state, { type: 'SETUP_LIFE_SUPPORT', on: true })
    state = dispatchPocketAction(state, { type: 'ADD_AMMONIA_SOURCE', on: true })
    state = dispatchPocketAction(state, { type: 'INOCULATE_BACTERIA' })
    state.water.ammonia = .8
    state = dispatchPocketAction(state, { type: 'WATER_TEST' })

    expect(state.water.ammonia).toBeGreaterThan(.25)
    const view = projectPocketState(state)
    expect(view.careRecommendations[0]).toMatchObject({ severity: 'watch',
      title: 'Fishless cycle is processing nitrogen' })
    expect(view.objective.title).toBe('Watch the nitrogen cycle')
    expect(view.testedWater.map(({ key }) => key)).toContain('hardness')
    expect(view.testedWater.map(({ key }) => key)).not.toContain('salinity')
  })

  it('frames toxic nitrogen as a cause, immediate action, and filtration upgrade', () => {
    const state = createPocketReefShowcase()
    state.water.ammonia = .62
    state.water.nitrite = .4
    state.equipment.filter = 'sponge'
    const tested = dispatchPocketAction(state, { type: 'WATER_TEST' })

    const view = projectPocketState(tested)
    const recommendation = view.careRecommendations.find((item) => item.title.includes('Toxic nitrogen'))
    expect(recommendation?.severity).toBe('urgent')
    expect(recommendation?.action).toEqual({ type: 'WATER_CHANGE', fraction: .25 })
    expect(recommendation?.suggestedOfferId).toBe('filter:hob')
    expect(view.objective.action).toEqual({ type: 'WATER_CHANGE', fraction: .25 })
  })
})

describe('tank framing', () => {
  const createEmptyReef = () => dispatchPocketAction(
    createStarterPocketState(),
    { type: 'CHOOSE_HABITAT', habitat: 'reef' },
  )

  it('moves back on tall screens and closer on wide screens before gesture zoom', () => {
    expect(cameraDistanceForAspect(9 / 19.5)).toBeGreaterThan(cameraDistanceForAspect(1))
    expect(cameraDistanceForAspect(19.5 / 9)).toBeLessThan(cameraDistanceForAspect(1))
  })

  it('keeps the starter scene unchanged and bounds massive rectangular growth', () => {
    const starter = projectPocketState(createEmptyReef()).reefSnapshot.tank
    const massiveState = createEmptyReef()
    massiveState.tier = 'monster3785'
    massiveState.water.levelL = 3785
    const massive = projectPocketState(massiveState).reefSnapshot.tank
    const starterEnvelope = resolveTankSceneEnvelope(starter)
    const massiveEnvelope = resolveTankSceneEnvelope(massive)

    expect(starterEnvelope.scale).toEqual([1, 1, 1])
    expect(massive).toMatchObject({ form: 'rectangular', nominalVolumeLiters: 3785 })
    expect(massive.widthMeters).toBeGreaterThan(massive.heightMeters)
    expect(massive.heightMeters).toBeGreaterThan(starter.heightMeters)
    expect(massiveEnvelope.width).toBeGreaterThan(starterEnvelope.width)
    expect(massiveEnvelope.scale[0]).toBeLessThanOrEqual(1.45)
    expect(cameraFitForEnvelope(massiveEnvelope, 16 / 9).distance)
      .toBeGreaterThan(cameraFitForEnvelope(starterEnvelope, 16 / 9).distance)
  })

  it('scales inverse-square light reach with 75 L and 3,785 L envelopes', () => {
    const starter = resolveTankSceneEnvelope(projectPocketState(createEmptyReef()).reefSnapshot.tank)
    const massiveState = createEmptyReef()
    massiveState.tier = 'monster3785'
    massiveState.water.levelL = 3785
    const massive = resolveTankSceneEnvelope(projectPocketState(massiveState).reefSnapshot.tank)
    const starterRig = resolveReefLightRig(starter, .8, 'reef', 'spectral', 1)
    const massiveRig = resolveReefLightRig(massive, .8, 'reef', 'spectral', 1)
    const scale = massiveRig.scale / starterRig.scale

    expect(massiveRig.keyPosition[1] / starterRig.keyPosition[1]).toBeCloseTo(scale, 10)
    expect(massiveRig.fillDistance / starterRig.fillDistance).toBeCloseTo(scale, 10)
    expect(massiveRig.keyIntensity / starterRig.keyIntensity).toBeCloseTo(scale * scale, 10)
    expect(massiveRig.keyIntensity / massiveRig.keyDistance ** 2)
      .toBeCloseTo(starterRig.keyIntensity / starterRig.keyDistance ** 2, 10)

    const established = resolveReefLightRig(starter, .8, 'reef', 'beauty', 1)
    const immature = resolveReefLightRig(starter, .8, 'reef', 'beauty', 0)
    const freshwater = resolveReefLightRig(starter, .8, 'freshwater', 'beauty', 1)
    expect(established.fillIntensity).toBeGreaterThan(immature.fillIntensity * 1.25)
    expect(established.hemisphereIntensity).toBeGreaterThan(immature.hemisphereIntensity)
    expect(freshwater).toMatchObject({ fillIntensity: immature.fillIntensity,
      hemisphereIntensity: immature.hemisphereIntensity })
  })

  it('projects the cylinder as a tall round-footprint envelope that fits phone and desktop', () => {
    const cylinderState = createEmptyReef()
    cylinderState.tier = 'cylinder5678'
    cylinderState.water.levelL = 5678
    const tank = projectPocketState(cylinderState).reefSnapshot.tank
    const envelope = resolveTankSceneEnvelope(tank)
    const desktop = cameraFitForEnvelope(envelope, 16 / 9)
    const phone = cameraFitForEnvelope(envelope, 9 / 19.5)

    expect(tank.form).toBe('cylinder')
    expect(opticalTankShape(tank.form)).toBe('cylinder')
    expect(opticalTankShape('rectangular')).toBe('box')
    expect(tank.widthMeters).toBeCloseTo(tank.depthMeters, 8)
    expect(tank.heightMeters).toBeGreaterThan(tank.widthMeters)
    expect(envelope.width).toBeCloseTo(envelope.depth, 8)
    expect(envelope.height).toBeCloseTo(envelope.width, 1)
    expect(phone.fov).toBeGreaterThan(desktop.fov)
    expect(phone.distance).toBeGreaterThan(desktop.distance)
    expect(phone.maxDistance).toBeGreaterThan(phone.distance)
  })
})
