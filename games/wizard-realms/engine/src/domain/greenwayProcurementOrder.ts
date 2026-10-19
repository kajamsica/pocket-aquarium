import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV42RewardProgress, PUBLIC_V42_PROGRESS_KEYS } from './publicWorldV42RewardAction'
import type { PublicV42RewardProgress } from './publicWorldV42RewardAction'

/** An authored NPC request, not a repeatable player-market bid. */
export const GREENWAY_LOG_ORDER = Object.freeze({
  id: 'greenway-carpenter-logs/v1',
  destinationStoreId: 'store-greenway',
  itemId: 'logs',
  quantity: 4,
  payCoins: 10,
  routeUses: Object.freeze([
    'Keep 4 logs for a north-cliff ladder.',
    'Keep 8 logs for the creek bridge.',
    'Keep route timber first; gather more logs from other trees.',
  ]),
} as const)

export type GreenwayProcurementState = Readonly<{ claimedAtSequence: number | null }>
export type GreenwayProcurementProgress = PublicV42RewardProgress & Readonly<{
  greenwayOrder: GreenwayProcurementState
}>
export type GreenwayProcurementWitness = Readonly<{
  kind: 'fulfill-greenway-logs/v1'
}>
export type GreenwayProcurementRejection = 'invalid_action' | 'invalid_progress'
  | 'already_fulfilled' | 'unavailable_here' | 'too_far' | 'not_owned'
  | 'arbitrage' | 'invalid_value'
export type GreenwayProcurementEvent = Readonly<{
  type: 'npc_order_fulfilled'; orderId: typeof GREENWAY_LOG_ORDER.id
  itemId: typeof GREENWAY_LOG_ORDER.itemId; quantity: number; payCoins: number
  storeId: typeof GREENWAY_LOG_ORDER.destinationStoreId
  tick: number; sequence: number
}>
export type GreenwayProcurementResult = Readonly<{
  progress: GreenwayProcurementProgress; event: GreenwayProcurementEvent
  rejection?: never
}> | Readonly<{
  progress?: never; event?: never; rejection: GreenwayProcurementRejection
}>

const progressKeys = [...PUBLIC_V42_PROGRESS_KEYS, 'greenwayOrder'] as const
const safeCounter = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** This overlay must be persisted and replayed by a later versioned save owner. */
export function decodeGreenwayProcurementProgress(raw: unknown): GreenwayProcurementProgress | null {
  try {
    if (!exactPublicV23(raw, progressKeys)
      || !exactPublicV23(raw.greenwayOrder, ['claimedAtSequence'])) return null
    const source = decodePublicV42RewardProgress(Object.fromEntries(
      PUBLIC_V42_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    if (!source) return null
    const claimed = raw.greenwayOrder.claimedAtSequence
    if (claimed !== null && (!safeCounter(claimed) || claimed < 1
      || claimed > source.state.eventSequence)) return null
    return { ...source, greenwayOrder: { claimedAtSequence: claimed as number | null } }
  } catch { return null }
}

/** A client cannot choose the quantity, destination, price, or reward. */
export function decodeGreenwayProcurementWitness(raw: unknown): GreenwayProcurementWitness | null {
  try {
    if (!exactPublicV23(raw, ['kind']) || raw.kind !== 'fulfill-greenway-logs/v1') return null
    structuredClone(raw)
    return { kind: 'fulfill-greenway-logs/v1' }
  } catch { return null }
}

/** A finite premium cannot be funded by buying the same material at a reachable shop. */
export function greenwayOrderWouldArbitrage(buyUnitPrices: readonly number[]): boolean {
  return buyUnitPrices.some((price) => !Number.isSafeInteger(price) || price < 0
    || price * GREENWAY_LOG_ORDER.quantity < GREENWAY_LOG_ORDER.payCoins)
}

/** Pure, atomic fulfillment for the future checked economy writer. */
export function fulfillGreenwayProcurementOrder(rawProgress: unknown,
  rawWitness: unknown): GreenwayProcurementResult {
  if (!decodeGreenwayProcurementWitness(rawWitness)) return { rejection: 'invalid_action' }
  const progress = decodeGreenwayProcurementProgress(rawProgress)
  if (!progress) return { rejection: 'invalid_progress' }
  if (progress.greenwayOrder.claimedAtSequence !== null)
    return { rejection: 'already_fulfilled' }
  const { state } = progress
  if (state.movementOwner !== 'greenway') return { rejection: 'unavailable_here' }
  const store = state.greenway.stores.find((entry) =>
    entry.id === GREENWAY_LOG_ORDER.destinationStoreId)
  if (!store) return { rejection: 'unavailable_here' }
  const distance = Math.hypot(state.player.position.x - store.position.x,
    state.player.position.y - store.position.y,
    state.player.position.z - store.position.z)
  if (distance > 3) return { rejection: 'too_far' }
  const boughtLogPrices = state.greenway.stores.flatMap((entry) =>
    entry.listings.filter((listing) => listing.itemId === 'logs' && listing.stock > 0)
      .map((listing) => listing.price))
  if (greenwayOrderWouldArbitrage(boughtLogPrices)) return { rejection: 'arbitrage' }
  const owned = state.player.inventory.filter((stack) => stack.itemId === 'logs')
    .reduce((sum, stack) => sum + stack.quantity, 0)
  if (owned < GREENWAY_LOG_ORDER.quantity) return { rejection: 'not_owned' }
  const coins = state.player.coins + GREENWAY_LOG_ORDER.payCoins
  const sequence = state.eventSequence + 1
  if (![coins, sequence].every(safeCounter)) return { rejection: 'invalid_value' }
  let remaining: number = GREENWAY_LOG_ORDER.quantity
  const inventory = state.player.inventory.map((stack) => {
    if (stack.itemId !== 'logs' || remaining === 0) return stack
    const spent = Math.min(stack.quantity, remaining)
    remaining -= spent
    return { ...stack, quantity: stack.quantity - spent }
  }).filter((stack) => stack.quantity > 0)
  if (remaining !== 0) return { rejection: 'invalid_progress' }
  const next: GreenwayProcurementProgress = { ...progress,
    greenwayOrder: { claimedAtSequence: sequence },
    state: { ...state, eventSequence: sequence,
      player: { ...state.player, inventory, coins } } }
  const checked = decodeGreenwayProcurementProgress(next)
  if (!checked) return { rejection: 'invalid_value' }
  return { progress: checked, event: { type: 'npc_order_fulfilled',
    orderId: GREENWAY_LOG_ORDER.id, itemId: GREENWAY_LOG_ORDER.itemId,
    quantity: GREENWAY_LOG_ORDER.quantity, payCoins: GREENWAY_LOG_ORDER.payCoins,
    storeId: GREENWAY_LOG_ORDER.destinationStoreId,
    tick: state.tick, sequence } }
}
