import { describe, expect, it } from 'vitest'

import {
  advancePocketState,
  createPocketReefShowcase,
  dispatchPocketAction,
  pocketActions,
  projectPocketState,
} from './pocketAquariumBridge'

describe('integrated reef showcase mechanics', () => {
  it('fills the upgraded tank with reef-strength saltwater before livestock', () => {
    const state = createPocketReefShowcase()

    expect(state.tier).toBe('mid151')
    expect(state.water.levelL).toBeCloseTo(151, 6)
    expect(state.water.salinity).toBeCloseTo(35, 1)
    expect(projectPocketState(state).residents.length).toBeGreaterThan(0)
  })

  it('keeps showcase residents alive and salinity stable over two game days', () => {
    const initial = createPocketReefShowcase()
    const advanced = advancePocketState(initial, 192)

    expect(advanced.time.days - initial.time.days).toBeCloseTo(2, 6)
    expect(advanced.livestock.every((resident) => resident.alive !== false)).toBe(true)
    expect(advanced.water.levelL).toBeCloseTo(151, 6)
    expect(advanced.water.salinity).toBeCloseTo(35, 1)
  })

  it('projects the accepted marine catalog and moves only an explicit lock from tray to reef', () => {
    const state = createPocketReefShowcase()
    const view = projectPocketState(state)
    const animalOffers = view.storeOffers.filter((offer) => offer.kind === 'livestock')
    const coralOffers = view.storeOffers.filter((offer) => offer.kind === 'coral')

    expect(animalOffers).toHaveLength(25)
    expect(coralOffers).toHaveLength(22)
    expect(new Set(coralOffers.map((offer) => offer.id)).size).toBe(22)
    expect(coralOffers.every((offer) => typeof offer.action.variantId === 'string')).toBe(true)
    expect(view.coralInventory).toHaveLength(2)
    expect(view.placedCorals).toHaveLength(0)

    const coral = view.coralInventory[0]
    const next = dispatchPocketAction(state, { type: pocketActions.LOCK_CORAL_PLACEMENT,
      coralId: coral.id, placement: { version: 1, surface: 'sand', surfaceId: 'sand:base',
        position: [0, 0, 0], normal: [0, 1, 0], yaw: 0 } })
    const projected = projectPocketState(next)
    expect(projected.coralInventory).toHaveLength(1)
    expect(projected.placedCorals).toMatchObject([{ id: coral.id, speciesId: coral.speciesId,
      variantId: coral.variantId, speciesName: coral.speciesName,
      variantDisplayName: coral.variantDisplayName, health: expect.any(Number) }])
  })
})
