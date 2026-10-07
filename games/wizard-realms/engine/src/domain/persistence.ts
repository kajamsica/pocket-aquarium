import { createGeneratedWorld } from './generation'
import type { EquipmentSlot, ItemId, WizardWorldState } from './types'

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

export function serializeWizardWorld(state: WizardWorldState): string {
  return JSON.stringify(state)
}

export function restoreWizardWorld(serialized: string): WizardWorldState {
  let raw: unknown
  try { raw = JSON.parse(serialized) } catch { raw = {} }
  const source = record(raw) ? raw : {}
  const seed = typeof source.seed === 'string' && source.seed.length > 0 ? source.seed : 'wizard-realms'
  const base = createGeneratedWorld(seed)
  const state: WizardWorldState = JSON.parse(JSON.stringify(base)) as WizardWorldState
  state.tick = integer(source.tick, base.tick)
  state.eventSequence = integer(source.eventSequence, base.eventSequence)

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
  if (rawResources.length === base.resources.length) state.resources = base.resources.map((fallback, index) => {
    const value = record(rawResources[index]) ? rawResources[index] : {}
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
    if (record(player.equipment)) equipmentSlots.forEach((slot) => {
      const equipped = player.equipment as Record<string, unknown>
      state.player.equipment[slot] = equipped[slot] === null || itemId(equipped[slot]) ? equipped[slot] as ItemId | null : null
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
  }
  return state
}
