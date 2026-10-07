import { createGeneratedWorld, terrainHeightAt } from './generation'
import { canEquipItem } from './world'
import type { EquipmentSlot, ItemId, RecipeId, RouteId, WizardWorldState } from './types'

const itemIds: ItemId[] = [
  'woodcutters_axe', 'logs', 'marsh_herb', 'stone', 'iron_ore', 'apprentice_hat',
  'traveler_tunic', 'trail_leggings', 'leather_boots', 'oak_wand', 'wooden_shield',
]
const equipmentSlots: EquipmentSlot[] = ['head', 'chest', 'legs', 'feet', 'mainHand', 'offHand']
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const number = (value: unknown, fallback: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback
const integer = (value: unknown, fallback: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) =>
  Math.floor(number(value, fallback, minimum, maximum))
const vec3 = (value: unknown, fallback: { x: number; y: number; z: number }) => record(value) ? ({
  x: number(value.x, fallback.x, -1_000, 1_000),
  y: number(value.y, fallback.y, -1_000, 1_000),
  z: number(value.z, fallback.z, -1_000, 1_000),
}) : { ...fallback }
const itemId = (value: unknown): value is ItemId => typeof value === 'string' && itemIds.includes(value as ItemId)
const validIds = <T extends string>(value: unknown, allowed: readonly T[], required: readonly T[] = []): T[] => {
  const values = Array.isArray(value) ? value.filter((id): id is T => typeof id === 'string' && allowed.includes(id as T)) : []
  return [...new Set([...required, ...values])].sort()
}

export function serializeWizardWorld(state: WizardWorldState): string {
  return JSON.stringify(state)
}

export function restoreWizardWorld(serialized: string): WizardWorldState {
  let raw: unknown
  try { raw = JSON.parse(serialized) } catch { raw = {} }
  const source = record(raw) ? raw : {}
  const seed = typeof source.seed === 'string' && source.seed.length > 0 ? source.seed : 'wizard-realms'
  const profile = source.generationProfile === 'greenway-expanded-v1' ? 'greenway-expanded-v1' : 'greenway-classic-v1'
  const base = createGeneratedWorld(seed, profile)
  const state: WizardWorldState = JSON.parse(JSON.stringify(base)) as WizardWorldState
  state.tick = integer(source.tick, base.tick)
  state.eventSequence = integer(source.eventSequence, base.eventSequence)
  state.builtRouteIds = validIds<RouteId>(source.builtRouteIds, base.routes.map((route) => route.id))
  state.unlockedRecipeIds = validIds<RecipeId>(source.unlockedRecipeIds, base.recipes.map((recipe) => recipe.id), ['greenway_ladder'])
  state.discoveredTileIds = validIds(source.discoveredTileIds, base.tiles.map((tile) => tile.id), base.discoveredTileIds)

  if (record(source.rng)) {
    state.rng.generation = integer(source.rng.generation, base.rng.generation, 1, 0xffffffff)
    state.rng.simulation = integer(source.rng.simulation, base.rng.simulation, 1, 0xffffffff)
  }

  const rawTiles = Array.isArray(source.tiles) ? source.tiles : []
  if (rawTiles.length === base.tiles.length) state.tiles = base.tiles.map((fallback, index) => {
    const value = record(rawTiles[index]) ? rawTiles[index] : {}
    return { ...fallback, center: vec3(value.center, fallback.center), elevation: number(value.elevation, fallback.elevation, 0, 1), temperature: number(value.temperature, fallback.temperature, 0, 1), moisture: number(value.moisture, fallback.moisture, 0, 1) }
  })

  const rawResources = Array.isArray(source.resources) ? source.resources : []
  if (rawResources.length > 0) state.resources = base.resources.map((fallback) => {
    const saved = rawResources.find((candidate) => record(candidate) && candidate.id === fallback.id)
    const value = record(saved) ? saved : {}
    const maxHealth = integer(value.maxHealth, fallback.maxHealth, 1, 1_000)
    const health = integer(value.health, fallback.health, 0, maxHealth)
    return { ...fallback, position: vec3(value.position, fallback.position), maxHealth, health, depleted: typeof value.depleted === 'boolean' ? value.depleted || health === 0 : health === 0 }
  })

  const rawRings = Array.isArray(source.fairyRings) ? source.fairyRings : []
  if (rawRings.length === base.fairyRings.length) state.fairyRings = base.fairyRings.map((fallback, index) => {
    const value = record(rawRings[index]) ? rawRings[index] : {}
    return { ...fallback, position: vec3(value.position, fallback.position) }
  })

  const rawStores = Array.isArray(source.stores) ? source.stores : []
  if (rawStores.length === 2) state.stores = base.stores.map((fallback, storeIndex) => {
    const value = record(rawStores[storeIndex]) ? rawStores[storeIndex] : {}
    const rawListings = Array.isArray(value.listings) ? value.listings : []
    const listings = rawListings.length === fallback.listings.length
      ? fallback.listings.map((listing, listingIndex) => {
        const rawListing = record(rawListings[listingIndex]) ? rawListings[listingIndex] : {}
        return { ...listing, price: integer(rawListing.price, listing.price), stock: integer(rawListing.stock, listing.stock) }
      }) : fallback.listings
    return { ...fallback, position: vec3(value.position, fallback.position), listings }
  }) as WizardWorldState['stores']

  if (record(source.player)) {
    const player = source.player
    state.player.position = vec3(player.position, base.player.position)
    state.player.verticalVelocity = number(player.verticalVelocity, 0, -50, 50)
    state.player.yaw = number(player.yaw, base.player.yaw, -1_000_000, 1_000_000)
    state.player.pitch = number(player.pitch, base.player.pitch, -Math.PI / 2, Math.PI / 2)
    state.player.coins = integer(player.coins, base.player.coins)
    state.player.xp = integer(player.xp, base.player.xp)
    state.player.level = 1 + Math.floor(state.player.xp / 100)
    state.player.backpackCapacity = integer(player.backpackCapacity, base.player.backpackCapacity, 1, 1_000)
    if (Array.isArray(player.inventory)) state.player.inventory = player.inventory.flatMap((entry) => {
      if (!record(entry) || !itemId(entry.itemId)) return []
      const quantity = integer(entry.quantity, 0, 0, state.player.backpackCapacity)
      return quantity > 0 ? [{ itemId: entry.itemId, quantity }] : []
    })
    state.player.discoveredRingIds = Array.isArray(player.discoveredRingIds)
      ? player.discoveredRingIds.filter((id): id is string => typeof id === 'string' && state.fairyRings.some((ring) => ring.id === id)).filter((id, index, values) => values.indexOf(id) === index)
      : []
    const rawTradeSlots = Array.isArray(player.tradeSlots) ? player.tradeSlots : []
    if (rawTradeSlots.length === 4) state.player.tradeSlots = base.player.tradeSlots.map((fallback, index) => {
      const value = record(rawTradeSlots[index]) ? rawTradeSlots[index] : {}
      const listedItem = itemId(value.itemId) ? value.itemId : null
      return listedItem ? { slotIndex: fallback.slotIndex, itemId: listedItem, quantity: integer(value.quantity, 1, 1, state.player.backpackCapacity), unitPrice: integer(value.unitPrice, 1, 1) } : fallback
    }) as WizardWorldState['player']['tradeSlots']
    let remaining = state.player.backpackCapacity
    state.player.inventory = state.player.inventory.flatMap((stack) => {
      const quantity = Math.min(stack.quantity, remaining)
      remaining -= quantity
      return quantity > 0 ? [{ ...stack, quantity }] : []
    })
    state.player.tradeSlots = state.player.tradeSlots.map((slot) => {
      const quantity = Math.min(slot.quantity, remaining)
      remaining -= quantity
      return slot.itemId && quantity > 0 ? { ...slot, quantity } : base.player.tradeSlots[slot.slotIndex]
    }) as WizardWorldState['player']['tradeSlots']
    const requestedEquipment = record(player.equipment) ? player.equipment : {}
    equipmentSlots.forEach((slot) => {
      const requested = itemId(requestedEquipment[slot]) ? requestedEquipment[slot] as ItemId : null
      const owned = requested ? state.player.inventory
        .filter((stack) => stack.itemId === requested).reduce((sum, stack) => sum + stack.quantity, 0) : 0
      const assigned = requested ? equipmentSlots
        .filter((candidate) => candidate !== slot && state.player.equipment[candidate] === requested).length : 0
      state.player.equipment[slot] = requested && canEquipItem(requested, slot) && assigned < owned ? requested : null
    })
  }
  const highlandRecipe = state.recipes.find((recipe) => recipe.id === 'highland_bridge')!
  const highlandProgressValid = state.builtRouteIds.includes('greenway_ladder') && state.player.level >= highlandRecipe.minimumLevel
  if (!highlandProgressValid) {
    state.builtRouteIds = state.builtRouteIds.filter((id) => id !== 'highland_bridge')
    state.unlockedRecipeIds = state.unlockedRecipeIds.filter((id) => id !== 'highland_bridge')
  } else if (!state.unlockedRecipeIds.includes('highland_bridge')) {
    state.unlockedRecipeIds.push('highland_bridge')
    state.unlockedRecipeIds.sort()
  }
  state.resources.forEach((resource) => { resource.position.y = terrainHeightAt(state.tiles, resource.position.x, resource.position.z) })
  state.fairyRings.forEach((ring) => { ring.position.y = terrainHeightAt(state.tiles, ring.position.x, ring.position.z) })
  state.stores.forEach((store) => { store.position.y = terrainHeightAt(state.tiles, store.position.x, store.position.z) })
  const ground = terrainHeightAt(state.tiles, state.player.position.x, state.player.position.z)
  if (state.player.position.y < ground) {
    state.player.position.y = ground
    state.player.verticalVelocity = 0
  }
  return state
}
