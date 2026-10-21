export const LOGS_PER_BACKPACK_SLOT = 20

export type BackpackSlotRow = Readonly<{ itemId: string | null; quantity: number }>

/** Carried logs share spaces; each escrow listing reserves its own spaces. */
export function backpackSlotsUsed(
  inventory: readonly BackpackSlotRow[],
  tradeSlots: readonly BackpackSlotRow[] = [],
  terrainUnits = 0,
): number {
  let logs = 0
  let spaces = terrainUnits
  for (const stack of inventory) {
    if (stack.itemId === 'logs') logs += stack.quantity
    else spaces += stack.quantity
  }
  spaces += Math.ceil(logs / LOGS_PER_BACKPACK_SLOT)
  for (const slot of tradeSlots) {
    if (slot.itemId === 'logs') spaces += Math.ceil(slot.quantity / LOGS_PER_BACKPACK_SLOT)
    else spaces += slot.quantity
  }
  return spaces
}

export function backpackSlotsAfterAdd(
  inventory: readonly BackpackSlotRow[],
  tradeSlots: readonly BackpackSlotRow[],
  itemId: string,
  quantity: number,
  terrainUnits = 0,
): number {
  return backpackSlotsUsed([...inventory, { itemId, quantity }], tradeSlots, terrainUnits)
}
