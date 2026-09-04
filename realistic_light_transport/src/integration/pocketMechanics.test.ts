import { describe, expect, it } from 'vitest'

import {
  advancePocketState,
  createPocketReefShowcase,
  dispatchPocketAction,
  pocketActions,
  pocketShowcasePopulationAuthority,
  projectPocketState,
} from './pocketAquariumBridge'
import { specimenAssetFor } from '../scene/specimens/assetRegistry'

describe('integrated reef showcase mechanics', () => {
  it('fills the upgraded tank with reef-strength saltwater before livestock', () => {
    const state = createPocketReefShowcase()

    expect(state.tier).toBe('xl757')
    expect(state.water.levelL).toBeCloseTo(757, 6)
    expect(state.water.salinity).toBeCloseTo(35, 1)
    expect(projectPocketState(state).residents.length).toBeGreaterThan(0)
  })

  it('keeps showcase residents alive and salinity stable over two game days', () => {
    const initial = createPocketReefShowcase()
    const advanced = advancePocketState(initial, 192)

    expect(advanced.time.days - initial.time.days).toBeCloseTo(2, 6)
    expect(advanced.livestock.every((resident) => resident.alive !== false)).toBe(true)
    expect(advanced.water.levelL).toBeCloseTo(757, 6)
    expect(advanced.water.salinity).toBeCloseTo(35, 1)
  })

  it('projects accepted showcase defaults from root state with ordinary interactions available', () => {
    const state = createPocketReefShowcase()
    const view = projectPocketState(state)
    const animalOffers = view.storeOffers.filter((offer) => offer.kind === 'livestock')
    const coralOffers = view.storeOffers.filter((offer) => offer.kind === 'coral')

    expect(pocketShowcasePopulationAuthority).toBe('root_pa')
    expect(view.authority).toBe(pocketShowcasePopulationAuthority)
    expect(state.livestock).toHaveLength(25)
    expect(view.specimens).toHaveLength(25)
    expect(view.specimens.map((animal) => animal.id)).toEqual(state.livestock.map((animal) => animal.id))
    expect(new Set(view.specimens.map((animal) => animal.speciesId))).toHaveProperty('size', 25)
    expect(view.specimens.every((animal) => animal.stage === 'adult' && animal.health === 1
      && animal.condition === 1 && animal.hunger <= .15 && animal.runtimeProfile.id === animal.speciesId)).toBe(true)
    expect(view.specimens.every((animal) => animal.x >= 0 && animal.x <= 1 && animal.y >= 0 && animal.y <= 1)).toBe(true)
    expect(createPocketReefShowcase().livestock.map((animal) => animal.id)).toEqual(state.livestock.map((animal) => animal.id))
    expect(animalOffers).toHaveLength(25)
    expect(coralOffers).toHaveLength(22)
    expect(new Set(coralOffers.map((offer) => offer.id)).size).toBe(22)
    expect(coralOffers.every((offer) => typeof offer.action.variantId === 'string')).toBe(true)
    expect(view.coralInventory).toHaveLength(8)
    expect(view.coralInventory.every((coral) => specimenAssetFor(coral.speciesId)?.variantId === coral.variantId)).toBe(true)
    expect(view.placedCorals).toHaveLength(0)

    const selected = dispatchPocketAction(state, { type: pocketActions.SELECT_ENTITY,
      entityType: 'livestock', id: view.specimens[0].id })
    expect(projectPocketState(selected).selection).toMatchObject({ entityType: 'livestock', id: view.specimens[0].id })
    expect(projectPocketState(selected).selectedSpecimen?.id).toBe(view.specimens[0].id)
    const fed = dispatchPocketAction(selected, { type: pocketActions.FEED, x: .5, y: .2 })
    expect(projectPocketState(fed).food).toHaveLength(1)
    const storeUpgrade = view.storeOffers.find((offer) => offer.id === 'circulation:gyre')
    expect(storeUpgrade).toMatchObject({ allowed: true, action: { type: pocketActions.PURCHASE_EQUIPMENT } })
    expect(dispatchPocketAction(state, storeUpgrade!.action).equipment.circulation).toBe('gyre')
    const purchasableCoral = coralOffers.find((offer) => offer.allowed)
    expect(purchasableCoral).toBeDefined()
    expect(projectPocketState(dispatchPocketAction(state, purchasableCoral!.action)).coralInventory).toHaveLength(9)

    const coral = view.coralInventory[0]
    const next = dispatchPocketAction(state, { type: pocketActions.LOCK_CORAL_PLACEMENT,
      coralId: coral.id, placement: { version: 1, surface: 'sand', surfaceId: 'sand:base',
        position: [0, 0, 0], normal: [0, 1, 0], yaw: 0 } })
    const projected = projectPocketState(next)
    expect(projected.coralInventory).toHaveLength(7)
    expect(projected.placedCorals).toMatchObject([{ id: coral.id, speciesId: coral.speciesId,
      variantId: coral.variantId, speciesName: coral.speciesName,
      variantDisplayName: coral.variantDisplayName, health: expect.any(Number) }])
  })
})
