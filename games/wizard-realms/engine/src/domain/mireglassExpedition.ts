import { createGeneratedWorld } from './generation'
import { mireglassAnchors, mireglassResources, MIREGLASS_CONTENT_REVISION } from './mireglassContent'
import { mireglassRouteSites } from './mireglassRouteSites'
import type { MireglassRouteSite } from './mireglassRouteSites'
import type { EquipmentSlot, ItemId, PlayerState, Vec3 } from './types'

export type MireglassNewItemId = 'mireglass_reach/item/seal' | 'mireglass_reach/item/waders'
export type MireglassItemId = ItemId | MireglassNewItemId
export type MireglassShopItemId = 'field_spade' | 'mireglass_reach/item/waders'
export type MireglassSaleItemId = 'logs' | 'mireglass_reach/item/seal'
export type MireglassEquippableItemId = 'woodcutters_axe' | 'field_spade' | 'mireglass_reach/item/waders'
export type MireglassRouteKind = MireglassRouteSite['kind']
export type MireglassTradeSlot = Omit<PlayerState['tradeSlots'][number], 'itemId'> & { itemId: MireglassItemId | null }
/** Every v5 player fact remains present. Only the item union widens for the new region. */
export type MireglassV6Player = Omit<PlayerState, 'inventory' | 'equipment' | 'tradeSlots'> & {
  inventory: Array<{ itemId: MireglassItemId; quantity: number }>
  equipment: Record<EquipmentSlot, MireglassItemId | null>
  tradeSlots: [MireglassTradeSlot, MireglassTradeSlot, MireglassTradeSlot, MireglassTradeSlot]
}

export const MIREGLASS_OUTPOST_CATALOG = {
  field_spade: { price: 18, stock: 3 },
  'mireglass_reach/item/waders': { price: 150, stock: 2 },
} as const
export const MIREGLASS_OUTPOST_SELL_PRICES: Readonly<Record<MireglassSaleItemId, number>> = {
  logs: 2, 'mireglass_reach/item/seal': 80,
}

const LEGACY_ITEMS: readonly ItemId[] = [
  'woodcutters_axe', 'logs', 'marsh_herb', 'stone', 'iron_ore', 'apprentice_hat',
  'traveler_tunic', 'trail_leggings', 'leather_boots', 'oak_wand', 'wooden_shield',
  'field_spade', 'ancient_relic',
]
const ITEM_IDS: readonly MireglassItemId[] = [...LEGACY_ITEMS, 'mireglass_reach/item/seal', 'mireglass_reach/item/waders']
const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ['head', 'chest', 'legs', 'feet', 'mainHand', 'offHand']
const SKILL_IDS = ['woodcutting', 'construction', 'wayfinding', 'spellcraft', 'excavation'] as const
const REACH_METERS = 3
const GLOW_METERS = 8
const WOODCUTTING_XP = 20
const CONSTRUCTION_XP: Record<MireglassRouteKind, number> = { bridge: 80, ladder: 60 }
const EXCAVATION_XP = 40
const GLOW_XP = 10

export interface MireglassExpeditionProgress {
  readonly contentRevision: typeof MIREGLASS_CONTENT_REVISION
  readonly seed: string
  readonly player: MireglassV6Player
  readonly depletedResourceIds: readonly string[]
  readonly builtRoutes: Readonly<Record<MireglassRouteKind, string | null>>
  readonly cacheRevealed: boolean
  readonly cacheExcavated: boolean
  readonly shopStock: Readonly<Record<MireglassShopItemId, number>>
}

export type MireglassExpeditionAction =
  | { type: 'chop_tree'; resourceId: string }
  | { type: 'build_route'; siteId: string }
  | { type: 'traverse_route'; siteId: string; from: 'from' | 'to' }
  | { type: 'cast_wayfinder_glow' }
  | { type: 'excavate_cache' }
  | { type: 'buy_item'; itemId: MireglassShopItemId }
  | { type: 'sell_item'; itemId: MireglassSaleItemId; quantity: number }
  | { type: 'equip_item'; itemId: MireglassEquippableItemId }

export type MireglassExpeditionEvent =
  | { type: 'tree_chopped'; resourceId: string; itemId: 'logs'; quantity: 4; xp: number }
  | { type: 'route_built'; routeId: MireglassRouteSite['routeId']; siteId: string; kind: MireglassRouteKind; logCost: 4 | 8; xp: number }
  | { type: 'route_traversed'; routeId: MireglassRouteSite['routeId']; siteId: string; from: 'from' | 'to'; position: Vec3 }
  | { type: 'cache_revealed'; cacheId: string; spellId: 'wayfinder_glow'; xp: number }
  | { type: 'cache_excavated'; cacheId: string; itemId: 'mireglass_reach/item/seal'; quantity: 1; xp: number }
  | { type: 'item_bought'; itemId: MireglassShopItemId; price: number; stockRemaining: number }
  | { type: 'item_sold'; itemId: MireglassSaleItemId; quantity: number; unitPrice: number; totalPrice: number }
  | { type: 'item_equipped'; itemId: MireglassEquippableItemId; slot: 'mainHand' | 'feet' }

export interface MireglassExpeditionRejection {
  readonly actionType: MireglassExpeditionAction['type'] | 'unknown'
  readonly code: 'invalid_value' | 'invalid_progress' | 'seed_mismatch' | 'not_found' | 'too_far'
    | 'requires_axe' | 'depleted' | 'capacity' | 'not_owned' | 'already_built' | 'not_built'
    | 'unlearned_spell' | 'already_revealed' | 'site_hidden' | 'already_excavated'
    | 'requires_spade' | 'skill_locked' | 'insufficient_coins' | 'out_of_stock' | 'already_equipped'
  readonly message: string
}

export type MireglassExpeditionResult =
  | { progress: MireglassExpeditionProgress; event: MireglassExpeditionEvent; newPosition?: Vec3; rejection?: never }
  | { progress: MireglassExpeditionProgress; rejection: MireglassExpeditionRejection; event?: never; newPosition?: never }

const validCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const positiveCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const owns = (player: MireglassV6Player, itemId: MireglassItemId) => player.inventory
  .filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.quantity, 0)
const usedCapacity = (player: MireglassV6Player) => player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
  + player.tradeSlots.reduce((sum, slot) => sum + slot.quantity, 0)
const hasCapacity = (player: MireglassV6Player, addition: number) => usedCapacity(player) + addition <= player.backpackCapacity
const clonePlayer = (player: MireglassV6Player): MireglassV6Player => structuredClone(player)

function validPlayer(player: MireglassV6Player): boolean {
  if (!player || !player.position || ![player.position.x, player.position.y, player.position.z,
    player.verticalVelocity, player.yaw, player.pitch].every(finite)
    || !validCount(player.coins) || !validCount(player.xp) || !positiveCount(player.level)
    || player.level !== 1 + Math.floor(player.xp / 100)
    || !positiveCount(player.backpackCapacity) || player.backpackCapacity > 1_000
    || !Array.isArray(player.inventory) || !player.inventory.every((stack) => stack
      && ITEM_IDS.includes(stack.itemId) && positiveCount(stack.quantity))
    || !player.equipment || !EQUIPMENT_SLOTS.every((slot) => player.equipment[slot] === null
      || ITEM_IDS.includes(player.equipment[slot]!))
    || !Array.isArray(player.tradeSlots) || player.tradeSlots.length !== 4
    || !player.tradeSlots.every((slot, index) => slot && slot.slotIndex === index
      && (slot.itemId === null ? slot.quantity === 0 && slot.unitPrice === 0
        : ITEM_IDS.includes(slot.itemId) && positiveCount(slot.quantity) && positiveCount(slot.unitPrice)))
    || !player.skillXp || !SKILL_IDS.every((skillId) => validCount(player.skillXp[skillId]))
    || !Array.isArray(player.learnedSpellIds) || !player.learnedSpellIds.every((id) => id === 'wayfinder_glow')
    || new Set(player.learnedSpellIds).size !== player.learnedSpellIds.length
    || !Array.isArray(player.discoveredRingIds) || !player.discoveredRingIds.every((id) => typeof id === 'string')
    || new Set(player.discoveredRingIds).size !== player.discoveredRingIds.length
    || !hasCapacity(player, 0)) return false
  return EQUIPMENT_SLOTS.every((slot) => {
    const itemId = player.equipment[slot]
    return itemId === null || EQUIPMENT_SLOTS.filter((candidate) => player.equipment[candidate] === itemId).length <= owns(player, itemId)
  })
}

function validProgress(progress: MireglassExpeditionProgress): boolean {
  return !!progress && validPlayer(progress.player)
    && Array.isArray(progress.depletedResourceIds)
    && progress.depletedResourceIds.every((id) => typeof id === 'string')
    && new Set(progress.depletedResourceIds).size === progress.depletedResourceIds.length
    && !!progress.builtRoutes
    && (progress.builtRoutes.bridge === null || typeof progress.builtRoutes.bridge === 'string')
    && (progress.builtRoutes.ladder === null || typeof progress.builtRoutes.ladder === 'string')
    && typeof progress.cacheRevealed === 'boolean' && typeof progress.cacheExcavated === 'boolean'
    && (!progress.cacheExcavated || progress.cacheRevealed)
    && !!progress.shopStock && (['field_spade', 'mireglass_reach/item/waders'] as const).every((itemId) =>
      validCount(progress.shopStock[itemId]) && progress.shopStock[itemId] <= MIREGLASS_OUTPOST_CATALOG[itemId].stock)
}

function addItem(player: MireglassV6Player, itemId: MireglassItemId, quantity: number): void {
  const stack = player.inventory.find((entry) => entry.itemId === itemId)
  if (stack) stack.quantity += quantity
  else player.inventory.push({ itemId, quantity })
}

function removeItem(player: MireglassV6Player, itemId: MireglassItemId, quantity: number): void {
  let remaining = quantity
  for (const stack of player.inventory) {
    if (stack.itemId !== itemId || remaining === 0) continue
    const removed = Math.min(stack.quantity, remaining)
    stack.quantity -= removed
    remaining -= removed
  }
  player.inventory = player.inventory.filter((stack) => stack.quantity > 0)
}

function gainXp(player: MireglassV6Player, amount: number, skillId: keyof PlayerState['skillXp']): void {
  player.xp += amount
  player.level = 1 + Math.floor(player.xp / 100)
  player.skillXp[skillId] += amount
}

const canGainXp = (player: MireglassV6Player, amount: number, ...skills: Array<keyof PlayerState['skillXp']>) =>
  Number.isSafeInteger(player.xp + amount) && skills.every((skillId) => Number.isSafeInteger(player.skillXp[skillId] + amount))

/** Import a validated v5 player whole, or use the v5 generator for a fresh unsaved expedition. */
export function createMireglassExpeditionProgress(seed: string, v5Player?: PlayerState): MireglassExpeditionProgress {
  if (typeof seed !== 'string') throw new TypeError('Mireglass seed must be a string.')
  const normalizedSeed = seed || 'wizard-realms'
  const player = clonePlayer(v5Player ?? createGeneratedWorld(normalizedSeed).player)
  if (!validPlayer(player)) throw new RangeError('Mireglass requires a validated v5 player.')
  return {
    contentRevision: MIREGLASS_CONTENT_REVISION, seed: normalizedSeed, player,
    depletedResourceIds: [], builtRoutes: { bridge: null, ladder: null },
    cacheRevealed: false, cacheExcavated: false,
    shopStock: { field_spade: MIREGLASS_OUTPOST_CATALOG.field_spade.stock,
      'mireglass_reach/item/waders': MIREGLASS_OUTPOST_CATALOG['mireglass_reach/item/waders'].stock },
  }
}

/** Pure region action boundary. The caller supplies the streamed authority's current position. */
export function applyMireglassExpeditionAction(
  seed: string, position: Readonly<Vec3>, progress: MireglassExpeditionProgress, action: MireglassExpeditionAction,
): MireglassExpeditionResult {
  const actionType = action?.type ?? 'unknown'
  const reject = (code: MireglassExpeditionRejection['code'], message: string): MireglassExpeditionResult =>
    ({ progress, rejection: { actionType, code, message } })
  if (!validProgress(progress)) return reject('invalid_progress', 'Mireglass progress is invalid.')
  if (typeof seed !== 'string' || progress.seed !== (seed || 'wizard-realms')
    || progress.contentRevision !== MIREGLASS_CONTENT_REVISION) return reject('seed_mismatch', 'Mireglass progress belongs to another world or revision.')
  if (!position || ![position.x, position.y, position.z].every(finite)
    || !action || typeof action.type !== 'string') return reject('invalid_value', 'Action or position is invalid.')
  const player = progress.player
  const copyAt = (at: Readonly<Vec3> = position) => {
    const copy = clonePlayer(player)
    copy.position = { ...at }
    return copy
  }

  if (action.type === 'chop_tree') {
    const tree = mireglassResources(seed).find(({ id }) => id === action.resourceId)
    if (!tree) return reject('not_found', 'Reserved tree does not exist.')
    if (progress.depletedResourceIds.includes(tree.id)) return reject('depleted', 'This tree has already been chopped.')
    if (distance(position, tree.tile.center) > REACH_METERS) return reject('too_far', 'Tree is out of reach.')
    if (player.equipment.mainHand !== 'woodcutters_axe' || owns(player, 'woodcutters_axe') < 1) return reject('requires_axe', 'Equip an owned axe.')
    if (!hasCapacity(player, 4)) return reject('capacity', 'Backpack cannot hold four logs.')
    if (!canGainXp(player, WOODCUTTING_XP, 'woodcutting')) return reject('invalid_value', 'Experience exceeds safe limits.')
    const next = copyAt()
    addItem(next, 'logs', 4)
    gainXp(next, WOODCUTTING_XP, 'woodcutting')
    return { progress: { ...progress, player: next, depletedResourceIds: [...progress.depletedResourceIds, tree.id].sort() },
      event: { type: 'tree_chopped', resourceId: tree.id, itemId: 'logs', quantity: 4, xp: WOODCUTTING_XP } }
  }

  if (action.type === 'build_route' || action.type === 'traverse_route') {
    const site = mireglassRouteSites(seed).find(({ id }) => id === action.siteId)
    if (!site) return reject('not_found', 'Canonical route site does not exist.')
    if (action.type === 'build_route') {
      if (progress.builtRoutes[site.kind] !== null) return reject('already_built', 'This route already has a selected site.')
      if (distance(position, site.from) > REACH_METERS) return reject('too_far', 'Build from the route approach.')
      if (owns(player, 'logs') < site.logCost) return reject('not_owned', 'Not enough logs for this route.')
      const xp = CONSTRUCTION_XP[site.kind]
      if (!canGainXp(player, xp, 'construction')) return reject('invalid_value', 'Experience exceeds safe limits.')
      const next = copyAt()
      removeItem(next, 'logs', site.logCost)
      gainXp(next, xp, 'construction')
      return { progress: { ...progress, player: next, builtRoutes: { ...progress.builtRoutes, [site.kind]: site.id } },
        event: { type: 'route_built', routeId: site.routeId, siteId: site.id, kind: site.kind, logCost: site.logCost, xp } }
    }
    if (progress.builtRoutes[site.kind] !== site.id) return reject('not_built', 'Only the selected built route can be traversed.')
    if (action.from !== 'from' && action.from !== 'to') return reject('invalid_value', 'Traversal direction is invalid.')
    if (distance(position, site[action.from]) > REACH_METERS) return reject('too_far', 'Route endpoint is out of reach.')
    const newPosition = { ...(action.from === 'from' ? site.to : site.from) }
    const next = copyAt(newPosition)
    next.verticalVelocity = 0
    return { progress: { ...progress, player: next }, newPosition,
      event: { type: 'route_traversed', routeId: site.routeId, siteId: site.id, from: action.from, position: { ...newPosition } } }
  }

  if (action.type === 'cast_wayfinder_glow') {
    if (!player.learnedSpellIds.includes('wayfinder_glow')) return reject('unlearned_spell', 'Learn Wayfinder Glow before casting.')
    if (progress.cacheRevealed) return reject('already_revealed', 'The cache is already revealed.')
    const cache = mireglassAnchors(seed).sealCache
    if (distance(position, cache.tile.center) > GLOW_METERS) return reject('too_far', 'Cast within eight meters of the cache.')
    if (!canGainXp(player, GLOW_XP, 'spellcraft', 'wayfinding')) return reject('invalid_value', 'Experience exceeds safe limits.')
    const next = copyAt()
    gainXp(next, GLOW_XP, 'spellcraft')
    next.skillXp.wayfinding += GLOW_XP
    return { progress: { ...progress, player: next, cacheRevealed: true },
      event: { type: 'cache_revealed', cacheId: cache.id, spellId: 'wayfinder_glow', xp: GLOW_XP } }
  }

  if (action.type === 'excavate_cache') {
    const cache = mireglassAnchors(seed).sealCache
    if (progress.cacheExcavated) return reject('already_excavated', 'The cache has already been excavated.')
    if (!progress.cacheRevealed) return reject('site_hidden', 'Reveal the cache before excavating.')
    if (distance(position, cache.tile.center) > REACH_METERS) return reject('too_far', 'Cache is out of reach.')
    if (player.equipment.mainHand !== 'field_spade' || owns(player, 'field_spade') < 1) return reject('requires_spade', 'Equip an owned spade.')
    if (1 + Math.floor(player.skillXp.excavation / 30) < 2) return reject('skill_locked', 'Excavation level two is required.')
    if (!hasCapacity(player, 1)) return reject('capacity', 'Backpack cannot hold the seal.')
    if (!canGainXp(player, EXCAVATION_XP, 'excavation')) return reject('invalid_value', 'Experience exceeds safe limits.')
    const next = copyAt()
    addItem(next, 'mireglass_reach/item/seal', 1)
    gainXp(next, EXCAVATION_XP, 'excavation')
    return { progress: { ...progress, player: next, cacheExcavated: true },
      event: { type: 'cache_excavated', cacheId: cache.id, itemId: 'mireglass_reach/item/seal', quantity: 1, xp: EXCAVATION_XP } }
  }

  if (action.type === 'buy_item' || action.type === 'sell_item') {
    const outpost = mireglassAnchors(seed).salvager
    if (distance(position, outpost.tile.center) > REACH_METERS) return reject('too_far', 'Salvager outpost is out of reach.')
    if (action.type === 'buy_item') {
      if (action.itemId !== 'field_spade' && action.itemId !== 'mireglass_reach/item/waders') return reject('invalid_value', 'Outpost does not sell this item.')
      const listing = MIREGLASS_OUTPOST_CATALOG[action.itemId]
      if (progress.shopStock[action.itemId] < 1) return reject('out_of_stock', 'Item is out of stock.')
      if (player.coins < listing.price) return reject('insufficient_coins', 'Not enough coins.')
      if (!hasCapacity(player, 1)) return reject('capacity', 'Backpack is full.')
      const next = copyAt()
      next.coins -= listing.price
      addItem(next, action.itemId, 1)
      const stockRemaining = progress.shopStock[action.itemId] - 1
      return { progress: { ...progress, player: next, shopStock: { ...progress.shopStock, [action.itemId]: stockRemaining } },
        event: { type: 'item_bought', itemId: action.itemId, price: listing.price, stockRemaining } }
    }
    if ((action.itemId !== 'logs' && action.itemId !== 'mireglass_reach/item/seal')
      || !positiveCount(action.quantity)) return reject('invalid_value', 'Sale item or quantity is invalid.')
    if (owns(player, action.itemId) < action.quantity) return reject('not_owned', 'Not enough items to sell.')
    const unitPrice = MIREGLASS_OUTPOST_SELL_PRICES[action.itemId]
    const totalPrice = unitPrice * action.quantity
    if (!Number.isSafeInteger(player.coins + totalPrice)) return reject('invalid_value', 'Coin total would exceed safe limits.')
    const next = copyAt()
    removeItem(next, action.itemId, action.quantity)
    next.coins += totalPrice
    return { progress: { ...progress, player: next },
      event: { type: 'item_sold', itemId: action.itemId, quantity: action.quantity, unitPrice, totalPrice } }
  }

  if (action.type === 'equip_item') {
    if (action.itemId !== 'woodcutters_axe' && action.itemId !== 'field_spade'
      && action.itemId !== 'mireglass_reach/item/waders') return reject('invalid_value', 'This item cannot be equipped.')
    if (owns(player, action.itemId) < 1) return reject('not_owned', 'Own this item before equipping it.')
    const slot = action.itemId === 'mireglass_reach/item/waders' ? 'feet' : 'mainHand'
    if (player.equipment[slot] === action.itemId) return reject('already_equipped', 'This item is already equipped.')
    const alreadyAssigned = EQUIPMENT_SLOTS.filter((candidate) => candidate !== slot && player.equipment[candidate] === action.itemId).length
    if (alreadyAssigned >= owns(player, action.itemId)) return reject('not_owned', 'No unassigned copy is available.')
    const next = copyAt()
    next.equipment[slot] = action.itemId
    return { progress: { ...progress, player: next }, event: { type: 'item_equipped', itemId: action.itemId, slot } }
  }

  return reject('invalid_value', 'Unknown Mireglass action.')
}
