import { describe, expect, it } from 'vitest'

import {
  createPocketReefShowcase,
  createStarterPocketState,
  dispatchPocketAction,
  projectPocketState,
} from './pocketAquariumBridge'
import { cameraDistanceForAspect } from '../scene/ReefScene'

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
    expect(view.objective.destination).toBe('journal')
    expect(view.careRecommendations[0].title).toContain('Remove 1 dead resident')

    const cleaned = dispatchPocketAction(state, { type: 'REMOVE_DEAD', id: deceased.id })
    expect(projectPocketState(cleaned).residents.some((item) => item.id === deceased.id)).toBe(false)
  })

  it('connects evaporation symptoms to immediate top-off and the durable ATO upgrade', () => {
    const state = createPocketReefShowcase()
    state.equipment.ato = 'none'
    state.water.levelL = 60
    state.water.salinity = 38

    const recommendation = projectPocketState(state).careRecommendations
      .find((item) => item.title.includes('Evaporation'))
    expect(recommendation?.action).toEqual({ type: 'WATER_TOP_OFF' })
    expect(recommendation?.suggestedOfferId).toBe('ato:ato')
  })

  it('does not mislabel the deliberate fishless ammonia dose as an emergency', () => {
    let state = createStarterPocketState()
    state = dispatchPocketAction(state, { type: 'SETUP_FILL' })
    state = dispatchPocketAction(state, { type: 'SETUP_LIFE_SUPPORT', on: true })
    state = dispatchPocketAction(state, { type: 'ADD_AMMONIA_SOURCE', on: true })
    state = dispatchPocketAction(state, { type: 'INOCULATE_BACTERIA' })
    state.water.ammonia = .8

    expect(state.water.ammonia).toBeGreaterThan(.25)
    expect(projectPocketState(state).careRecommendations).toEqual([])
    expect(projectPocketState(state).objective.title).toBe('Watch the nitrogen cycle')
  })

  it('frames toxic nitrogen as a cause, immediate action, and filtration upgrade', () => {
    const state = createPocketReefShowcase()
    state.water.ammonia = .62
    state.water.nitrite = .4
    state.equipment.filter = 'sponge'

    const view = projectPocketState(state)
    const recommendation = view.careRecommendations.find((item) => item.title.includes('Toxic nitrogen'))
    expect(recommendation?.severity).toBe('urgent')
    expect(recommendation?.action).toEqual({ type: 'WATER_CHANGE', fraction: .25 })
    expect(recommendation?.suggestedOfferId).toBe('filter:hob')
    expect(view.objective.action).toEqual({ type: 'WATER_CHANGE', fraction: .25 })
  })
})

describe('tank framing', () => {
  it('moves back on tall screens and closer on wide screens before gesture zoom', () => {
    expect(cameraDistanceForAspect(9 / 19.5)).toBeGreaterThan(cameraDistanceForAspect(1))
    expect(cameraDistanceForAspect(19.5 / 9)).toBeLessThan(cameraDistanceForAspect(1))
  })
})
