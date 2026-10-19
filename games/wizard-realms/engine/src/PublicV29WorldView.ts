import { PUBLIC_V29_MINERAL_BIDS } from './domain/publicWorldV29MineralSale'
import { PUBLIC_V29_ENCHANTED_PICK_MIN_LEVEL, PUBLIC_V29_PICK_PRICES } from './domain/publicWorldV29MiningTools'
import type { PublicV29PickTier } from './domain/publicWorldV29MiningTools'
import type { PublicV29Progress } from './domain/publicWorldV29Migration'
import type { WizardViewProjection } from './view/contracts'

/** V29-only read overlay. Virtual picks and mineral bids do not enter old listings or inventory. */
export function projectPublicV29WorldView(progress: PublicV29Progress,
  carrier: WizardViewProjection): WizardViewProjection {
  const { state, miningTools, terrain } = progress
  const { player } = state
  if (carrier.seed !== state.seed || carrier.player.position[0] !== player.position.x
    || carrier.player.position[2] !== player.position.z)
    throw new RangeError('The V29 view and checked carrier position must match.')
  const store = state.greenway.stores.find((entry) => entry.id === 'store-greenway')
  const atOutfitters = state.movementOwner === 'greenway' && !!store
    && Math.hypot(player.position.x - store.position.x,
      player.position.y - store.position.y,
      player.position.z - store.position.z) <= 3
  const excavationLevel = 1 + Math.floor(player.skillXp.excavation / 30)
  const offers = (['basic', 'enchanted'] as const).map((tier: PublicV29PickTier) => {
    const owned = tier === 'basic' ? miningTools.basicPickOwned : miningTools.enchantedPickOwned
    const price = PUBLIC_V29_PICK_PRICES[tier]
    const buyReason = owned ? 'Already owned.'
      : state.movementOwner !== 'greenway' ? 'Return to Greenway Outfitters.'
        : !atOutfitters ? 'Stand within 3 m of Greenway Outfitters.'
          : tier === 'enchanted' && excavationLevel < PUBLIC_V29_ENCHANTED_PICK_MIN_LEVEL
            ? `Requires Excavation level ${PUBLIC_V29_ENCHANTED_PICK_MIN_LEVEL}.`
            : player.coins < price ? `Needs ${price - player.coins} more coins.` : null
    return { tier, price, owned, buyReason }
  })
  return { ...carrier, v29Mining: { tools: miningTools, offers,
    bids: PUBLIC_V29_MINERAL_BIDS, bag: terrain.bag, excavationLevel, atOutfitters } }
}
