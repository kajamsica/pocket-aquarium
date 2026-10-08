import { createGeneratedWorld } from './generation'
import { mireglassAnchors, mireglassResources, MIREGLASS_CONTENT_REVISION } from './mireglassContent'
import { mireglassRouteSites } from './mireglassRouteSites'
import type { MireglassRouteSite } from './mireglassRouteSites'
import { canEquipItem } from './world'
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
const STUMP_XP = 30
const GLOW_XP = 10

export interface MireglassRegionProgress {
  readonly contentRevision: typeof MIREGLASS_CONTENT_REVISION
  readonly seed: string
  readonly depletedResourceIds: readonly string[]
  readonly dugStumpIds: readonly string[]
  readonly builtRoutes: Readonly<Record<MireglassRouteKind, string | null>>
  readonly fringeMarkerStudied: boolean
  readonly cacheRevealed: boolean
  readonly cacheExcavated: boolean
  readonly shopStock: Readonly<Record<MireglassShopItemId, number>>
}

export type MireglassExpeditionAction =
  | { type: 'chop_tree'; resourceId: string }
  | { type: 'dig_tree_stump'; resourceId: string }
  | { type: 'study_fringe_marker' }
  | { type: 'build_route'; siteId: string }
  | { type: 'traverse_route'; siteId: string; from: 'from' | 'to' }
  | { type: 'cast_wayfinder_glow' }
  | { type: 'excavate_cache' }
  | { type: 'buy_item'; itemId: MireglassShopItemId }
  | { type: 'sell_item'; itemId: MireglassSaleItemId; quantity: number }
  | { type: 'equip_item'; itemId: MireglassEquippableItemId }

export type MireglassExpeditionEvent =
  | { type: 'tree_chopped'; resourceId: string; itemId: 'logs'; quantity: 4; xp: number }
  | { type: 'tree_stump_dug'; resourceId: string; itemId: 'stone'; quantity: 1; xp: 30 }
  | { type: 'fringe_marker_studied'; markerId: string; spellId: 'wayfinder_glow'; learned: boolean }
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
    | 'already_studied' | 'already_dug' | 'not_depleted'
  readonly message: string
}

export type MireglassExpeditionResult =
  | { player: MireglassV6Player; region: MireglassRegionProgress; event: MireglassExpeditionEvent; rejection?: never }
  | { player: MireglassV6Player; region: MireglassRegionProgress; rejection: MireglassExpeditionRejection; event?: never }

const validCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const positiveCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const itemId = (value: unknown): value is MireglassItemId =>
  typeof value === 'string' && ITEM_IDS.includes(value as MireglassItemId)
const equippable = (value: unknown, slot: EquipmentSlot) => value === null
  || (itemId(value) && (value === 'mireglass_reach/item/waders' ? slot === 'feet'
    : value !== 'mireglass_reach/item/seal' && canEquipItem(value, slot)))
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const owns = (player: MireglassV6Player, itemId: MireglassItemId) => player.inventory
  .filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.quantity, 0)
const usedCapacity = (player: MireglassV6Player) => player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
  + player.tradeSlots.reduce((sum, slot) => sum + slot.quantity, 0)
const hasCapacity = (player: MireglassV6Player, addition: number) => usedCapacity(player) + addition <= player.backpackCapacity
const clonePlayer = (player: MireglassV6Player): MireglassV6Player => structuredClone(player)

export function isValidMireglassV6Player(value: unknown): value is MireglassV6Player {
  if (!record(value) || !record(value.position) || !record(value.equipment) || !record(value.skillXp)
    || ![value.position.x, value.position.y, value.position.z,
      value.verticalVelocity, value.yaw, value.pitch].every(finite)
    || !validCount(value.coins) || !validCount(value.xp) || !positiveCount(value.level)
    || value.level !== 1 + Math.floor(value.xp / 100)
    || !positiveCount(value.backpackCapacity) || value.backpackCapacity > 1_000
    || !Array.isArray(value.inventory) || !value.inventory.every((stack) =>
      record(stack) && itemId(stack.itemId) && positiveCount(stack.quantity))
    || !EQUIPMENT_SLOTS.every((slot) => equippable((value.equipment as Record<string, unknown>)[slot], slot))
    || !Array.isArray(value.tradeSlots) || value.tradeSlots.length !== 4
    || !value.tradeSlots.every((slot, index) => record(slot) && slot.slotIndex === index
      && (slot.itemId === null ? slot.quantity === 0 && slot.unitPrice === 0
        : itemId(slot.itemId) && positiveCount(slot.quantity) && positiveCount(slot.unitPrice)))
    || !SKILL_IDS.every((skillId) => validCount((value.skillXp as Record<string, unknown>)[skillId]))
    || !Array.isArray(value.learnedSpellIds)
    || !value.learnedSpellIds.every((id) => id === 'wayfinder_glow')
    || new Set(value.learnedSpellIds).size !== value.learnedSpellIds.length
    || !Array.isArray(value.discoveredRingIds)
    || !value.discoveredRingIds.every((id) => id === 'ring-greenway' || id === 'ring-highland')
    || new Set(value.discoveredRingIds).size !== value.discoveredRingIds.length) return false
  const player = value as unknown as MireglassV6Player
  if (!hasCapacity(player, 0)) return false
  return EQUIPMENT_SLOTS.every((slot) => {
    const equipped = player.equipment[slot]
    return equipped === null || EQUIPMENT_SLOTS.filter((candidate) => player.equipment[candidate] === equipped).length
      <= owns(player, equipped)
  })
}

/** Validates the entire seed-bound region overlay, including canonical route and stump IDs. */
export function isValidMireglassRegionProgress(value: unknown, seed?: string): value is MireglassRegionProgress {
  if (!record(value) || typeof value.seed !== 'string' || !value.seed
    || value.contentRevision !== MIREGLASS_CONTENT_REVISION
    || (seed !== undefined && (typeof seed !== 'string' || value.seed !== (seed || 'wizard-realms')))
    || !Array.isArray(value.depletedResourceIds) || !Array.isArray(value.dugStumpIds)
    || !value.depletedResourceIds.every((id) => typeof id === 'string')
    || !value.dugStumpIds.every((id) => typeof id === 'string')
    || new Set(value.depletedResourceIds).size !== value.depletedResourceIds.length
    || new Set(value.dugStumpIds).size !== value.dugStumpIds.length
    || !record(value.builtRoutes)
    || (value.builtRoutes.bridge !== null && typeof value.builtRoutes.bridge !== 'string')
    || (value.builtRoutes.ladder !== null && typeof value.builtRoutes.ladder !== 'string')
    || typeof value.fringeMarkerStudied !== 'boolean'
    || typeof value.cacheRevealed !== 'boolean' || typeof value.cacheExcavated !== 'boolean'
    || (value.cacheExcavated && !value.cacheRevealed)
    || !record(value.shopStock)
    || !(['field_spade', 'mireglass_reach/item/waders'] as const).every((shopItem) =>
      validCount((value.shopStock as Record<string, unknown>)[shopItem])
      && (value.shopStock as Record<string, number>)[shopItem] <= MIREGLASS_OUTPOST_CATALOG[shopItem].stock)) return false
  const region = value as unknown as MireglassRegionProgress
  try {
    if (region.depletedResourceIds.length || region.dugStumpIds.length) {
      const resources = new Set(mireglassResources(region.seed).map(({ id }) => id))
      if (!region.depletedResourceIds.every((id) => resources.has(id))
        || !region.dugStumpIds.every((id) => resources.has(id) && region.depletedResourceIds.includes(id))) return false
    }
    if (region.builtRoutes.bridge !== null || region.builtRoutes.ladder !== null) {
      const sites = mireglassRouteSites(region.seed)
      if (!(['bridge', 'ladder'] as const).every((kind) => region.builtRoutes[kind] === null
        || sites.some((site) => site.kind === kind && site.id === region.builtRoutes[kind]))) return false
    }
  } catch { return false }
  return true
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

/** Import a validated v5 player whole, or use the v5 generator for a fresh unsaved player. */
export function createMireglassV6Player(seed: string, v5Player?: PlayerState): MireglassV6Player {
  if (typeof seed !== 'string') throw new TypeError('Mireglass seed must be a string.')
  const normalizedSeed = seed || 'wizard-realms'
  const player = clonePlayer(v5Player ?? createGeneratedWorld(normalizedSeed).player)
  if (!isValidMireglassV6Player(player)) throw new RangeError('Mireglass requires a validated v5 player.')
  return player
}

/** Serializable region overlay, independent of the complete v6 player. */
export function createMireglassRegionProgress(seed: string): MireglassRegionProgress {
  if (typeof seed !== 'string') throw new TypeError('Mireglass seed must be a string.')
  const normalizedSeed = seed || 'wizard-realms'
  return {
    contentRevision: MIREGLASS_CONTENT_REVISION, seed: normalizedSeed,
    depletedResourceIds: [], dugStumpIds: [], builtRoutes: { bridge: null, ladder: null },
    fringeMarkerStudied: false,
    cacheRevealed: false, cacheExcavated: false,
    shopStock: { field_spade: MIREGLASS_OUTPOST_CATALOG.field_spade.stock,
      'mireglass_reach/item/waders': MIREGLASS_OUTPOST_CATALOG['mireglass_reach/item/waders'].stock },
  }
}

/** Pure region action boundary. Reach is derived only from the authoritative v6 player position. */
export function applyMireglassExpeditionAction(
  seed: string, player: MireglassV6Player, region: MireglassRegionProgress, action: MireglassExpeditionAction,
): MireglassExpeditionResult {
  const actionType = action?.type ?? 'unknown'
  const reject = (code: MireglassExpeditionRejection['code'], message: string): MireglassExpeditionResult =>
    ({ player, region, rejection: { actionType, code, message } })
  if (!isValidMireglassV6Player(player) || !isValidMireglassRegionProgress(region)) return reject('invalid_progress', 'Mireglass player or region is invalid.')
  if (typeof seed !== 'string' || region.seed !== (seed || 'wizard-realms')
    || region.contentRevision !== MIREGLASS_CONTENT_REVISION) return reject('seed_mismatch', 'Mireglass region belongs to another world or revision.')
  if (!action || typeof action.type !== 'string') return reject('invalid_value', 'Action is invalid.')
  const copyAt = (at: Readonly<Vec3> = player.position) => {
    const copy = clonePlayer(player)
    copy.position = { ...at }
    return copy
  }

  if (action.type === 'chop_tree') {
    const tree = mireglassResources(seed).find(({ id }) => id === action.resourceId)
    if (!tree) return reject('not_found', 'Reserved tree does not exist.')
    if (region.depletedResourceIds.includes(tree.id)) return reject('depleted', 'This tree has already been chopped.')
    if (distance(player.position, tree.tile.center) > REACH_METERS) return reject('too_far', 'Tree is out of reach.')
    if (player.equipment.mainHand !== 'woodcutters_axe' || owns(player, 'woodcutters_axe') < 1) return reject('requires_axe', 'Equip an owned axe.')
    if (!hasCapacity(player, 4)) return reject('capacity', 'Backpack cannot hold four logs.')
    if (!canGainXp(player, WOODCUTTING_XP, 'woodcutting')) return reject('invalid_value', 'Experience exceeds safe limits.')
    const next = copyAt()
    addItem(next, 'logs', 4)
    gainXp(next, WOODCUTTING_XP, 'woodcutting')
    return { player: next, region: { ...region, depletedResourceIds: [...region.depletedResourceIds, tree.id].sort() },
      event: { type: 'tree_chopped', resourceId: tree.id, itemId: 'logs', quantity: 4, xp: WOODCUTTING_XP } }
  }

  if (action.type === 'study_fringe_marker') {
    if (region.fringeMarkerStudied) return reject('already_studied', 'The fringe marker was already studied.')
    const marker = mireglassAnchors(seed).fringeMarker
    if (distance(player.position, marker.tile.center) > REACH_METERS) return reject('too_far', 'Fringe marker is out of reach.')
    const next = copyAt()
    const learned = !next.learnedSpellIds.includes('wayfinder_glow')
    if (learned) next.learnedSpellIds.push('wayfinder_glow')
    return { player: next, region: { ...region, fringeMarkerStudied: true },
      event: { type: 'fringe_marker_studied', markerId: marker.id, spellId: 'wayfinder_glow', learned } }
  }

  if (action.type === 'dig_tree_stump') {
    const tree = mireglassResources(seed).find(({ id }) => id === action.resourceId)
    if (!tree) return reject('not_found', 'Reserved tree stump does not exist.')
    if (!region.depletedResourceIds.includes(tree.id)) return reject('not_depleted', 'Chop this tree before digging its stump.')
    if (region.dugStumpIds.includes(tree.id)) return reject('already_dug', 'This stump has already been dug.')
    if (distance(player.position, tree.tile.center) > REACH_METERS) return reject('too_far', 'Tree stump is out of reach.')
    if (player.equipment.mainHand !== 'field_spade' || owns(player, 'field_spade') < 1) return reject('requires_spade', 'Equip an owned spade.')
    if (!hasCapacity(player, 1)) return reject('capacity', 'Backpack cannot hold the stone.')
    if (!canGainXp(player, STUMP_XP, 'excavation')) return reject('invalid_value', 'Experience exceeds safe limits.')
    const next = copyAt()
    addItem(next, 'stone', 1)
    gainXp(next, STUMP_XP, 'excavation')
    return { player: next, region: { ...region, dugStumpIds: [...region.dugStumpIds, tree.id].sort() },
      event: { type: 'tree_stump_dug', resourceId: tree.id, itemId: 'stone', quantity: 1, xp: STUMP_XP } }
  }

  if (action.type === 'build_route' || action.type === 'traverse_route') {
    const site = mireglassRouteSites(seed).find(({ id }) => id === action.siteId)
    if (!site) return reject('not_found', 'Canonical route site does not exist.')
    if (action.type === 'build_route') {
      if (region.builtRoutes[site.kind] !== null) return reject('already_built', 'This route already has a selected site.')
      if (distance(player.position, site.from) > REACH_METERS) return reject('too_far', 'Build from the route approach.')
      if (owns(player, 'logs') < site.logCost) return reject('not_owned', 'Not enough logs for this route.')
      const xp = CONSTRUCTION_XP[site.kind]
      if (!canGainXp(player, xp, 'construction')) return reject('invalid_value', 'Experience exceeds safe limits.')
      const next = copyAt()
      removeItem(next, 'logs', site.logCost)
      gainXp(next, xp, 'construction')
      return { player: next, region: { ...region, builtRoutes: { ...region.builtRoutes, [site.kind]: site.id } },
        event: { type: 'route_built', routeId: site.routeId, siteId: site.id, kind: site.kind, logCost: site.logCost, xp } }
    }
    if (region.builtRoutes[site.kind] !== site.id) return reject('not_built', 'Only the selected built route can be traversed.')
    if (action.from !== 'from' && action.from !== 'to') return reject('invalid_value', 'Traversal direction is invalid.')
    if (distance(player.position, site[action.from]) > REACH_METERS) return reject('too_far', 'Route endpoint is out of reach.')
    const destination = { ...(action.from === 'from' ? site.to : site.from) }
    const next = copyAt(destination)
    next.verticalVelocity = 0
    return { player: next, region,
      event: { type: 'route_traversed', routeId: site.routeId, siteId: site.id, from: action.from, position: { ...destination } } }
  }

  if (action.type === 'cast_wayfinder_glow') {
    if (!player.learnedSpellIds.includes('wayfinder_glow')) return reject('unlearned_spell', 'Learn Wayfinder Glow before casting.')
    if (region.cacheRevealed) return reject('already_revealed', 'The cache is already revealed.')
    const cache = mireglassAnchors(seed).sealCache
    if (distance(player.position, cache.tile.center) > GLOW_METERS) return reject('too_far', 'Cast within eight meters of the cache.')
    if (!canGainXp(player, GLOW_XP, 'spellcraft', 'wayfinding')) return reject('invalid_value', 'Experience exceeds safe limits.')
    const next = copyAt()
    gainXp(next, GLOW_XP, 'spellcraft')
    next.skillXp.wayfinding += GLOW_XP
    return { player: next, region: { ...region, cacheRevealed: true },
      event: { type: 'cache_revealed', cacheId: cache.id, spellId: 'wayfinder_glow', xp: GLOW_XP } }
  }

  if (action.type === 'excavate_cache') {
    const cache = mireglassAnchors(seed).sealCache
    if (region.cacheExcavated) return reject('already_excavated', 'The cache has already been excavated.')
    if (!region.cacheRevealed) return reject('site_hidden', 'Reveal the cache before excavating.')
    if (distance(player.position, cache.tile.center) > REACH_METERS) return reject('too_far', 'Cache is out of reach.')
    if (player.equipment.mainHand !== 'field_spade' || owns(player, 'field_spade') < 1) return reject('requires_spade', 'Equip an owned spade.')
    if (1 + Math.floor(player.skillXp.excavation / 30) < 2) return reject('skill_locked', 'Excavation level two is required.')
    if (!hasCapacity(player, 1)) return reject('capacity', 'Backpack cannot hold the seal.')
    if (!canGainXp(player, EXCAVATION_XP, 'excavation')) return reject('invalid_value', 'Experience exceeds safe limits.')
    const next = copyAt()
    addItem(next, 'mireglass_reach/item/seal', 1)
    gainXp(next, EXCAVATION_XP, 'excavation')
    return { player: next, region: { ...region, cacheExcavated: true },
      event: { type: 'cache_excavated', cacheId: cache.id, itemId: 'mireglass_reach/item/seal', quantity: 1, xp: EXCAVATION_XP } }
  }

  if (action.type === 'buy_item' || action.type === 'sell_item') {
    const outpost = mireglassAnchors(seed).salvager
    if (distance(player.position, outpost.tile.center) > REACH_METERS) return reject('too_far', 'Salvager outpost is out of reach.')
    if (action.type === 'buy_item') {
      if (action.itemId !== 'field_spade' && action.itemId !== 'mireglass_reach/item/waders') return reject('invalid_value', 'Outpost does not sell this item.')
      const listing = MIREGLASS_OUTPOST_CATALOG[action.itemId]
      if (region.shopStock[action.itemId] < 1) return reject('out_of_stock', 'Item is out of stock.')
      if (player.coins < listing.price) return reject('insufficient_coins', 'Not enough coins.')
      if (!hasCapacity(player, 1)) return reject('capacity', 'Backpack is full.')
      const next = copyAt()
      next.coins -= listing.price
      addItem(next, action.itemId, 1)
      const stockRemaining = region.shopStock[action.itemId] - 1
      return { player: next, region: { ...region, shopStock: { ...region.shopStock, [action.itemId]: stockRemaining } },
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
    return { player: next, region,
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
    return { player: next, region, event: { type: 'item_equipped', itemId: action.itemId, slot } }
  }

  return reject('invalid_value', 'Unknown Mireglass action.')
}
