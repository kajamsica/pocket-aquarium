import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV29ActionProgress } from './publicWorldV29MiningTools'
import type { PublicV29Progress } from './publicWorldV29Migration'

export const PUBLIC_V29_MINERAL_BIDS = {
  soil: 1, stone: 3, iron_ore: 8, gold_ore: 15, diamond: 60,
} as const
export type PublicV29Mineral = keyof typeof PUBLIC_V29_MINERAL_BIDS
export type PublicV29MineralSale = Readonly<{
  kind: 'sell-mineral/v1'; material: PublicV29Mineral; quantity: number
}>
export type PublicV29MineralSaleRejection = 'invalid_action' | 'invalid_progress'
  | 'unavailable_here' | 'too_far' | 'not_owned' | 'invalid_value'
export type PublicV29MineralSaleEvent = Readonly<{
  type: 'mineral_sold'; material: PublicV29Mineral; quantity: number;
  unitPrice: number; totalPrice: number; tick: number; sequence: number
}>
export type PublicV29MineralSaleResult = Readonly<{
  progress: PublicV29Progress; event: PublicV29MineralSaleEvent; rejection?: never
}> | Readonly<{ progress?: never; event?: never; rejection: PublicV29MineralSaleRejection }>

/** The witness carries no price or store location; both are checked from the world. */
export function decodePublicV29MineralSale(value: unknown): PublicV29MineralSale | null {
  try {
    if (!exactPublicV23(value, ['kind', 'material', 'quantity'])
      || value.kind !== 'sell-mineral/v1'
      || typeof value.material !== 'string'
      || !Object.hasOwn(PUBLIC_V29_MINERAL_BIDS, value.material)
      || !Number.isSafeInteger(value.quantity)
      || (value.quantity as number) < 1 || (value.quantity as number) > 256) return null
    structuredClone(value)
    return { kind: 'sell-mineral/v1', material: value.material as PublicV29Mineral,
      quantity: value.quantity as number }
  } catch { return null }
}

/** V29-only cash-out of mined bag material at canonical Greenway Outfitters. */
export function applyPublicV29MineralSale(rawProgress: PublicV29Progress,
  rawAction: unknown): PublicV29MineralSaleResult {
  const action = decodePublicV29MineralSale(rawAction)
  if (!action) return { rejection: 'invalid_action' }
  const progress = decodePublicV29ActionProgress(rawProgress)
  if (!progress) return { rejection: 'invalid_progress' }
  const { state, terrain } = progress
  if (state.movementOwner !== 'greenway') return { rejection: 'unavailable_here' }
  // The V23 progress decoder above authenticates this store against seed generation.
  const store = state.greenway.stores.find((entry) => entry.id === 'store-greenway')
  if (!store) return { rejection: 'unavailable_here' }
  const { player } = state
  if (Math.hypot(player.position.x - store.position.x,
    player.position.y - store.position.y,
    player.position.z - store.position.z) > 3) return { rejection: 'too_far' }
  if (terrain.bag[action.material] < action.quantity) return { rejection: 'not_owned' }
  const unitPrice = PUBLIC_V29_MINERAL_BIDS[action.material]
  const totalPrice = unitPrice * action.quantity
  const coins = player.coins + totalPrice, sequence = state.eventSequence + 1
  if (![totalPrice, coins, sequence].every(Number.isSafeInteger))
    return { rejection: 'invalid_value' }
  const next: PublicV29Progress = { ...progress,
    terrain: { ...terrain, bag: { ...terrain.bag,
      [action.material]: terrain.bag[action.material] - action.quantity } },
    state: { ...state, eventSequence: sequence,
      player: { ...player, coins } } }
  const checked = decodePublicV29ActionProgress(next)
  return checked ? { progress: checked, event: { type: 'mineral_sold',
    material: action.material, quantity: action.quantity, unitPrice, totalPrice,
    tick: state.tick, sequence } } : { rejection: 'invalid_value' }
}
