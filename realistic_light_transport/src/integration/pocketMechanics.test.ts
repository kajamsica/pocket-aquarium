import { describe, expect, it } from 'vitest'

import {
  advancePocketState,
  createPocketReefShowcase,
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
})
