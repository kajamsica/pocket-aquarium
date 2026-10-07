import type {
  AreaId, EquipmentSlot, GenerationProfile, IntentRejection, ItemId, PlayerState, ResourceKind, Vec3, WizardAdvanceResult,
  WizardEvent, WizardIntent, WizardProjection, WizardWorldState,
} from './types'
import { areaAt, createGeneratedWorld, STORE_HALF_DEPTH, STORE_HALF_WIDTH, terrainHeightAt } from './generation'

const INTERACT_DISTANCE = 3
const itemForResource: Record<ResourceKind, ItemId> = { tree: 'logs', herb: 'marsh_herb', stone: 'stone', ore: 'iron_ore' }
const storeSellPrices: Record<string, Partial<Record<ItemId, number>>> = {
  'store-greenway': { logs: 2, marsh_herb: 3, stone: 1, iron_ore: 4 },
  'store-highland': { logs: 1, marsh_herb: 5, stone: 3, iron_ore: 7 },
}
export function storeSellUnitPrice(storeId: string, itemId: ItemId): number | null {
  const price = storeSellPrices[storeId]?.[itemId]
  return typeof price === 'number' ? price : null
}
const itemSlots: Partial<Record<ItemId, EquipmentSlot[]>> = {
  woodcutters_axe: ['mainHand'], apprentice_hat: ['head'], traveler_tunic: ['chest'],
  trail_leggings: ['legs'], leather_boots: ['feet'], oak_wand: ['mainHand', 'offHand'], wooden_shield: ['offHand'],
}
const equipmentSlots: readonly EquipmentSlot[] = ['head', 'chest', 'legs', 'feet', 'mainHand', 'offHand']
export const canEquipItem = (itemId: ItemId, slot: EquipmentSlot) => itemSlots[itemId]?.includes(slot) ?? false

const finite = (value: number) => Number.isFinite(value)
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const cloneState = (state: WizardWorldState): WizardWorldState => JSON.parse(JSON.stringify(state)) as WizardWorldState
const levelForXp = (xp: number) => 1 + Math.floor(Math.max(0, xp) / 100)
const inventoryCount = (player: PlayerState) => player.inventory.reduce((sum, stack) => sum + stack.quantity, 0)
const reservedCount = (player: PlayerState) => player.tradeSlots.reduce((sum, slot) => sum + slot.quantity, 0)
const owns = (player: PlayerState, itemId: ItemId) => player.inventory
  .filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.quantity, 0)
const equippedCount = (player: PlayerState, itemId: ItemId, except?: EquipmentSlot) =>
  (Object.entries(player.equipment) as [EquipmentSlot, ItemId | null][])
    .filter(([slot, equipped]) => slot !== except && equipped === itemId).length

const routeEndpointDistance = (player: Vec3, route: WizardWorldState['routes'][number]) =>
  Math.min(distance(player, route.from), distance(player, route.to))

function insideStoreFootprint(x: number, z: number, store: WizardWorldState['stores'][number]) {
  return Math.abs(x - store.position.x) < STORE_HALF_WIDTH && Math.abs(z - store.position.z) < STORE_HALF_DEPTH
}

function segmentEntersStore(startX: number, startZ: number, endX: number, endZ: number, store: WizardWorldState['stores'][number]) {
  let enter = 0
  let exit = 1
  const axes = [
    [startX, endX, store.position.x - STORE_HALF_WIDTH, store.position.x + STORE_HALF_WIDTH],
    [startZ, endZ, store.position.z - STORE_HALF_DEPTH, store.position.z + STORE_HALF_DEPTH],
  ]
  for (const [start, end, min, max] of axes) {
    const delta = end - start
    if (delta === 0) {
      if (start <= min || start >= max) return false
      continue
    }
    const first = (min - start) / delta
    const second = (max - start) / delta
    enter = Math.max(enter, Math.min(first, second))
    exit = Math.min(exit, Math.max(first, second))
    if (enter >= exit) return false
  }
  return enter < 1 && exit > 0
}

function allowsStoreMove(state: WizardWorldState, startX: number, startZ: number, endX: number, endZ: number) {
  return state.stores.every((store) => {
    if (!insideStoreFootprint(startX, startZ, store)) return !segmentEntersStore(startX, startZ, endX, endZ, store)
    const start = [(startX - store.position.x) / STORE_HALF_WIDTH, (startZ - store.position.z) / STORE_HALF_DEPTH]
    const end = [(endX - store.position.x) / STORE_HALF_WIDTH, (endZ - store.position.z) / STORE_HALF_DEPTH]
    const outward = start[0] * (end[0] - start[0]) + start[1] * (end[1] - start[1]) >= 0
    return outward && end[0] ** 2 + end[1] ** 2 > start[0] ** 2 + start[1] ** 2
  })
}

function tileAt(state: WizardWorldState, position: Vec3, areaId: AreaId) {
  let closest: WizardWorldState['tiles'][number] | undefined
  let closestDistance = Infinity
  for (const tile of state.tiles) {
    if (areaAt(state.areas, tile.center.x, tile.center.z).id !== areaId) continue
    const tileDistance = (position.x - tile.center.x) ** 2 + (position.z - tile.center.z) ** 2
    if (tileDistance < closestDistance) {
      closest = tile
      closestDistance = tileDistance
    }
  }
  return closest
}

function addItem(player: PlayerState, itemId: ItemId, quantity: number): boolean {
  if (inventoryCount(player) + reservedCount(player) + quantity > player.backpackCapacity) return false
  const stack = player.inventory.find((candidate) => candidate.itemId === itemId)
  if (stack) stack.quantity += quantity
  else player.inventory.push({ itemId, quantity })
  return true
}

function removeItem(player: PlayerState, itemId: ItemId, quantity: number): boolean {
  if (owns(player, itemId) < quantity) return false
  let remaining = quantity
  for (const stack of player.inventory.filter((candidate) => candidate.itemId === itemId)) {
    const removed = Math.min(stack.quantity, remaining)
    stack.quantity -= removed
    remaining -= removed
    if (remaining === 0) break
  }
  player.inventory = player.inventory.filter((stack) => stack.quantity > 0)
  return remaining === 0
}

function rejection(index: number, intent: WizardIntent, code: IntentRejection['code'], message: string): IntentRejection {
  return { intentIndex: index, intentType: intent.type, code, message }
}

type WizardEventBody = WizardEvent extends infer E ? E extends WizardEvent ? Omit<E, 'sequence' | 'tick'> : never : never

function event(state: WizardWorldState, tick: number, body: WizardEventBody): WizardEvent {
  state.eventSequence += 1
  return { ...body, sequence: state.eventSequence, tick } as WizardEvent
}

function discoverTile(state: WizardWorldState, position: Vec3, areaId: AreaId, tick: number): WizardEvent | undefined {
  const tile = tileAt(state, position, areaId)
  if (!tile || state.discoveredTileIds.includes(tile.id)) return undefined
  state.discoveredTileIds.push(tile.id)
  state.discoveredTileIds.sort()
  return event(state, tick, { type: 'tile_discovered', tileId: tile.id })
}

function stepRng(value: number): number {
  let next = value | 0
  next ^= next << 13
  next ^= next >>> 17
  next ^= next << 5
  return next >>> 0 || 1
}

function applyIntent(
  current: WizardWorldState, intent: WizardIntent, index: number, tick: number,
): { state: WizardWorldState; events?: WizardEvent[]; rejection?: IntentRejection } {
  const fail = (code: IntentRejection['code'], message: string) => ({ state: current, rejection: rejection(index, intent, code, message) })

  if (intent.type === 'move') {
    if (![intent.delta.x, intent.delta.y, intent.delta.z].every(finite) || Math.hypot(intent.delta.x, intent.delta.y, intent.delta.z) > 4) return fail('invalid_value', 'Movement must be finite and at most four meters per tick.')
    const state = current
    const tileEdge = state.generationProfile === 'greenway-expanded-v1'
      ? Math.abs(state.tiles[1].center.x - state.tiles[0].center.x) / 2 : 0
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const tile of state.tiles) {
      minX = Math.min(minX, tile.center.x)
      maxX = Math.max(maxX, tile.center.x)
      minZ = Math.min(minZ, tile.center.z)
      maxZ = Math.max(maxZ, tile.center.z)
    }
    let x = Math.max(minX - tileEdge, Math.min(maxX + tileEdge, state.player.position.x + intent.delta.x))
    let z = Math.max(minZ - tileEdge, Math.min(maxZ + tileEdge, state.player.position.z + intent.delta.z))
    const currentArea = areaAt(state.areas, state.player.position.x, state.player.position.z)
    const nextArea = areaAt(state.areas, x, z)
    if (currentArea.id !== nextArea.id) {
      const startX = state.player.position.x
      const startZ = state.player.position.z
      if (x !== startX && areaAt(state.areas, x, startZ).id === currentArea.id) z = startZ
      else if (z !== startZ && areaAt(state.areas, startX, z).id === currentArea.id) x = startX
      else return fail('locked_area', 'Use a completed route to cross into another area.')
    }
    const startX = state.player.position.x
    const startZ = state.player.position.z
    if (!allowsStoreMove(state, startX, startZ, x, z)) {
      if (x !== startX && allowsStoreMove(state, startX, startZ, x, startZ)) z = startZ
      else if (z !== startZ && allowsStoreMove(state, startX, startZ, startX, z)) x = startX
      else return { state: current }
    }
    const ground = terrainHeightAt(state.tiles, x, z)
    state.player.position = { x, y: Math.max(state.player.position.y, ground), z }
    if (state.player.position.y === ground) state.player.verticalVelocity = 0
    const events = [event(state, tick, { type: 'player_moved', position: { ...state.player.position } })]
    if (x !== startX || z !== startZ) {
      const discovered = discoverTile(state, state.player.position, areaAt(state.areas, x, z).id, tick)
      if (discovered) events.push(discovered)
    }
    return { state, events }
  }

  if (intent.type === 'look') {
    if (!finite(intent.yawDelta) || !finite(intent.pitchDelta)) return fail('invalid_value', 'Look deltas must be finite.')
    const state = current
    state.player.yaw += intent.yawDelta
    state.player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, state.player.pitch + intent.pitchDelta))
    return { state, events: [event(state, tick, { type: 'player_looked', yaw: state.player.yaw, pitch: state.player.pitch })] }
  }

  if (intent.type === 'jump') {
    const ground = terrainHeightAt(current.tiles, current.player.position.x, current.player.position.z)
    if (Math.abs(current.player.position.y - ground) > 0.001 || current.player.verticalVelocity !== 0) return fail('invalid_value', 'Player is already airborne.')
    const state = cloneState(current)
    state.player.verticalVelocity = 5
    return { state, events: [event(state, tick, { type: 'player_jumped' })] }
  }

  if (intent.type === 'build_route') {
    const route = current.routes.find((candidate) => candidate.id === intent.routeId)
    const recipe = current.recipes.find((candidate) => candidate.routeId === intent.routeId)
    if (!route || !recipe) return fail('not_found', 'Construction route does not exist.')
    if (current.builtRouteIds.includes(route.id)) return fail('already_built', 'This route is already complete.')
    if (!current.unlockedRecipeIds.includes(recipe.id)) return fail('recipe_locked', 'This route recipe is not unlocked.')
    if (current.player.level < recipe.minimumLevel || (recipe.prerequisiteRouteId && !current.builtRouteIds.includes(recipe.prerequisiteRouteId))) return fail('recipe_locked', 'This route requires more progression.')
    if (routeEndpointDistance(current.player.position, route) > INTERACT_DISTANCE) return fail('too_far', 'Move to the route scaffold to build it.')
    if (owns(current.player, 'logs') < recipe.logCost) return fail('not_owned', `This route requires ${recipe.logCost} logs.`)
    const state = cloneState(current)
    removeItem(state.player, 'logs', recipe.logCost)
    state.builtRouteIds.push(route.id)
    state.builtRouteIds.sort()
    state.player.xp += recipe.xpReward
    state.player.level = levelForXp(state.player.xp)
    return { state, events: [event(state, tick, { type: 'route_built', routeId: route.id, logCost: recipe.logCost, xp: recipe.xpReward })] }
  }

  if (intent.type === 'traverse_route') {
    const route = current.routes.find((candidate) => candidate.id === intent.routeId)
    if (!route) return fail('not_found', 'Construction route does not exist.')
    if (!current.builtRouteIds.includes(route.id)) return fail('recipe_locked', 'Finish this route before crossing it.')
    if (routeEndpointDistance(current.player.position, route) > INTERACT_DISTANCE) return fail('too_far', 'Move to a route endpoint to cross it.')
    const fromStart = distance(current.player.position, route.from) <= distance(current.player.position, route.to)
    const destination = fromStart ? route.to : route.from
    const fromAreaId = fromStart ? route.fromAreaId : route.toAreaId
    const toAreaId = fromStart ? route.toAreaId : route.fromAreaId
    const state = cloneState(current)
    state.player.position = { ...destination }
    state.player.verticalVelocity = 0
    const events = [event(state, tick, { type: 'route_used', routeId: route.id, fromAreaId, toAreaId, position: { ...destination } })]
    const discovered = discoverTile(state, destination, toAreaId, tick)
    if (discovered) events.push(discovered)
    return { state, events }
  }

  if (intent.type === 'harvest') {
    const resource = current.resources.find((candidate) => candidate.id === intent.resourceId)
    if (!resource) return fail('not_found', 'Resource does not exist.')
    if (resource.depleted) return fail('depleted', 'Resource is depleted.')
    if (distance(current.player.position, resource.position) > INTERACT_DISTANCE) return fail('too_far', 'Resource is out of reach.')
    if (current.player.equipment.mainHand !== 'woodcutters_axe' || resource.kind !== 'tree') return fail('requires_axe', 'A tree requires an equipped woodcutter axe.')
    const yieldQuantity = 3
    if (resource.health <= 1 && inventoryCount(current.player) + reservedCount(current.player) + yieldQuantity > current.player.backpackCapacity) return fail('capacity', 'Backpack cannot hold the harvested logs.')
    const state = cloneState(current)
    const target = state.resources.find((candidate) => candidate.id === intent.resourceId)!
    target.health -= 1
    if (target.health > 0) return { state, events: [event(state, tick, { type: 'resource_damaged', resourceId: target.id, health: target.health })] }
    target.health = 0
    target.depleted = true
    addItem(state.player, itemForResource[target.kind], yieldQuantity)
    state.player.xp += 20
    state.player.level = levelForXp(state.player.xp)
    return { state, events: [event(state, tick, { type: 'resource_harvested', resourceId: target.id, itemId: 'logs', quantity: yieldQuantity, xp: 20 })] }
  }

  if (intent.type === 'discover_fairy_ring') {
    const ring = current.fairyRings.find((candidate) => candidate.id === intent.ringId)
    if (!ring) return fail('not_found', 'Fairy ring does not exist.')
    if (distance(current.player.position, ring.position) > INTERACT_DISTANCE) return fail('too_far', 'Fairy ring is out of reach.')
    if (current.player.discoveredRingIds.includes(ring.id)) return fail('invalid_value', 'Fairy ring is already discovered.')
    const state = cloneState(current)
    state.player.discoveredRingIds.push(ring.id)
    return { state, events: [event(state, tick, { type: 'fairy_ring_discovered', ringId: ring.id })] }
  }

  if (intent.type === 'teleport_fairy_ring') {
    const source = current.fairyRings.find((ring) => ring.id === intent.sourceRingId)
    const target = current.fairyRings.find((ring) => ring.id === intent.targetRingId)
    if (!source || !target) return fail('not_found', 'Fairy ring does not exist.')
    if (distance(current.player.position, source.position) > INTERACT_DISTANCE) return fail('too_far', 'Player must stand at the source fairy ring.')
    if (!current.player.discoveredRingIds.includes(source.id) || !current.player.discoveredRingIds.includes(target.id)) return fail('undiscovered', 'Both fairy rings must be discovered.')
    const state = cloneState(current)
    state.player.position = { ...target.position }
    const targetArea = areaAt(current.areas, target.position.x, target.position.z)
    const targetRoutes = current.routes.filter((route) => route.toAreaId === targetArea.id)
    if (targetRoutes.some((route) => !current.builtRouteIds.includes(route.id))) return fail('locked_area', 'Build the route into that area before using its fairy ring.')
    return { state, events: [event(state, tick, { type: 'fairy_ring_teleported', sourceRingId: source.id, targetRingId: target.id, position: { ...target.position } })] }
  }

  if (intent.type === 'buy_store_listing') {
    const store = current.stores.find((candidate) => candidate.id === intent.storeId)
    const listing = store?.listings.find((candidate) => candidate.id === intent.listingId)
    if (!store || !listing) return fail('not_found', 'Store listing does not exist.')
    if (distance(current.player.position, store.position) > INTERACT_DISTANCE) return fail('too_far', 'Store is out of reach.')
    if (listing.stock < 1) return fail('out_of_stock', 'Store listing is out of stock.')
    if (current.player.coins < listing.price) return fail('insufficient_coins', 'Not enough coins.')
    if (inventoryCount(current.player) + reservedCount(current.player) + 1 > current.player.backpackCapacity) return fail('capacity', 'Backpack is full.')
    const state = cloneState(current)
    const nextListing = state.stores.find((candidate) => candidate.id === store.id)!.listings.find((candidate) => candidate.id === listing.id)!
    state.player.coins -= listing.price
    nextListing.stock -= 1
    addItem(state.player, listing.itemId, 1)
    return { state, events: [event(state, tick, { type: 'store_item_bought', storeId: store.id, listingId: listing.id, itemId: listing.itemId, price: listing.price })] }
  }

  if (intent.type === 'sell_to_store') {
    if (!Number.isSafeInteger(intent.quantity) || intent.quantity < 1) return fail('invalid_value', 'Sale quantity must be a positive whole number.')
    const store = current.stores.find((candidate) => candidate.id === intent.storeId)
    if (!store) return fail('not_found', 'Store does not exist.')
    const unitPrice = storeSellUnitPrice(store.id, intent.itemId)
    if (unitPrice === null) return fail('invalid_value', 'This store cannot buy that item.')
    if (distance(current.player.position, store.position) > INTERACT_DISTANCE) return fail('too_far', 'Store is out of reach.')
    const owned = owns(current.player, intent.itemId)
    if (owned < intent.quantity) return fail('not_owned', 'Not enough items to sell.')
    if (owned - intent.quantity < equippedCount(current.player, intent.itemId)) return fail('not_owned', 'Equipped items cannot be sold.')
    const totalPrice = intent.quantity * unitPrice
    if (!Number.isSafeInteger(current.player.coins + totalPrice)) return fail('invalid_value', 'Sale total exceeds the coin range.')
    const state = cloneState(current)
    removeItem(state.player, intent.itemId, intent.quantity)
    state.player.coins += totalPrice
    return { state, events: [event(state, tick, { type: 'store_item_sold', storeId: store.id, itemId: intent.itemId, quantity: intent.quantity, unitPrice, totalPrice })] }
  }

  if (intent.type === 'equip_item') {
    if (owns(current.player, intent.itemId) < 1) return fail('not_owned', 'Item is not in the backpack.')
    if (!canEquipItem(intent.itemId, intent.slot)) return fail('wrong_slot', 'Item cannot use that equipment slot.')
    if (equippedCount(current.player, intent.itemId, intent.slot) >= owns(current.player, intent.itemId)) return fail('not_owned', 'No unassigned copy of this item is available.')
    const state = cloneState(current)
    state.player.equipment[intent.slot] = intent.itemId
    return { state, events: [event(state, tick, { type: 'item_equipped', itemId: intent.itemId, slot: intent.slot })] }
  }

  if (intent.type === 'unequip_item') {
    if (!equipmentSlots.includes(intent.slot)) return fail('invalid_value', 'Equipment slot is invalid.')
    const itemId = current.player.equipment[intent.slot]
    if (!itemId) return fail('invalid_value', 'Equipment slot is empty.')
    const state = cloneState(current)
    state.player.equipment[intent.slot] = null
    return { state, events: [event(state, tick, { type: 'item_unequipped', itemId, slot: intent.slot })] }
  }

  if (intent.type === 'create_trade_listing') {
    if (!Number.isInteger(intent.slotIndex) || intent.slotIndex < 0 || intent.slotIndex > 3 || !Number.isInteger(intent.quantity) || intent.quantity < 1 || !finite(intent.unitPrice) || intent.unitPrice < 1) return fail('invalid_value', 'Trade slot, quantity, and price must be valid.')
    const slot = current.player.tradeSlots[intent.slotIndex]
    if (slot.itemId !== null) return fail('trade_slot_unavailable', 'Trade slot is occupied.')
    if (owns(current.player, intent.itemId) < intent.quantity) return fail('not_owned', 'Not enough items to reserve.')
    if (owns(current.player, intent.itemId) - intent.quantity < equippedCount(current.player, intent.itemId)) return fail('not_owned', 'Equipped items cannot be listed for trade.')
    const state = cloneState(current)
    removeItem(state.player, intent.itemId, intent.quantity)
    state.player.tradeSlots[intent.slotIndex] = { slotIndex: intent.slotIndex as 0 | 1 | 2 | 3, itemId: intent.itemId, quantity: intent.quantity, unitPrice: intent.unitPrice }
    return { state, events: [event(state, tick, { type: 'trade_listing_created', slotIndex: intent.slotIndex, itemId: intent.itemId, quantity: intent.quantity, unitPrice: intent.unitPrice })] }
  }

  if (!Number.isInteger(intent.slotIndex) || intent.slotIndex < 0 || intent.slotIndex > 3) return fail('invalid_value', 'Trade slot must be between zero and three.')
  const slot = current.player.tradeSlots[intent.slotIndex]
  if (slot.itemId === null) return fail('trade_slot_unavailable', 'Trade slot is already empty.')
  const state = cloneState(current)
  state.player.tradeSlots[intent.slotIndex] = { slotIndex: intent.slotIndex as 0 | 1 | 2 | 3, itemId: null, quantity: 0, unitPrice: 0 }
  if (!addItem(state.player, slot.itemId, slot.quantity)) return fail('capacity', 'Backpack cannot accept the escrowed item.')
  return { state, events: [event(state, tick, { type: 'trade_listing_cancelled', slotIndex: intent.slotIndex, itemId: slot.itemId, quantity: slot.quantity })] }
}

export function createWizardWorld(seed: string, profile?: GenerationProfile): WizardWorldState { return createGeneratedWorld(seed, profile) }

export function advanceWizardWorld(state: WizardWorldState, intents: readonly WizardIntent[]): WizardAdvanceResult {
  let next = cloneState(state)
  const events: WizardEvent[] = []
  const rejections: IntentRejection[] = []
  const tick = state.tick + 1
  intents.forEach((intent, index) => {
    const result = applyIntent(next, intent, index, tick)
    next = result.state
    if (result.events) events.push(...result.events)
    if (result.rejection) rejections.push(result.rejection)
  })
  for (const recipe of next.recipes) {
    if (next.unlockedRecipeIds.includes(recipe.id)) continue
    if (next.player.level < recipe.minimumLevel || (recipe.prerequisiteRouteId && !next.builtRouteIds.includes(recipe.prerequisiteRouteId))) continue
    next.unlockedRecipeIds.push(recipe.id)
    next.unlockedRecipeIds.sort()
    events.push(event(next, tick, { type: 'recipe_unlocked', recipeId: recipe.id }))
  }
  const ground = terrainHeightAt(next.tiles, next.player.position.x, next.player.position.z)
  if (next.player.position.y > ground || next.player.verticalVelocity > 0) {
    next.player.position.y += next.player.verticalVelocity * next.fixedStepMs / 1_000
    next.player.verticalVelocity -= 9.8 * next.fixedStepMs / 1_000
    if (next.player.position.y <= ground) {
      next.player.position.y = ground
      next.player.verticalVelocity = 0
    }
  } else {
    next.player.position.y = ground
    next.player.verticalVelocity = 0
  }
  next.tick = tick
  next.rng.simulation = stepRng(next.rng.simulation)
  return { state: next, events, rejections }
}

export function createWizardProjection(state: WizardWorldState): WizardProjection {
  const nearby = <T extends { position: Vec3 }>(values: readonly T[]) => values.filter((value) => distance(state.player.position, value.position) <= 6)
  const currentTile = tileAt(state, state.player.position, areaAt(state.areas, state.player.position.x, state.player.position.z).id)!
  return JSON.parse(JSON.stringify({
    tick: state.tick,
    player: state.player,
    currentTile,
    nearbyResources: nearby(state.resources).filter((resource) => !resource.depleted),
    nearbyFairyRings: nearby(state.fairyRings).map((ring) => ({ ...ring, discovered: state.player.discoveredRingIds.includes(ring.id) })),
    nearbyStores: nearby(state.stores),
    nearbyRoutes: state.routes.filter((route) => routeEndpointDistance(state.player.position, route) <= 6),
    builtRouteIds: state.builtRouteIds,
    unlockedRecipeIds: state.unlockedRecipeIds,
    discoveredTileIds: state.discoveredTileIds,
  })) as WizardProjection
}
