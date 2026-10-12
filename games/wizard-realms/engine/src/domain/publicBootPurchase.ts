import { PUBLIC_V11_BOOTS_LISTING_ID, PUBLIC_V11_BOOTS_PRICE } from './publicWorldGait'
import type { PublicWorldEvent } from './publicWorldRuntime'
import type { PublicWorldV11State } from './publicWorldV11State'

type BootWorld = Pick<PublicWorldV11State,
  'movementOwner' | 'greenway' | 'player' | 'eventSequence' | 'tick'>
type BootPurchase = { player: BootWorld['player']; eventSequence: number;
  event: Extract<PublicWorldEvent, { type: 'store_item_bought' }> }

/** Shared purchase rule only. Each version validates its own state before and after applying it. */
export function publicBootPurchaseCandidate(state: BootWorld, storeId: string):
  BootPurchase | { rejection: string } {
  const store = state.greenway.stores.find((candidate) => candidate.id === 'store-greenway')
  if (storeId !== 'store-greenway' || state.movementOwner !== 'greenway' || !store) {
    return { rejection: 'Leather boots are sold only at Greenway Outfitters.' }
  }
  if (Math.hypot(state.player.position.x - store.position.x,
    state.player.position.y - store.position.y,
    state.player.position.z - store.position.z) > 3) {
    return { rejection: 'Move closer to Greenway Outfitters.' }
  }
  if (state.player.inventory.some((stack) => stack.itemId === 'leather_boots')
    || state.player.tradeSlots.some((slot) => slot.itemId === 'leather_boots')) {
    return { rejection: 'You already own leather boots.' }
  }
  if (state.player.coins < PUBLIC_V11_BOOTS_PRICE) return { rejection: 'Not enough coins for leather boots.' }
  const used = state.player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
    + state.player.tradeSlots.reduce((sum, slot) => sum + slot.quantity, 0)
  if (used >= state.player.backpackCapacity) return { rejection: 'The backpack is full.' }
  if (!Number.isSafeInteger(state.eventSequence + 1)) return { rejection: 'The event sequence is exhausted.' }
  const eventSequence = state.eventSequence + 1
  return { player: { ...state.player, coins: state.player.coins - PUBLIC_V11_BOOTS_PRICE,
    inventory: [...state.player.inventory, { itemId: 'leather_boots', quantity: 1 }] },
  eventSequence, event: { type: 'store_item_bought', tick: state.tick,
    sequence: eventSequence, storeId, listingId: PUBLIC_V11_BOOTS_LISTING_ID,
    itemId: 'leather_boots', price: PUBLIC_V11_BOOTS_PRICE } }
}
