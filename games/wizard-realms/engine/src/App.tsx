import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  advanceWizardWorld,
  createWizardProjection,
  createWizardWorld,
  restoreWizardWorld,
  serializeWizardWorld,
  type IntentRejection,
  type ItemId,
  type WizardEvent,
  type WizardIntent,
  type WizardWorldState,
} from './domain'
import {
  WizardSurface,
  type WizardViewIntent,
  type WizardViewProjection,
} from './view'
import type { EquipmentSlot } from './view/contracts'
import { areaAt } from './domain/generation'

const WORLD_SEED = 'greenway-alpha'
const SAVE_KEY = 'wizard-realms:world:v2'
const LEGACY_SAVE_KEY = 'wizard-realms:world:v1'
const EXPANDED_SAVE_KEY = 'wizard-realms:world:expanded:v1'
const CLASSIC_PROFILE = 'greenway-classic-v1'
const EXPANDED_PROFILE = 'greenway-expanded-v1'
const FIXED_STEP_MS = 50
const MOVE_METERS_PER_TICK = 0.16
const TILE_METERS = 4
// ~149 deg/s: a 180-degree turn takes ~1.2 s instead of ~3.5 s at the previous 0.045.
export const PIVOT_RADIANS_PER_TICK = 0.13
const INTERACTION_RANGE = 3
const WELCOME_MESSAGE = 'Welcome to Greenway. Equip your axe and explore the region.'
// Portrait mobile vertical bands, measured from the bottom edge (plus safe-area inset):
//   0-135   .wr-touch cluster (14px inset + two 58px d-pad rows + 5px gap)
//   142-222 objective pill (max-height 80px; long text scrolls inside the pill)
//   230+    .wr-prompt / .wr-context / .wr-events, relocated from the view's 148-152px anchors
export const OBJECTIVE_STYLES = `
.wr-objective{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:4;display:flex;gap:10px;align-items:center;padding:5px 5px 5px 10px;border-radius:999px;background:#101a17dd;color:#d8c987;font:11px system-ui;white-space:nowrap}
.wr-objective b{color:#f5d889;letter-spacing:.12em}
.wr-objective button{padding:3px 9px;border:1px solid #cfb66b55;border-radius:999px;background:#374b3d;color:#f8e8b2;font:inherit;cursor:pointer}
.wr-save-warning{position:absolute;z-index:12;top:60px;left:50%;transform:translateX(-50%);box-sizing:border-box;width:max-content;max-width:calc(100vw - 24px);margin:0;padding:6px 10px;border:1px solid #e3a277;border-radius:8px;background:#4b2824f2;color:#fff2db;font:600 12px/1.3 system-ui;text-align:center;pointer-events:none}
@media(max-width:719px),(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-objective{left:10px;right:10px;bottom:calc(142px + env(safe-area-inset-bottom,0px));transform:none;box-sizing:border-box;max-height:80px;border-radius:12px;white-space:normal;font-size:12px;line-height:1.3}.wr-objective span{flex:1;min-width:0;max-height:70px;overflow-y:auto}.wr-objective button{flex:none;min-width:44px;min-height:44px}.wr-surface .wr-prompt,.wr-surface .wr-context{bottom:calc(230px + env(safe-area-inset-bottom,0px))}.wr-surface .wr-context{box-sizing:border-box;max-height:max(140px,calc(100vh - 340px));overflow-y:auto}}
@media(max-width:719px) and (max-height:590px){.wr-surface:has(.wr-context) .wr-backpack,.wr-surface .wr-events{display:none}}
@media(max-width:719px) and (max-height:400px){.wr-surface{min-height:0}.wr-surface .wr-prompt,.wr-surface .wr-context{box-sizing:border-box;top:54px;bottom:auto;max-height:80px;overflow-y:auto}}
@media(min-width:440px) and (max-width:719px) and (max-height:400px){.wr-surface .wr-backpack,.wr-surface .wr-context{left:8px;top:54px;max-height:80px;width:220px;overflow-y:auto;transform:none}.wr-surface .wr-prompt{left:auto;right:72px;max-width:160px;transform:none}}
@media(min-width:720px) and (max-width:900px) and (max-height:420px){.wr-surface .wr-context{top:54px;bottom:auto;max-height:calc(100vh - 254px);overflow-y:auto}}
@media(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-objective{left:210px;right:96px;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:none}.wr-surface .wr-prompt{top:66px;bottom:auto}}
`

const ITEM_NAMES: Record<ItemId, string> = {
  woodcutters_axe: 'Woodcutter axe', logs: 'Greenway logs', marsh_herb: 'Marsh herb',
  stone: 'Stone', iron_ore: 'Iron ore', apprentice_hat: 'Apprentice hat',
  traveler_tunic: 'Traveler tunic', trail_leggings: 'Trail leggings',
  leather_boots: 'Leather boots', oak_wand: 'Oak wand', wooden_shield: 'Wooden shield',
}
const EQUIPPABLE: Partial<Record<ItemId, readonly EquipmentSlot[]>> = {
  woodcutters_axe: ['mainHand'], apprentice_hat: ['head'], traveler_tunic: ['chest'],
  trail_leggings: ['legs'], leather_boots: ['feet'], oak_wand: ['mainHand', 'offHand'],
  wooden_shield: ['offHand'],
}
const TERRAIN_COLORS = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' } as const

type RecentMessage = { id: number; text: string }
type WorldProfile = WizardWorldState['generationProfile']

export function worldProfileForSearch(search: string): WorldProfile {
  return new URLSearchParams(search).get('devRegion') === 'expanded' ? EXPANDED_PROFILE : CLASSIC_PROFILE
}

function isLoadableSave(saved: string, profile: WorldProfile): boolean {
  try {
    const value = JSON.parse(saved) as { schemaVersion?: unknown; seed?: unknown; generationProfile?: unknown }
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.seed !== 'string' || !value.seed) return false
    // Saves written before profiles existed belong to the classic world.
    const savedProfile = value.generationProfile === undefined ? CLASSIC_PROFILE : value.generationProfile
    return savedProfile === profile && (value.schemaVersion === 'wizard-world/v2'
      || value.schemaVersion === 'wizard-world/v1' && profile === CLASSIC_PROFILE)
  } catch {
    return false
  }
}

function activeSave(storage: Pick<Storage, 'getItem'>, profile: WorldProfile): string | null {
  return profile === EXPANDED_PROFILE ? storage.getItem(EXPANDED_SAVE_KEY) : storage.getItem(SAVE_KEY) ?? storage.getItem(LEGACY_SAVE_KEY)
}

function hasIncompatibleSave(storage: Pick<Storage, 'getItem'>, profile: WorldProfile): boolean {
  const saved = activeSave(storage, profile)
  return saved !== null && !isLoadableSave(saved, profile)
}

export function loadWorld(storage: Pick<Storage, 'getItem'> = window.localStorage, profile: WorldProfile = CLASSIC_PROFILE): WizardWorldState {
  const saved = activeSave(storage, profile)
  return saved && isLoadableSave(saved, profile) ? restoreWizardWorld(saved) : createWizardWorld(WORLD_SEED, profile)
}

export function persistWorld(storage: Pick<Storage, 'getItem' | 'setItem'>, state: WizardWorldState, profile: WorldProfile = CLASSIC_PROFILE): boolean {
  const key = profile === EXPANDED_PROFILE ? EXPANDED_SAVE_KEY : SAVE_KEY
  if (state.generationProfile !== profile || hasIncompatibleSave(storage, profile)) return false
  storage.setItem(key, serializeWizardWorld(state))
  return true
}

export function resetSavedWorld(storage: Pick<Storage, 'setItem' | 'removeItem'>, seed = WORLD_SEED, createWorld: typeof createWizardWorld = createWizardWorld, profile: WorldProfile = CLASSIC_PROFILE): WizardWorldState {
  const fresh = createWorld(seed, profile)
  storage.setItem(profile === EXPANDED_PROFILE ? EXPANDED_SAVE_KEY : SAVE_KEY, serializeWizardWorld(fresh))
  if (profile === CLASSIC_PROFILE) storage.removeItem(LEGACY_SAVE_KEY)
  return fresh
}

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

const owned = (state: WizardWorldState, itemId: ItemId) =>
  state.player.inventory.filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.quantity, 0)
const axeEquipped = (state: WizardWorldState) => state.player.equipment.mainHand === 'woodcutters_axe'

export function objectiveFor(state: WizardWorldState): string {
  const logs = owned(state, 'logs')
  const gather = (cost: number) => `Gather logs from Greenway oaks (${Math.min(logs, cost)}/${cost})`
  const greenwayRing = state.player.discoveredRingIds.includes('ring-greenway')
  const highlandRing = state.player.discoveredRingIds.includes('ring-highland')
  if (greenwayRing && highlandRing) return areaAt(state.areas, state.player.position.x, state.player.position.z).id === 'greenway'
    ? 'Quest complete: fairy rings linked. Explore, trade, or travel to Highland again.'
    : 'Quest complete: both fairy rings are linked. Use the Highland Ring to travel home.'
  if (highlandRing) return 'Return to the Greenway and discover its fairy ring near the start to link travel home.'
  if (state.builtRouteIds.includes('highland_bridge')) return 'Cross the Highland bridge east and discover the Highland fairy ring.'
  if (state.builtRouteIds.includes('greenway_ladder')) return logs >= 6 ? 'Build the Highland bridge east along the ridge (6 logs).' : `${gather(6)}, then build the Highland bridge east along the ridge.`
  if (axeEquipped(state)) return logs >= 4 ? 'Build the Greenway ladder north (4 logs).' : `${gather(4)}, then build the Greenway ladder north.`
  return owned(state, 'woodcutters_axe') > 0 ? 'Equip the woodcutter axe from your backpack.' : 'Buy a woodcutter axe at Greenway Outfitters.'
}

function closestInteraction(state: WizardWorldState) {
  const candidates = [
    ...state.resources.filter((resource) => resource.kind === 'tree' && !resource.depleted)
      .map((resource) => ({ distance: distance(state.player.position, resource.position), kind: 'resource' as const, target: resource })),
    ...state.fairyRings.map((ring) => ({ distance: distance(state.player.position, ring.position), kind: 'fairy-ring' as const, target: ring })),
    ...state.stores.map((store) => ({ distance: distance(state.player.position, store.position), kind: 'store' as const, target: store })),
    ...state.routes.map((route) => ({ distance: Math.min(distance(state.player.position, route.from), distance(state.player.position, route.to)), kind: 'route' as const, target: route })),
  ].filter((candidate) => candidate.distance <= INTERACTION_RANGE)
  return candidates.sort((left, right) => left.distance - right.distance)[0] ?? null
}

export function retainOpenStoreId(state: WizardWorldState, openStoreId: string | null): string | null {
  const store = state.stores.find((candidate) => candidate.id === openStoreId)
  return store && distance(state.player.position, store.position) <= INTERACTION_RANGE ? store.id : null
}

function itemStack(itemId: ItemId, quantity: number) {
  return {
    id: `inventory-${itemId}`, itemId, name: ITEM_NAMES[itemId], quantity,
    equippableSlots: EQUIPPABLE[itemId], suggestedTradePrice: itemId === 'logs' ? 4 : 12,
  }
}

function itemAmountName(itemId: ItemId, quantity: number) {
  return itemId === 'logs' && quantity === 1 ? 'Greenway log' : ITEM_NAMES[itemId]
}

function eventText(event: WizardEvent): string {
  switch (event.type) {
    case 'resource_damaged': return 'The tree shudders under your axe.'
    case 'resource_harvested': return `Gathered ${event.quantity} ${itemAmountName(event.itemId, event.quantity)}.`
    case 'fairy_ring_discovered': return 'A fairy ring answers your presence.'
    case 'fairy_ring_teleported': return 'The mushroom path folds the world around you.'
    case 'store_item_bought': return `Purchased ${ITEM_NAMES[event.itemId]}.`
    case 'item_equipped': return `Equipped ${ITEM_NAMES[event.itemId]}.`
    case 'trade_listing_created': return `Listed ${event.quantity} ${itemAmountName(event.itemId, event.quantity)} for trade.`
    case 'trade_listing_cancelled': return `Returned ${event.quantity} ${itemAmountName(event.itemId, event.quantity)} to your backpack.`
    case 'player_jumped': return 'You spring over the trail.'
    case 'route_built': return `Built ${event.routeId === 'greenway_ladder' ? 'the Greenway ladder' : 'the Highland bridge'} for ${event.logCost} logs.`
    case 'route_used': return 'You cross the completed route.'
    case 'recipe_unlocked': return 'A new construction recipe is ready.'
    case 'tile_discovered': return 'The map reveals a new tile.'
    default: return ''
  }
}

export function toViewProjection(state: WizardWorldState, messages: readonly RecentMessage[], openStoreId: string | null = null): WizardViewProjection {
  const domain = createWizardProjection(state)
  const discoveredTileIds = new Set(state.discoveredTileIds)
  const discoveredRingIds = new Set(domain.player.discoveredRingIds)
  const activeResourceTileIds = new Set(state.resources.filter((resource) => !resource.depleted).map((resource) => resource.tileId))
  const discoveredAreaIds = new Set<string>()
  const tileIdsByGrid = new Map<string, string>()
  let minGridX = Infinity, maxGridX = -Infinity, minGridZ = Infinity, maxGridZ = -Infinity
  const playerAreaId = areaAt(state.areas, state.player.position.x, state.player.position.z).id
  let currentTile = state.tiles[0], playerTileDistance = Infinity
  for (const tile of state.tiles) {
    tileIdsByGrid.set(`${tile.gridX}:${tile.gridZ}`, tile.id)
    minGridX = Math.min(minGridX, tile.gridX); maxGridX = Math.max(maxGridX, tile.gridX)
    minGridZ = Math.min(minGridZ, tile.gridZ); maxGridZ = Math.max(maxGridZ, tile.gridZ)
    const tileAreaId = areaAt(state.areas, tile.center.x, tile.center.z).id
    if (discoveredTileIds.has(tile.id)) discoveredAreaIds.add(tileAreaId)
    if (tileAreaId === playerAreaId) {
      const tileDistance = (state.player.position.x - tile.center.x) ** 2 + (state.player.position.z - tile.center.z) ** 2
      if (tileDistance < playerTileDistance) { currentTile = tile; playerTileDistance = tileDistance }
    }
  }
  const origin = state.tiles[0]
  const tileIdAt = (position: { x: number; z: number }) => {
    const gridX = Math.max(minGridX, Math.min(maxGridX, Math.round(origin.gridX + (position.x - origin.center.x) / TILE_METERS)))
    const gridZ = Math.max(minGridZ, Math.min(maxGridZ, Math.round(origin.gridZ + (position.z - origin.center.z) / TILE_METERS)))
    return tileIdsByGrid.get(`${gridX}:${gridZ}`)
  }
  const areaDiscovered = (position: { x: number; z: number }) => discoveredAreaIds.has(areaAt(state.areas, position.x, position.z).id)
  const storeTileIds = new Set(state.stores.filter((store) => areaDiscovered(store.position)).map((store) => tileIdAt(store.position)))
  const ringTileIds = new Set(state.fairyRings.filter((ring) => areaDiscovered(ring.position)).map((ring) => tileIdAt(ring.position)))
  const unlockedRouteIds = new Set(state.recipes.filter((recipe) => state.unlockedRecipeIds.includes(recipe.id)).map((recipe) => recipe.routeId))
  const routeSiteTileIds = new Set(state.routes.filter((route) => unlockedRouteIds.has(route.id) && !state.builtRouteIds.includes(route.id)).map((route) => tileIdAt(route.from)))
  const activeStoreId = retainOpenStoreId(state, openStoreId)
  const interaction = activeStoreId
    ? { kind: 'store' as const, target: state.stores.find((store) => store.id === activeStoreId)! }
    : closestInteraction(state)
  const inventory = domain.player.inventory.map((stack) => itemStack(stack.itemId, stack.quantity))
  const equipped = (slot: EquipmentSlot) => {
    const itemId = domain.player.equipment[slot]
    return itemId ? itemStack(itemId, 1) : null
  }
  return {
    seed: state.seed,
    tick: domain.tick,
    player: { position: [domain.player.position.x, domain.player.position.y, domain.player.position.z], yaw: domain.player.yaw, pitch: domain.player.pitch },
    terrain: state.tiles.map((tile) => ({ id: tile.id, position: [tile.center.x, tile.center.y, tile.center.z], size: [TILE_METERS, TILE_METERS], height: 0.7 + tile.elevation * 3, climate: tile.biome, color: TERRAIN_COLORS[tile.terrain] })),
    resources: state.resources.map((resource) => ({ id: resource.id, kind: resource.kind === 'stone' ? 'other' : resource.kind, label: resource.kind === 'tree' ? 'Greenway oak' : resource.kind, position: [resource.position.x, resource.position.y, resource.position.z], available: !resource.depleted })),
    fairyRings: state.fairyRings.map((ring) => ({
      id: ring.id, label: ring.name, position: [ring.position.x, ring.position.y, ring.position.z],
      discovered: discoveredRingIds.has(ring.id),
      destinations: state.fairyRings.filter((target) => target.id !== ring.id).map((target) => ({ ringId: target.id, label: target.name, discovered: discoveredRingIds.has(target.id) })),
    })),
    routes: state.routes.map((route) => {
      const recipe = state.recipes.find((candidate) => candidate.routeId === route.id)!
      return { id: route.id, label: route.name, from: [route.from.x, route.from.y, route.from.z], to: [route.to.x, route.to.y, route.to.z], built: state.builtRouteIds.includes(route.id), unlocked: state.unlockedRecipeIds.includes(recipe.id), logCost: recipe.logCost }
    }),
    map: {
      tiles: state.tiles.map((tile) => {
        const discovered = discoveredTileIds.has(tile.id)
        return {
          id: tile.id, gridX: tile.gridX, gridZ: tile.gridZ,
          terrain: discovered ? tile.terrain : null, biome: discovered ? tile.biome : null, discovered,
          hasResource: discovered && activeResourceTileIds.has(tile.id),
          hasStore: discovered && storeTileIds.has(tile.id),
          hasRing: discovered && ringTileIds.has(tile.id),
          hasRouteSite: discovered && routeSiteTileIds.has(tile.id),
        }
      }),
      player: { gridX: currentTile.gridX, gridZ: currentTile.gridZ, yaw: state.player.yaw },
    },
    stores: state.stores.map((store) => ({ id: store.id, name: store.name, position: [store.position.x, store.position.y, store.position.z], listings: store.listings.map((listing) => ({ id: listing.id, name: ITEM_NAMES[listing.itemId], price: listing.price, stock: listing.stock })) })),
    openStoreId: activeStoreId,
    backpack: { capacity: domain.player.backpackCapacity, stacks: inventory },
    coins: domain.player.coins,
    experience: { xp: domain.player.xp, nextLevelXp: domain.player.level * 100, level: domain.player.level },
    equipment: { head: equipped('head'), chest: equipped('chest'), legs: equipped('legs'), feet: equipped('feet'), mainHand: equipped('mainHand'), offHand: equipped('offHand') },
    tradeListings: domain.player.tradeSlots.map((slot) => slot.itemId ? ({ id: `trade-${slot.slotIndex}`, itemName: ITEM_NAMES[slot.itemId], quantity: slot.quantity, unitPrice: slot.unitPrice }) : null) as unknown as WizardViewProjection['tradeListings'],
    nearbyInteraction: interaction ? {
      kind: interaction.kind, targetId: interaction.target.id,
      label: interaction.kind === 'resource' ? 'Greenway oak' : interaction.target.name,
      action: interaction.kind === 'resource' ? (axeEquipped(state) ? 'Chop' : owned(state, 'woodcutters_axe') > 0 ? 'Equip axe' : 'Needs axe')
        : interaction.kind === 'store' ? activeStoreId ? 'Store open' : 'Open store'
        : interaction.kind === 'route' ? (state.builtRouteIds.includes(interaction.target.id) ? 'Cross' : state.unlockedRecipeIds.includes(interaction.target.id) ? 'Build' : 'Locked')
        : discoveredRingIds.has(interaction.target.id)
          ? state.fairyRings.some((ring) => ring.id !== interaction.target.id && discoveredRingIds.has(ring.id)) ? 'Choose destination' : 'Find another ring'
          : 'Discover',
      actionable: interaction.kind === 'resource' && (axeEquipped(state) || owned(state, 'woodcutters_axe') > 0)
        || (interaction.kind === 'store' && activeStoreId === null)
        || interaction.kind === 'route' && (state.builtRouteIds.includes(interaction.target.id) || state.unlockedRecipeIds.includes(interaction.target.id))
        || (interaction.kind === 'fairy-ring' && !discoveredRingIds.has(interaction.target.id)),
    } : null,
    recentEvents: messages.map((message) => message.text),
  }
}

export function intentForView(state: WizardWorldState, intent: Exclude<WizardViewIntent, { type: 'movement' }>, openStoreId: string | null = null): WizardIntent | null {
  if (intent.type === 'jump') return { type: 'jump' }
  if (intent.type === 'store.close') return null
  if (intent.type === 'interact') {
    if (retainOpenStoreId(state, openStoreId)) return null
    const interaction = closestInteraction(state)
    if (interaction?.kind === 'resource') {
      if (axeEquipped(state)) return { type: 'harvest', resourceId: interaction.target.id }
      return owned(state, 'woodcutters_axe') > 0 ? { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' } : null
    }
    if (interaction?.kind === 'fairy-ring' && !state.player.discoveredRingIds.includes(interaction.target.id)) return { type: 'discover_fairy_ring', ringId: interaction.target.id }
    if (interaction?.kind === 'route') return state.builtRouteIds.includes(interaction.target.id)
      ? { type: 'traverse_route', routeId: interaction.target.id }
      : { type: 'build_route', routeId: interaction.target.id }
    return null
  }
  if (intent.type === 'store.select-listing') return { type: 'buy_store_listing', storeId: intent.storeId, listingId: intent.listingId }
  if (intent.type === 'equipment.equip') return { type: 'equip_item', itemId: intent.stackId.replace('inventory-', '') as ItemId, slot: intent.slot }
  if (intent.type === 'trade.create-listing') return { type: 'create_trade_listing', slotIndex: intent.slot, itemId: intent.stackId.replace('inventory-', '') as ItemId, quantity: intent.quantity, unitPrice: intent.unitPrice }
  if (intent.type === 'trade.cancel-listing') return { type: 'cancel_trade_listing', slotIndex: intent.slot }
  return { type: 'teleport_fairy_ring', sourceRingId: intent.ringId, targetRingId: intent.destinationRingId }
}

export function movementIntent(state: WizardWorldState, vector: readonly [number, number]): WizardIntent | null {
  if (vector[1] === 0) return null
  const { yaw } = state.player
  const x = -vector[1] * Math.sin(yaw) * MOVE_METERS_PER_TICK
  return { type: 'move', delta: {
    x: Math.abs(x) < 1e-12 ? 0 : x,
    y: 0,
    z: -vector[1] * Math.cos(yaw) * MOVE_METERS_PER_TICK,
  } }
}

export function controlIntents(state: WizardWorldState, vector: readonly [number, number]): WizardIntent[] {
  const intents: WizardIntent[] = []
  const yawDelta = -vector[0] * PIVOT_RADIANS_PER_TICK
  if (yawDelta !== 0) intents.push({ type: 'look', yawDelta, pitchDelta: 0 })
  if (vector[1] !== 0) {
    const facing = { ...state, player: { ...state.player, yaw: state.player.yaw + yawDelta } }
    const movement = movementIntent(facing, vector)
    if (movement) intents.push(movement)
  }
  return intents
}

// Catch-up cap: at most 12 fixed steps (600 ms) per callback; any excess backlog is discarded
// rather than simulated, so a long stall cannot spiral into ever-longer batches.
export const MAX_CATCH_UP_STEPS = 12
export type StepClock = { lastMs: number | null; accumulatedMs: number }
export const IDLE_CLOCK: StepClock = { lastMs: null, accumulatedMs: 0 }

export function accumulateElapsed(clock: StepClock, nowMs: number): StepClock {
  const elapsed = clock.lastMs === null ? 0 : Math.max(0, nowMs - clock.lastMs)
  return { lastMs: nowMs, accumulatedMs: clock.accumulatedMs + elapsed }
}

export function stepBatch(world: WizardWorldState, queued: readonly WizardIntent[], movement: readonly [number, number], accumulatedMs: number) {
  let steps = Math.floor(accumulatedMs / FIXED_STEP_MS)
  let remainderMs = accumulatedMs - steps * FIXED_STEP_MS
  if (steps > MAX_CATCH_UP_STEPS) { steps = MAX_CATCH_UP_STEPS; remainderMs = 0 }
  let state = world
  const events: WizardEvent[] = []
  const rejections: IntentRejection[] = []
  for (let index = 0; index < steps; index += 1) {
    const result = advanceWizardWorld(state, [...(index === 0 ? queued : []), ...controlIntents(state, movement)])
    state = result.state
    events.push(...result.events)
    rejections.push(...result.rejections)
  }
  return { state, events, rejections, steps, remainderMs }
}

export type BatchSink = { commit: (state: WizardWorldState, messages: string[]) => void; persist: (state: WizardWorldState) => void }

export function runBatch(
  input: { clock: StepClock; nowMs: number; world: WizardWorldState; queued: readonly WizardIntent[]; movement: readonly [number, number] },
  sink: BatchSink,
): { clock: StepClock; world: WizardWorldState; queueConsumed: boolean } {
  const clock = accumulateElapsed(input.clock, input.nowMs)
  const batch = stepBatch(input.world, input.queued, input.movement, clock.accumulatedMs)
  if (batch.steps === 0) return { clock, world: input.world, queueConsumed: false }
  sink.persist(batch.state)
  sink.commit(batch.state, [...batch.events.map(eventText).filter(Boolean), ...batch.rejections.map((rejection) => rejection.message)])
  return { clock: { ...clock, accumulatedMs: batch.remainderMs }, world: batch.state, queueConsumed: true }
}

export default function App() {
  const profile = useMemo(() => worldProfileForSearch(window.location.search), [])
  const [world, setWorld] = useState(() => loadWorld(window.localStorage, profile))
  const [saveBlocked, setSaveBlocked] = useState(() => hasIncompatibleSave(window.localStorage, profile))
  const [messages, setMessages] = useState<RecentMessage[]>([{ id: 0, text: WELCOME_MESSAGE }])
  const [openStoreId, setOpenStoreId] = useState<string | null>(null)
  // Only the fixed-step timer and Restart write this ref. Rendered state may lag a committed step.
  const worldRef = useRef(world)
  const saveBlockedRef = useRef(saveBlocked)
  const movementRef = useRef<readonly [number, number]>([0, 0])
  const queuedRef = useRef<WizardIntent[]>([])
  const messageId = useRef(1)
  const clockRef = useRef<StepClock>(IDLE_CLOCK)

  useEffect(() => {
    const sink: BatchSink = {
      persist: (state) => {
        if (saveBlockedRef.current) return
        if (!persistWorld(window.localStorage, state, profile)) {
          saveBlockedRef.current = true
          setSaveBlocked(true)
        }
      },
      commit: (state, texts) => {
        setWorld(state)
        setOpenStoreId((current) => retainOpenStoreId(state, current))
        if (texts.length) setMessages((current) => [...current, ...texts.map((text) => ({ id: messageId.current++, text }))].slice(-5))
      },
    }
    const onVisibilityChange = () => {
      movementRef.current = [0, 0]
      clockRef.current = IDLE_CLOCK
    }
    const timer = window.setInterval(() => {
      if (document.hidden) return
      const result = runBatch({ clock: clockRef.current, nowMs: performance.now(), world: worldRef.current, queued: queuedRef.current, movement: movementRef.current }, sink)
      clockRef.current = result.clock
      worldRef.current = result.world
      if (result.queueConsumed) queuedRef.current = []
    }, FIXED_STEP_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [profile])

  const onIntent = useCallback((intent: WizardViewIntent) => {
    if (intent.type === 'movement') {
      movementRef.current = intent.vector
      return
    }
    if (intent.type === 'store.close') {
      setOpenStoreId(null)
      return
    }
    if (intent.type === 'interact' && !retainOpenStoreId(worldRef.current, openStoreId)) {
      const interaction = closestInteraction(worldRef.current)
      if (interaction?.kind === 'store') {
        setOpenStoreId(interaction.target.id)
        return
      }
    }
    const domainIntent = intentForView(worldRef.current, intent, openStoreId)
    if (domainIntent) queuedRef.current.push(domainIntent)
  }, [openStoreId])
  const restart = useCallback(() => {
    if (!window.confirm('Start a new expedition? This clears your saved progress.')) return
    const fresh = resetSavedWorld(window.localStorage, window.crypto.randomUUID(), createWizardWorld, profile)
    worldRef.current = fresh
    saveBlockedRef.current = false
    queuedRef.current = []
    movementRef.current = [0, 0]
    clockRef.current = IDLE_CLOCK
    setWorld(fresh)
    setSaveBlocked(false)
    setOpenStoreId(null)
    setMessages([{ id: messageId.current++, text: WELCOME_MESSAGE }])
  }, [profile])
  const projection = useMemo(() => toViewProjection(world, messages, openStoreId), [world, messages, openStoreId])

  return <main style={{ position: 'fixed', inset: 0, background: '#14221f' }}>
    <WizardSurface projection={projection} onIntent={onIntent} diagnostics />
    <style>{OBJECTIVE_STYLES}</style>
    {saveBlocked && <p className="wr-save-warning" role="alert">Play is unsaved. Existing save is preserved. Use New expedition to replace it.</p>}
    <div className="wr-objective" role="status">
      <span><b>OBJECTIVE</b> {objectiveFor(world)}</span>
      <button type="button" onClick={restart}>New expedition</button>
    </div>
  </main>
}
