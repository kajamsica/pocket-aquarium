import { describe, expect, it } from 'vitest'

import {
  createStarterPocketState,
  dispatchPocketAction,
  loadSavedPocketState,
  projectPocketState,
  savePocketState,
  type PocketState,
} from './pocketAquariumBridge'
import { createPocketGameController } from './pocketGameController'
import {
  FOOD_BOTTOM,
  normalizedXToSurfaceX,
  pelletDepthY,
  surfaceXToNormalizedX,
} from '../scene/feeding'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => { map.delete(key) },
    setItem: (key, value) => { map.set(key, String(value)) },
  }
}

const firstClownId = (state: PocketState) =>
  state.livestock.find((animal) => animal.species === 'ocellaris' && animal.alive !== false)!.id
const hungerOf = (state: PocketState, id: number) =>
  state.livestock.find((animal) => animal.id === id)!.hunger

describe('starter tank', () => {
  it('opens into a cycled reef stocked with a feedable clownfish pair', () => {
    const view = projectPocketState(createStarterPocketState())
    expect(view.cycled).toBe(true)
    expect(view.specimens.filter((s) => s.speciesId === 'ocellaris').length).toBeGreaterThanOrEqual(2)
    expect(view.food).toHaveLength(0)
  })
})

describe('feed dispatch and projection', () => {
  it('drops exactly one pellet at the tapped horizontal position without feeding any fish', () => {
    const state = createStarterPocketState()
    const clownId = firstClownId(state)
    const hungerBefore = hungerOf(state, clownId)
    const lastFedBefore = state.livestock.find((a) => a.id === clownId)!.lastFedDay

    const fed = dispatchPocketAction(state, { type: 'FEED', x: 0.72 })
    const view = projectPocketState(fed)

    expect(view.food).toHaveLength(1)
    expect(view.food[0].x).toBeCloseTo(0.72, 5)
    expect(view.food[0].sunk).toBe(false)
    // Hunger and lastFedDay must not improve before contact.
    expect(hungerOf(fed, clownId)).toBe(hungerBefore)
    expect(fed.livestock.find((a) => a.id === clownId)!.lastFedDay).toBe(lastFedBefore)
  })
})

describe('pointer/water projection math', () => {
  it('round-trips a surface hit to normalized x and back', () => {
    expect(surfaceXToNormalizedX(0)).toBeCloseTo(0.5, 6)
    for (const nx of [0, 0.25, 0.5, 0.75, 1]) {
      expect(surfaceXToNormalizedX(normalizedXToSurfaceX(nx))).toBeCloseTo(nx, 6)
    }
    // Off-tank taps clamp into the interior.
    expect(surfaceXToNormalizedX(999)).toBe(1)
    expect(surfaceXToNormalizedX(-999)).toBe(0)
  })

  it('maps normalized depth from the waterline down to the substrate', () => {
    expect(pelletDepthY(0, 2, -1)).toBeCloseTo(2, 6)
    expect(pelletDepthY(FOOD_BOTTOM, 2, -1)).toBeCloseTo(-1, 6)
    expect(pelletDepthY(FOOD_BOTTOM / 2, 2, -1)).toBeCloseTo(0.5, 6)
  })
})

describe('mouth-contact consumption', () => {
  it('feeds exactly the contacting fish once and removes the pellet', () => {
    const fed = dispatchPocketAction(createStarterPocketState(), { type: 'FEED', x: 0.5 })
    const pelletId = projectPocketState(fed).food[0].id
    const eaterId = firstClownId(fed)
    const hungerBefore = hungerOf(fed, eaterId)

    const after = dispatchPocketAction(fed, { type: 'CONSUME_FOOD', foodId: pelletId, eaterId })
    const view = projectPocketState(after)

    expect(view.food).toHaveLength(0)
    expect(hungerOf(after, eaterId)).toBeLessThan(hungerBefore)
    expect(after.livestock.find((a) => a.id === eaterId)!.lastFedDay).toBeGreaterThanOrEqual(
      fed.livestock.find((a) => a.id === eaterId)!.lastFedDay,
    )
  })

  it('rejects a duplicate contact — a second fish cannot re-consume the same pellet', () => {
    const fed = dispatchPocketAction(createStarterPocketState(), { type: 'FEED', x: 0.5 })
    const pelletId = projectPocketState(fed).food[0].id
    const clowns = fed.livestock.filter((a) => a.species === 'ocellaris' && a.alive !== false)
    const firstEater = clowns[0].id
    const secondEater = clowns[1].id

    const once = dispatchPocketAction(fed, { type: 'CONSUME_FOOD', foodId: pelletId, eaterId: firstEater })
    const secondHungerBefore = hungerOf(once, secondEater)

    const twice = dispatchPocketAction(once, { type: 'CONSUME_FOOD', foodId: pelletId, eaterId: secondEater })

    expect(projectPocketState(twice).food).toHaveLength(0)
    expect(hungerOf(twice, secondEater)).toBe(secondHungerBefore)
  })
})

describe('persistence / controller', () => {
  it('saves and reloads the same authoritative tank, preserving a feeding result', () => {
    const storage = memoryStorage()
    let clock = 1_000_000
    const wallClockNow = () => clock
    const monotonicNow = () => clock

    const controller = createPocketGameController({ storage, wallClockNow, monotonicNow })
    const eaterId = firstClownId(controller.getState())
    const hungerBefore = hungerOf(controller.getState(), eaterId)

    controller.dispatch({ type: 'FEED', x: 0.4 })
    const pelletId = projectPocketState(controller.getState()).food[0].id
    controller.dispatch({ type: 'CONSUME_FOOD', foodId: pelletId, eaterId })
    const hungerAfterFeed = hungerOf(controller.getState(), eaterId)
    expect(hungerAfterFeed).toBeLessThan(hungerBefore)

    // A fresh controller over the same storage rehydrates the identical tank.
    clock += 500 // < 1s so no offline catch-up perturbs the comparison
    const reloaded = createPocketGameController({ storage, wallClockNow, monotonicNow })
    const state = reloaded.getState()
    expect(state.livestock.length).toBe(controller.getState().livestock.length)
    expect(hungerOf(state, eaterId)).toBeCloseTo(hungerAfterFeed, 6)
  })

  it('falls back to a fresh starter when no save exists and persists it', () => {
    const storage = memoryStorage()
    const controller = createPocketGameController({ storage, wallClockNow: () => 5_000, monotonicNow: () => 0 })
    expect(controller.getState().livestock.length).toBeGreaterThanOrEqual(2)

    const saved = loadSavedPocketState(5_000, storage)
    expect(saved).not.toBeNull()
    expect(saved!.livestock.length).toBe(controller.getState().livestock.length)

    // Round-trips through the shared save helpers too.
    savePocketState(saved!, 6_000, storage)
    expect(loadSavedPocketState(6_000, storage)!.habitat).toBe('reef')
  })
})
