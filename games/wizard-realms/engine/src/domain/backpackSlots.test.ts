import { describe, expect, it } from 'vitest'
import { backpackSlotsAfterAdd, backpackSlotsUsed, LOGS_PER_BACKPACK_SLOT } from './backpackSlots'

describe('backpack item spaces', () => {
  it('uses one wood space through 20 logs and another at 21', () => {
    expect(LOGS_PER_BACKPACK_SLOT).toBe(20)
    for (const quantity of [8, 20]) {
      expect(backpackSlotsUsed([{ itemId: 'logs', quantity }])).toBe(1)
    }
    expect(backpackSlotsUsed([{ itemId: 'logs', quantity: 21 }])).toBe(2)
    expect(backpackSlotsAfterAdd([{ itemId: 'logs', quantity: 18 }], [], 'logs', 2)).toBe(1)
    expect(backpackSlotsAfterAdd([{ itemId: 'logs', quantity: 18 }], [], 'logs', 3)).toBe(2)
  })

  it('combines carried log rows but keeps every escrow listing separate', () => {
    const inventory = [{ itemId: 'woodcutters_axe', quantity: 1 },
      { itemId: 'logs', quantity: 8 }, { itemId: 'logs', quantity: 12 }]
    expect(backpackSlotsUsed(inventory)).toBe(2)
    expect(backpackSlotsUsed(inventory, [{ itemId: 'logs', quantity: 1 }])).toBe(3)
    expect(backpackSlotsUsed(inventory, [
      { itemId: 'logs', quantity: 1 }, { itemId: 'logs', quantity: 21 },
    ])).toBe(5)
  })

  it('keeps other items and terrain-bag materials one per space', () => {
    expect(backpackSlotsUsed([
      { itemId: 'stone', quantity: 3 }, { itemId: 'logs', quantity: 8 },
    ], [{ itemId: 'marsh_herb', quantity: 2 }], 4)).toBe(10)
  })
})
