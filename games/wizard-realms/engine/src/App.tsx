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
import { visibleMapTiles } from './view/visibleMap'
import { hasValidRoutePlacements, isRestorableWizardSave } from './domain/persistence'
import { routeBuildOptions } from './domain/routeSites'
import { storeSellUnitPrice } from './domain/world'

const WORLD_SEED = 'greenway-alpha'
const SAVE_KEY = 'wizard-realms:world:v5'
const PREVIOUS_SAVE_KEY = 'wizard-realms:world:v4'
const LEGACY_SAVE_KEY = 'wizard-realms:world:v3'
const OLDER_SAVE_KEY = 'wizard-realms:world:v2'
const OLDEST_SAVE_KEY = 'wizard-realms:world:v1'
const EXPANDED_SAVE_KEY = 'wizard-realms:world:expanded:v4'
const PREVIOUS_EXPANDED_SAVE_KEY = 'wizard-realms:world:expanded:v3'
const LEGACY_EXPANDED_SAVE_KEY = 'wizard-realms:world:expanded:v2'
const OLDEST_EXPANDED_SAVE_KEY = 'wizard-realms:world:expanded:v1'
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
.wr-objective:has(.wr-recover) span{display:none}
.wr-save-warning{position:absolute;z-index:12;top:60px;left:50%;transform:translateX(-50%);box-sizing:border-box;width:max-content;max-width:calc(100vw - 24px);margin:0;padding:6px 10px;border:1px solid #e3a277;border-radius:8px;background:#4b2824f2;color:#fff2db;font:600 12px/1.3 system-ui;text-align:center;pointer-events:none}
@media(max-width:719px),(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-objective{left:10px;right:10px;bottom:calc(142px + env(safe-area-inset-bottom,0px));transform:none;box-sizing:border-box;max-height:80px;border-radius:12px;white-space:normal;font-size:12px;line-height:1.3}.wr-objective span{flex:1;min-width:0;max-height:70px;overflow-y:auto}.wr-objective button{flex:none;min-width:44px;min-height:44px}.wr-surface .wr-prompt,.wr-surface .wr-context{bottom:calc(230px + env(safe-area-inset-bottom,0px))}.wr-surface .wr-context{box-sizing:border-box;max-height:max(140px,calc(100vh - 340px));overflow-y:auto}}
@media(max-width:719px) and (max-height:590px){.wr-surface:has(.wr-context) .wr-backpack,.wr-surface .wr-events{display:none}}
@media(max-width:719px) and (max-height:400px){.wr-surface{min-height:0}.wr-surface .wr-prompt,.wr-surface .wr-context{box-sizing:border-box;top:54px;bottom:auto;max-height:80px;overflow-y:auto}}
@media(min-width:440px) and (max-width:719px) and (max-height:400px){.wr-surface .wr-backpack,.wr-surface .wr-context{left:8px;top:54px;max-height:80px;width:220px;overflow-y:auto;transform:none}.wr-surface .wr-prompt{left:auto;right:72px;max-width:160px;transform:none}}
@media(min-width:720px) and (max-width:900px) and (max-height:420px){.wr-surface .wr-context{top:54px;bottom:auto;max-height:calc(100vh - 254px);overflow-y:auto}}
@media(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-objective{left:210px;right:96px;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:none}.wr-surface .wr-prompt{top:66px;bottom:auto}}
@media(min-width:720px) and (max-width:900px) and (max-height:590px){.wr-surface:has(.wr-context) .wr-backpack{display:none}.wr-surface .wr-context{left:8px;top:64px;bottom:auto;transform:none;box-sizing:border-box;width:min(300px,34vw);max-height:calc(100vh - 194px);overflow-y:auto}}
`

const ITEM_NAMES: Record<ItemId, string> = {
  woodcutters_axe: 'Woodcutter axe', logs: 'Greenway logs', marsh_herb: 'Marsh herb',
  stone: 'Stone', iron_ore: 'Iron ore', apprentice_hat: 'Apprentice hat',
  traveler_tunic: 'Traveler tunic', trail_leggings: 'Trail leggings',
  leather_boots: 'Leather boots', oak_wand: 'Oak wand', wooden_shield: 'Wooden shield',
  field_spade: 'Field spade', ancient_relic: 'Ancient relic',
}
const EQUIPPABLE: Partial<Record<ItemId, readonly EquipmentSlot[]>> = {
  woodcutters_axe: ['mainHand'], apprentice_hat: ['head'], traveler_tunic: ['chest'],
  trail_leggings: ['legs'], leather_boots: ['feet'], oak_wand: ['mainHand', 'offHand'],
  wooden_shield: ['offHand'], field_spade: ['mainHand'],
}
const TERRAIN_COLORS = { loam: '#56824b', wetland: '#466f62', rocky: '#7b765e', snow: '#d4e3df' } as const

type RecentMessage = { id: number; text: string }
type WorldProfile = WizardWorldState['generationProfile']
const verifiedSaveBytes = new WeakMap<object, Map<WorldProfile, string>>()

function rememberVerifiedSave(storage: object, profile: WorldProfile, saved: string) {
  let byProfile = verifiedSaveBytes.get(storage)
  if (!byProfile) { byProfile = new Map(); verifiedSaveBytes.set(storage, byProfile) }
  byProfile.set(profile, saved)
}

export function worldProfileForSearch(search: string): WorldProfile {
  return new URLSearchParams(search).get('devRegion') === 'expanded' ? EXPANDED_PROFILE : CLASSIC_PROFILE
}

function isLoadableSave(saved: string, profile: WorldProfile): boolean {
  return isRestorableWizardSave(saved, profile)
}

function activeSave(storage: Pick<Storage, 'getItem'>, profile: WorldProfile): string | null {
  for (const key of saveKeys(profile)) {
    const saved = storage.getItem(key)
    if (saved !== null) return saved
  }
  return null
}

function saveKeys(profile: WorldProfile): readonly string[] {
  return profile === EXPANDED_PROFILE
    ? [EXPANDED_SAVE_KEY, PREVIOUS_EXPANDED_SAVE_KEY, LEGACY_EXPANDED_SAVE_KEY, OLDEST_EXPANDED_SAVE_KEY]
    : [SAVE_KEY, PREVIOUS_SAVE_KEY, LEGACY_SAVE_KEY, OLDER_SAVE_KEY, OLDEST_SAVE_KEY]
}

function hasIncompatibleSave(storage: Pick<Storage, 'getItem'>, profile: WorldProfile): boolean {
  const saved = activeSave(storage, profile)
  if (saved === null || verifiedSaveBytes.get(storage)?.get(profile) === saved) return false
  if (!isLoadableSave(saved, profile)) return true
  rememberVerifiedSave(storage, profile, saved)
  return false
}

export function loadWorld(storage: Pick<Storage, 'getItem'> = window.localStorage, profile: WorldProfile = CLASSIC_PROFILE): WizardWorldState {
  const saved = activeSave(storage, profile)
  return saved && isLoadableSave(saved, profile) ? restoreWizardWorld(saved) : createWizardWorld(WORLD_SEED, profile)
}

export function recoverablePriorSaveKey(storage: Pick<Storage, 'getItem'>, profile: WorldProfile = CLASSIC_PROFILE): string | null {
  const keys = saveKeys(profile)
  const activeIndex = keys.findIndex((key) => storage.getItem(key) !== null)
  if (activeIndex < 0) return null
  const active = storage.getItem(keys[activeIndex])!
  if (isLoadableSave(active, profile)) return null
  return keys.slice(activeIndex + 1).find((key) => {
    const saved = storage.getItem(key)
    return saved !== null && isLoadableSave(saved, profile)
  }) ?? null
}

export function recoverPriorSavedWorld(storage: Pick<Storage, 'getItem' | 'setItem'>, profile: WorldProfile, backupId: string): WizardWorldState | null {
  const priorKey = recoverablePriorSaveKey(storage, profile)
  if (!priorKey) return null
  const keys = saveKeys(profile)
  const activeKey = keys.find((key) => storage.getItem(key) !== null)!
  const activeBytes = storage.getItem(activeKey)!
  const priorBytes = storage.getItem(priorKey)!
  const recovered = restoreWizardWorld(priorBytes)
  const serialized = serializeWizardWorld(recovered)
  if (!hasValidRoutePlacements(recovered) || !isLoadableSave(serialized, profile)) return null
  const backupKey = `${activeKey}:recovery-backup:${backupId}`
  if (storage.getItem(backupKey) !== null) return null
  storage.setItem(backupKey, activeBytes)
  storage.setItem(keys[0], serialized)
  rememberVerifiedSave(storage, profile, serialized)
  return recovered
}

export function persistWorld(storage: Pick<Storage, 'getItem' | 'setItem'>, state: WizardWorldState, profile: WorldProfile = CLASSIC_PROFILE): boolean {
  const key = profile === EXPANDED_PROFILE ? EXPANDED_SAVE_KEY : SAVE_KEY
  if (state.generationProfile !== profile || !hasValidRoutePlacements(state) || hasIncompatibleSave(storage, profile)) return false
  const serialized = serializeWizardWorld(state)
  storage.setItem(key, serialized)
  rememberVerifiedSave(storage, profile, serialized)
  return true
}

export function resetSavedWorld(storage: Pick<Storage, 'setItem' | 'removeItem'>, seed = WORLD_SEED, createWorld: typeof createWizardWorld = createWizardWorld, profile: WorldProfile = CLASSIC_PROFILE): WizardWorldState {
  const fresh = createWorld(seed, profile)
  const serialized = serializeWizardWorld(fresh)
  storage.setItem(profile === EXPANDED_PROFILE ? EXPANDED_SAVE_KEY : SAVE_KEY, serialized)
  rememberVerifiedSave(storage, profile, serialized)
  return fresh
}

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

const owned = (state: WizardWorldState, itemId: ItemId) =>
  state.player.inventory.filter((stack) => stack.itemId === itemId).reduce((sum, stack) => sum + stack.quantity, 0)
const axeEquipped = (state: WizardWorldState) => state.player.equipment.mainHand === 'woodcutters_axe'
const reachableStore = (state: WizardWorldState) => state.stores
  .filter((store) => distance(state.player.position, store.position) <= INTERACTION_RANGE)
  .sort((left, right) => distance(state.player.position, left.position) - distance(state.player.position, right.position))[0] ?? null

export function objectiveFor(state: WizardWorldState): string {
  const logs = owned(state, 'logs')
  const gather = (cost: number) => `Gather logs from Greenway oaks (${Math.min(logs, cost)}/${cost})`
  const bearingTo = (target: { x: number; z: number }) => {
    const east = target.x - state.player.position.x
    const south = target.z - state.player.position.z
    return [
      Math.abs(east) >= 0.5 ? `${Math.max(1, Math.round(Math.abs(east)))}m ${east > 0 ? 'east' : 'west'}` : '',
      Math.abs(south) >= 0.5 ? `${Math.max(1, Math.round(Math.abs(south)))}m ${south > 0 ? 'south' : 'north'}` : '',
    ].filter(Boolean).join(' and ') || 'at this spot'
  }
  const outfitters = (action: string) => {
    const store = state.stores.find((candidate) => candidate.id === 'store-greenway')!
    if (distance(state.player.position, store.position) <= INTERACTION_RANGE) return `${action} at ${store.name}.`
    return `${store.name}: ${bearingTo(store.position)}. ${action}.`
  }
  if (!state.player.learnedSpellIds.includes('wayfinder_glow')) {
    const waystone = state.inscriptions.find((inscription) => inscription.id === 'greenway_waystone')!
    if (distance(state.player.position, waystone.position) <= INTERACTION_RANGE) return 'Study the Greenway waystone to learn Wayfinder Glow.'
    return `Greenway waystone: ${bearingTo(waystone.position)}. Study it to learn Wayfinder Glow.`
  }
  if (state.player.skillXp.spellcraft === 0) return "Head north to the fog at Greenway's edge, then cast Wayfinder Glow."
  if (!state.excavatedDigSiteIds.includes('practice_mound')) {
    if (!owned(state, 'field_spade')) return outfitters('Buy a field spade')
    if (state.player.equipment.mainHand !== 'field_spade') return 'Equip the field spade from your backpack.'
    const mound = state.digSites.find((site) => site.id === 'practice_mound')!
    return distance(state.player.position, mound.position) <= INTERACTION_RANGE
      ? 'Excavate the Greenway practice mound to train excavation.'
      : `Greenway practice mound: ${bearingTo(mound.position)}. Excavate it to train excavation.`
  }
  if (!state.builtRouteIds.includes('greenway_ladder')) {
    if (!axeEquipped(state)) return owned(state, 'woodcutters_axe') > 0
      ? 'Equip the woodcutter axe to gather ladder materials.'
      : outfitters('Buy a woodcutter axe')
    return logs >= 4 ? 'Go north to a ◇ ladder site, choose it on the map, then Build (4 logs).' : `${gather(4)}, then choose a ladder site on the map.`
  }
  if (!state.revealedDigSiteIds.includes('ridge_cache')) return areaAt(state.areas,
    state.player.position.x, state.player.position.z).id === 'greenway'
    ? 'Stand at the foot of the completed ladder and press E to cross north, then cast Wayfinder Glow to reveal the ridge cache.'
    : 'Cast Wayfinder Glow near the northern ridge to reveal the buried cache.'
  if (!state.excavatedDigSiteIds.includes('ridge_cache')) {
    const cache = state.digSites.find((site) => site.id === 'ridge_cache')!
    const target = `Ridge cache: ${bearingTo(cache.position)} (✦ on the map).`
    if (state.player.equipment.mainHand !== 'field_spade') return `Re-equip the field spade, then find it. ${target}`
    if (areaAt(state.areas, state.player.position.x, state.player.position.z).id === 'greenway') {
      return 'Cross the ladder north, then find the revealed ridge cache (✦ on the map).'
    }
    return distance(state.player.position, cache.position) <= INTERACTION_RANGE
      ? 'Excavate the revealed ridge cache.' : `${target} Excavate it.`
  }
  if (owned(state, 'ancient_relic') > 0) return areaAt(state.areas,
    state.player.position.x, state.player.position.z).id === 'greenway'
    ? outfitters('Sell the ancient relic for 25g')
    : `Cross the Greenway ladder south. ${outfitters('Sell the ancient relic for 25g')}`
  const greenwayRing = state.player.discoveredRingIds.includes('ring-greenway')
  const highlandRing = state.player.discoveredRingIds.includes('ring-highland')
  if (greenwayRing && highlandRing) return areaAt(state.areas, state.player.position.x, state.player.position.z).id === 'greenway'
    ? 'Quest complete: fairy rings linked. Explore, trade, or travel to Highland again.'
    : 'Quest complete: both fairy rings are linked. Use the Highland Ring to travel home.'
  if (highlandRing) {
    const areaId = areaAt(state.areas, state.player.position.x, state.player.position.z).id
    if (areaId === 'eastern_highland') return 'Cross the Highland bridge west, then the Greenway ladder south to return home.'
    if (areaId === 'northern_ridge') return 'Cross the Greenway ladder south to return home.'
    const ring = state.fairyRings.find((candidate) => candidate.id === 'ring-greenway')!
    return distance(state.player.position, ring.position) <= INTERACTION_RANGE
      ? 'Press E to discover the Greenway Ring and link travel home.'
      : `Greenway Ring: ${bearingTo(ring.position)}. Go there and press E to discover it.`
  }
  if (state.builtRouteIds.includes('highland_bridge')) return areaAt(state.areas,
    state.player.position.x, state.player.position.z).id === 'eastern_highland'
    ? 'Find and discover the Highland fairy ring.'
    : 'Cross the Highland bridge east and discover the Highland fairy ring.'
  if (state.builtRouteIds.includes('greenway_ladder')) return logs >= 6 ? 'Choose a Highland bridge site on the map and build it (6 logs).' : `${gather(6)}, then choose a bridge site on the map.`
  if (axeEquipped(state)) return logs >= 4 ? 'Choose a Greenway ladder site on the map and build it (4 logs).' : `${gather(4)}, then choose a ladder site on the map.`
  return owned(state, 'woodcutters_axe') > 0 ? 'Equip the woodcutter axe from your backpack.' : outfitters('Buy a woodcutter axe')
}

function closestInteraction(state: WizardWorldState) {
  const playerAreaId = areaAt(state.areas, state.player.position.x, state.player.position.z).id
  const candidates = [
    ...state.inscriptions.filter((inscription) => !state.studiedInscriptionIds.includes(inscription.id))
      .map((inscription) => ({ distance: distance(state.player.position, inscription.position), kind: 'inscription' as const, target: inscription })),
    ...state.digSites.filter((site) => (site.visibleFromStart || state.revealedDigSiteIds.includes(site.id))
      && !state.excavatedDigSiteIds.includes(site.id))
      .map((site) => ({ distance: distance(state.player.position, site.position), kind: 'dig-site' as const, target: site })),
    ...state.resources.filter((resource) => resource.kind === 'tree' && !resource.depleted)
      .map((resource) => ({ distance: distance(state.player.position, resource.position), kind: 'resource' as const, target: resource })),
    ...state.fairyRings.filter((ring) => areaAt(state.areas, ring.position.x, ring.position.z).id === playerAreaId)
      .map((ring) => ({ distance: distance(state.player.position, ring.position), kind: 'fairy-ring' as const, target: ring })),
    ...state.stores.map((store) => ({ distance: distance(state.player.position, store.position), kind: 'store' as const, target: store })),
    ...state.routes.filter((route) => state.builtRouteIds.includes(route.id))
      .flatMap((route) => {
        const source = playerAreaId === route.fromAreaId ? route.from : playerAreaId === route.toAreaId ? route.to : null
        return source ? [{ distance: distance(state.player.position, source), kind: 'route' as const, target: route }] : []
      }),
  ].filter((candidate) => candidate.distance <= INTERACTION_RANGE)
  // Deliberate destinations take E before incidental oaks in the same reach.
  const priority = (kind: typeof candidates[number]['kind']) =>
    kind === 'inscription' || kind === 'dig-site' ? 2
      : kind === 'route' || kind === 'store' || kind === 'fairy-ring' ? 1 : 0
  return candidates.sort((left, right) => priority(right.kind) - priority(left.kind)
    || left.distance - right.distance)[0] ?? null
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

export function eventText(event: WizardEvent): string {
  switch (event.type) {
    case 'resource_damaged': return 'The tree shudders under your axe.'
    case 'resource_harvested': return `Gathered ${event.quantity} ${itemAmountName(event.itemId, event.quantity)}.`
    case 'fairy_ring_discovered': return 'A fairy ring answers your presence.'
    case 'fairy_ring_teleported': return 'The mushroom path folds the world around you.'
    case 'store_item_bought': return `Purchased ${ITEM_NAMES[event.itemId]}.`
    case 'store_item_sold': return `Sold ${event.quantity} ${itemAmountName(event.itemId, event.quantity)} for ${event.totalPrice}g.`
    case 'item_equipped': return `Equipped ${ITEM_NAMES[event.itemId]}.`
    case 'item_unequipped': return `Unequipped ${ITEM_NAMES[event.itemId]}.`
    case 'inscription_studied': return 'The Greenway waystone teaches you Wayfinder Glow.'
    case 'spell_cast': return event.revealedTileIds.length + event.revealedDigSiteIds.length > 0
      ? `Wayfinder Glow reveals ${event.revealedTileIds.length} map tile${event.revealedTileIds.length === 1 ? '' : 's'} and ${event.revealedDigSiteIds.length} buried site${event.revealedDigSiteIds.length === 1 ? '' : 's'}.`
      : 'The glow finds no new paths here. Try casting closer to the fog.'
    case 'dig_site_excavated': return `Excavated ${event.quantity} ${itemAmountName(event.itemId, event.quantity)}.`
    case 'skill_xp_gained': return `Gained ${event.xp} ${event.skillId} XP.`
    case 'trade_listing_created': return `Listed ${event.quantity} ${itemAmountName(event.itemId, event.quantity)} for trade.`
    case 'trade_listing_cancelled': return `Returned ${event.quantity} ${itemAmountName(event.itemId, event.quantity)} to your backpack.`
    case 'trade_listing_sold': return `A market buyer paid ${event.totalPrice}g for ${event.quantity} ${itemAmountName(event.itemId, event.quantity)}.`
    case 'player_jumped': return 'You spring over the trail.'
    case 'route_built': return `Built ${event.routeId === 'greenway_ladder' ? 'the Greenway ladder' : 'the Highland bridge'} for ${event.logCost} logs.`
    case 'route_used': return 'You cross the completed route.'
    case 'recipe_unlocked': return 'A new construction recipe is ready.'
    case 'tile_discovered': return 'The map reveals a new tile.'
    default: return ''
  }
}

export function toViewProjection(state: WizardWorldState, messages: readonly RecentMessage[], openStoreId: string | null = null, selectedBuildSiteId: string | null = null): WizardViewProjection {
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
  const waystoneTileIds = new Set(state.inscriptions.map((inscription) => tileIdAt(inscription.position)))
  const cacheTileIds = new Set(state.digSites.filter((site) =>
    !site.visibleFromStart && state.revealedDigSiteIds.includes(site.id)
    && !state.excavatedDigSiteIds.includes(site.id)).map((site) => tileIdAt(site.position)))
  const routeSourceTileId = (routeId: string, position: { x: number; z: number }) => {
    const sourceAreaId = state.routes.find((route) => route.id === routeId)!.fromAreaId
    let nearestId: string | undefined
    let nearestDistance = Infinity
    for (const tile of state.tiles) {
      if (areaAt(state.areas, tile.center.x, tile.center.z).id !== sourceAreaId) continue
      const separation = (tile.center.x - position.x) ** 2 + (tile.center.z - position.z) ** 2
      if (separation < nearestDistance) { nearestDistance = separation; nearestId = tile.id }
    }
    return nearestId
  }
  const buildOptions = routeBuildOptions(state)
  const buildSites: WizardViewProjection['buildSites'] = buildOptions.map((site) => {
    const route = state.routes.find((candidate) => candidate.id === site.routeId)!
    const recipe = state.recipes.find((candidate) => candidate.routeId === site.routeId)!
    const offset = site.routeId === 'greenway_ladder' ? site.from.x : site.from.z
    const direction = site.routeId === 'greenway_ladder'
      ? offset < 0 ? 'west' : 'east'
      : offset < 0 ? 'north' : 'south'
    const location = offset === 0 ? 'center' : `${Math.round(Math.abs(offset))}m ${direction} of center`
    return {
      id: site.id, routeId: site.routeId,
      label: site.routeId === 'highland_bridge' ? `${route.name}, crosses east; site ${location}` : `${route.name}, site ${location}`,
      from: [site.from.x, site.from.y, site.from.z], to: [site.to.x, site.to.y, site.to.z],
      logCost: recipe.logCost, status: site.status, reason: site.reason,
      discovered: discoveredTileIds.has(routeSourceTileId(site.routeId, site.from) ?? ''),
    }
  })
  const routeSiteTileIds = new Set(buildSites.filter((site) => site.discovered && !state.builtRouteIds.some((routeId) => routeId === site.routeId))
    .map((site) => routeSourceTileId(site.routeId, { x: site.from[0], z: site.from[2] })))
  const builtRouteTileIds = new Set(state.routes.filter((route) => state.builtRouteIds.includes(route.id))
    .map((route) => routeSourceTileId(route.id, route.from)))
  const activeStoreId = retainOpenStoreId(state, openStoreId)
  const interaction = activeStoreId
    ? { kind: 'store' as const, target: state.stores.find((store) => store.id === activeStoreId)! }
    : closestInteraction(state)
  const inventory = domain.player.inventory.map((stack) => itemStack(stack.itemId, stack.quantity))
  const saleOffers = (storeId: string) => [...new Set(domain.player.inventory.map((stack) => stack.itemId))].flatMap((itemId) => {
    const unitPrice = storeSellUnitPrice(storeId, itemId)
    const quantity = owned(state, itemId) - Object.values(domain.player.equipment).filter((equippedItem) => equippedItem === itemId).length
    return unitPrice !== null && quantity > 0 ? [{ itemId, name: ITEM_NAMES[itemId], quantity, unitPrice }] : []
  })
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
    inscriptions: state.inscriptions.map((inscription) => ({
      id: inscription.id, name: inscription.name,
      position: [inscription.position.x, inscription.position.y, inscription.position.z],
      spellId: inscription.spellId, studied: state.studiedInscriptionIds.includes(inscription.id),
    })),
    digSites: state.digSites.map((site) => ({
      id: site.id, name: site.name,
      position: [site.position.x, site.position.y, site.position.z],
      revealed: site.visibleFromStart || state.revealedDigSiteIds.includes(site.id),
      excavated: state.excavatedDigSiteIds.includes(site.id),
      minimumExcavationLevel: site.minimumExcavationLevel,
    })),
    skillXp: { ...domain.player.skillXp },
    learnedSpellIds: [...domain.player.learnedSpellIds],
    routes: state.routes.map((route) => {
      const recipe = state.recipes.find((candidate) => candidate.routeId === route.id)!
      return { id: route.id, label: route.name, from: [route.from.x, route.from.y, route.from.z], to: [route.to.x, route.to.y, route.to.z], built: state.builtRouteIds.includes(route.id), unlocked: state.unlockedRecipeIds.includes(recipe.id), logCost: recipe.logCost }
    }),
    buildSites,
    selectedBuildSiteId: buildSites.some((site) => site.id === selectedBuildSiteId && site.discovered && site.status !== 'built') ? selectedBuildSiteId : null,
    map: {
      tiles: visibleMapTiles(state.tiles, currentTile.gridX, currentTile.gridZ).map((tile) => {
        const discovered = discoveredTileIds.has(tile.id)
        return {
          id: tile.id, gridX: tile.gridX, gridZ: tile.gridZ,
          terrain: discovered ? tile.terrain : null, biome: discovered ? tile.biome : null, discovered,
          hasResource: discovered && activeResourceTileIds.has(tile.id),
          hasStore: discovered && storeTileIds.has(tile.id),
          hasRing: discovered && ringTileIds.has(tile.id),
          hasWaystone: discovered && waystoneTileIds.has(tile.id),
          hasCache: discovered && cacheTileIds.has(tile.id),
          hasRouteSite: discovered && routeSiteTileIds.has(tile.id),
          hasBuiltRoute: discovered && builtRouteTileIds.has(tile.id),
        }
      }),
      player: { gridX: currentTile.gridX, gridZ: currentTile.gridZ, yaw: state.player.yaw },
    },
    stores: state.stores.map((store) => ({ id: store.id, name: store.name, position: [store.position.x, store.position.y, store.position.z], listings: store.listings.map((listing) => ({ id: listing.id, name: ITEM_NAMES[listing.itemId], price: listing.price, stock: listing.stock })), sellOffers: saleOffers(store.id) })),
    openStoreId: activeStoreId,
    nearbyStoreId: reachableStore(state)?.id ?? null,
    backpack: { capacity: domain.player.backpackCapacity, stacks: inventory },
    coins: domain.player.coins,
    experience: { xp: domain.player.xp, nextLevelXp: domain.player.level * 100, level: domain.player.level },
    equipment: { head: equipped('head'), chest: equipped('chest'), legs: equipped('legs'), feet: equipped('feet'), mainHand: equipped('mainHand'), offHand: equipped('offHand') },
    tradeListings: domain.player.tradeSlots.map((slot) => slot.itemId ? ({ id: `trade-${slot.slotIndex}`, itemName: ITEM_NAMES[slot.itemId], quantity: slot.quantity, unitPrice: slot.unitPrice }) : null) as unknown as WizardViewProjection['tradeListings'],
    nearbyInteraction: interaction ? {
      kind: interaction.kind, targetId: interaction.target.id,
      label: interaction.kind === 'resource' ? 'Greenway oak' : interaction.target.name,
      action: interaction.kind === 'resource' ? (axeEquipped(state) ? 'Chop' : owned(state, 'woodcutters_axe') > 0 ? 'Equip axe' : 'Needs axe')
        : interaction.kind === 'inscription' ? 'Study'
        : interaction.kind === 'dig-site' ? state.player.equipment.mainHand === 'field_spade' ? 'Excavate'
          : owned(state, 'field_spade') > 0 ? 'Equip spade' : 'Needs spade'
        : interaction.kind === 'store' ? activeStoreId ? 'Store open' : 'Open store'
        : interaction.kind === 'route' ? 'Cross'
        : discoveredRingIds.has(interaction.target.id)
          ? state.fairyRings.some((ring) => ring.id !== interaction.target.id && discoveredRingIds.has(ring.id)) ? 'Choose destination' : 'Find another ring'
          : 'Discover',
      actionable: interaction.kind === 'resource' && (axeEquipped(state) || owned(state, 'woodcutters_axe') > 0)
        || interaction.kind === 'inscription'
        || (interaction.kind === 'dig-site' && (state.player.equipment.mainHand === 'field_spade' || owned(state, 'field_spade') > 0))
        || (interaction.kind === 'store' && activeStoreId === null)
        || interaction.kind === 'route'
        || (interaction.kind === 'fairy-ring' && !discoveredRingIds.has(interaction.target.id)),
    } : null,
    recentEvents: messages.map((message) => message.text),
  }
}

export function intentForView(state: WizardWorldState, intent: Exclude<WizardViewIntent, { type: 'movement' | 'movement.tap' }>, openStoreId: string | null = null): WizardIntent | null {
  if (intent.type === 'jump') return { type: 'jump' }
  if (intent.type === 'store.close' || intent.type === 'store.open' || intent.type === 'build-site.select') return null
  if (intent.type === 'build-site.confirm') {
    const site = routeBuildOptions(state).find((candidate) => candidate.id === intent.siteId)
    return site ? { type: 'build_route', routeId: site.routeId, siteId: site.id } : null
  }
  if (intent.type === 'interact') {
    if (retainOpenStoreId(state, openStoreId)) return null
    const interaction = closestInteraction(state)
    if (interaction?.kind === 'inscription') return { type: 'study_inscription', inscriptionId: interaction.target.id }
    if (interaction?.kind === 'dig-site') {
      if (state.player.equipment.mainHand === 'field_spade') return { type: 'dig_site', digSiteId: interaction.target.id }
      return owned(state, 'field_spade') > 0 ? { type: 'equip_item', itemId: 'field_spade', slot: 'mainHand' } : null
    }
    if (interaction?.kind === 'resource') {
      if (axeEquipped(state)) return { type: 'harvest', resourceId: interaction.target.id }
      return owned(state, 'woodcutters_axe') > 0 ? { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' } : null
    }
    if (interaction?.kind === 'fairy-ring' && !state.player.discoveredRingIds.includes(interaction.target.id)) return { type: 'discover_fairy_ring', ringId: interaction.target.id }
    if (interaction?.kind === 'route') return { type: 'traverse_route', routeId: interaction.target.id }
    return null
  }
  if (intent.type === 'store.select-listing') return { type: 'buy_store_listing', storeId: intent.storeId, listingId: intent.listingId }
  if (intent.type === 'store.sell-item') return { type: 'sell_to_store', storeId: intent.storeId, itemId: intent.itemId as ItemId, quantity: intent.quantity }
  if (intent.type === 'equipment.equip') return { type: 'equip_item', itemId: intent.stackId.replace('inventory-', '') as ItemId, slot: intent.slot }
  if (intent.type === 'equipment.unequip') return { type: 'unequip_item', slot: intent.slot }
  if (intent.type === 'inscription.study') return { type: 'study_inscription', inscriptionId: intent.inscriptionId }
  if (intent.type === 'spell.cast') return { type: 'cast_spell', spellId: intent.spellId }
  if (intent.type === 'dig-site.excavate') return { type: 'dig_site', digSiteId: intent.digSiteId }
  if (intent.type === 'trade.create-listing') return { type: 'create_trade_listing', slotIndex: intent.slot, itemId: intent.stackId.replace('inventory-', '') as ItemId, quantity: intent.quantity, unitPrice: intent.unitPrice }
  if (intent.type === 'trade.cancel-listing') return { type: 'cancel_trade_listing', slotIndex: intent.slot }
  if (intent.type === 'fairy-ring.teleport') return { type: 'teleport_fairy_ring',
    sourceRingId: intent.ringId, targetRingId: intent.destinationRingId }
  return null
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
  const [recoveryError, setRecoveryError] = useState(false)
  const priorSaveKey = useMemo(() => saveBlocked ? recoverablePriorSaveKey(window.localStorage, profile) : null, [saveBlocked, profile])
  const [messages, setMessages] = useState<RecentMessage[]>([{ id: 0, text: WELCOME_MESSAGE }])
  const [openStoreId, setOpenStoreId] = useState<string | null>(null)
  const [selectedBuildSiteId, setSelectedBuildSiteId] = useState<string | null>(null)
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
        setSelectedBuildSiteId((current) => current && state.routes.some((route) => route.siteId === current && state.builtRouteIds.includes(route.id)) ? null : current)
        if (texts.length) setMessages((current) => {
          const next = [...current]
          for (const text of texts) if (next.at(-1)?.text !== text) next.push({ id: messageId.current++, text })
          return next.slice(-5)
        })
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
    if (intent.type === 'movement.tap') {
      queuedRef.current.push(...controlIntents(worldRef.current, intent.vector))
      return
    }
    if (intent.type === 'store.close') {
      setOpenStoreId(null)
      return
    }
    if (intent.type === 'store.open') {
      if (reachableStore(worldRef.current)?.id === intent.storeId) setOpenStoreId(intent.storeId)
      return
    }
    if (intent.type === 'build-site.select') {
      const site = routeBuildOptions(worldRef.current).find((candidate) => candidate.id === intent.siteId)
      if (intent.siteId === null || (site && !worldRef.current.builtRouteIds.includes(site.routeId))) setSelectedBuildSiteId(intent.siteId)
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
    setRecoveryError(false)
    setOpenStoreId(null)
    setSelectedBuildSiteId(null)
    setMessages([{ id: messageId.current++, text: WELCOME_MESSAGE }])
  }, [profile])
  const recover = useCallback(() => {
    if (!window.confirm('Recover the previous valid expedition? The incompatible save will be backed up, not deleted.')) return
    try {
      const recovered = recoverPriorSavedWorld(window.localStorage, profile, window.crypto.randomUUID())
      if (!recovered) { setRecoveryError(true); return }
      worldRef.current = recovered
      saveBlockedRef.current = false
      queuedRef.current = []
      movementRef.current = [0, 0]
      clockRef.current = IDLE_CLOCK
      setWorld(recovered)
      setSaveBlocked(false)
      setRecoveryError(false)
      setOpenStoreId(null)
      setSelectedBuildSiteId(null)
      setMessages([{ id: messageId.current++, text: 'Previous expedition recovered. The incompatible save is backed up.' }])
    } catch { setRecoveryError(true) }
  }, [profile])
  const projection = useMemo(() => toViewProjection(world, messages, openStoreId, selectedBuildSiteId), [world, messages, openStoreId, selectedBuildSiteId])

  return <main style={{ position: 'fixed', inset: 0, background: '#14221f' }}>
    <WizardSurface projection={projection} onIntent={onIntent} diagnostics />
    <style>{OBJECTIVE_STYLES}</style>
    {saveBlocked && <p className="wr-save-warning" role="alert">Play is unsaved. Existing save is preserved. {priorSaveKey ? 'A previous valid expedition can be recovered.' : 'Use New expedition to replace it.'}{recoveryError ? ' Recovery failed; no save was discarded.' : ''}</p>}
    <div className="wr-objective" role="status">
      <span><b>OBJECTIVE</b> {objectiveFor(world)}</span>
      {saveBlocked && priorSaveKey && <button type="button" className="wr-recover" aria-label="Recover previous save" onClick={recover}>Recover</button>}
      <button type="button" onClick={restart}>New expedition</button>
    </div>
  </main>
}
