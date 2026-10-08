import { createGeneratedWorld, terrainHeightAt, WORLD_CONTENT_REVISION } from './generation'
import { canonicalRouteSites } from './routeSites'
import { canEquipItem } from './world'
import type { DigSiteId, EquipmentSlot, GenerationProfile, InscriptionId, ItemId, RecipeId, RouteId, SkillId, SpellId, WizardWorldState } from './types'

const itemIds: ItemId[] = [
  'woodcutters_axe', 'logs', 'marsh_herb', 'stone', 'iron_ore', 'apprentice_hat',
  'traveler_tunic', 'trail_leggings', 'leather_boots', 'oak_wand', 'wooden_shield',
  'field_spade', 'ancient_relic',
]
const equipmentSlots: EquipmentSlot[] = ['head', 'chest', 'legs', 'feet', 'mainHand', 'offHand']
const skillIds: SkillId[] = ['woodcutting', 'construction', 'wayfinding', 'spellcraft', 'excavation']
const spellIds: SpellId[] = ['wayfinder_glow']
const inscriptionIds: InscriptionId[] = ['greenway_waystone']
const digSiteIds: DigSiteId[] = ['practice_mound', 'ridge_cache']
const LEGACY_V3_CONTENT_REVISION = 'greenway-region-v1'
const LEGACY_V4_CONTENT_REVISION = 'greenway-region-v2'
const routeIds: RouteId[] = ['greenway_ladder', 'highland_bridge']
const legacyRouteSiteIds: Record<RouteId, string> = {
  greenway_ladder: 'greenway_ladder:x:0', highland_bridge: 'highland_bridge:z:-8',
}
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
const commonSaveArrays = ['tiles', 'resources', 'stores', 'fairyRings'] as const
const routeMapArrays = ['areas', 'routes', 'recipes', 'builtRouteIds', 'unlockedRecipeIds', 'discoveredTileIds'] as const
const currentSaveArrays = ['inscriptions', 'digSites', 'studiedInscriptionIds', 'revealedDigSiteIds', 'excavatedDigSiteIds'] as const
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const signedInteger = (value: unknown): value is number => Number.isSafeInteger(value)
const nonnegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const knownIds = (value: unknown, allowed: readonly string[]) => Array.isArray(value)
  && value.every((id) => typeof id === 'string' && allowed.includes(id)) && new Set(value).size === value.length
const vec3Record = (value: unknown): value is Record<'x' | 'y' | 'z', number> => record(value)
  && [value.x, value.y, value.z].every(finite)
const savedVec3 = (value: unknown) => vec3Record(value)
  && [value.x, value.y, value.z].every((coordinate) => coordinate >= -1_000 && coordinate <= 1_000)
const sameVec3 = (value: unknown, expected: { x: number; y: number; z: number }) => vec3Record(value)
  && value.x === expected.x && value.y === expected.y && value.z === expected.z
const sameIds = (values: readonly unknown[], expected: readonly { id: string }[]) => values.length === expected.length
  && values.every((value, index) => record(value) && value.id === expected[index].id)
const completeIdSet = (values: readonly unknown[], expected: readonly { id: string }[]) => {
  const expectedIds = new Set(expected.map((entry) => entry.id))
  return values.length === expectedIds.size && values.every((value) => record(value) && expectedIds.has(value.id as string))
    && new Set(values.map((value) => (value as { id: string }).id)).size === expectedIds.size
}

export function hasValidRoutePlacements(state: WizardWorldState): boolean {
  if (state.schemaVersion !== 'wizard-world/v5' || state.contentRevision !== WORLD_CONTENT_REVISION
    || !Array.isArray(state.routes) || state.routes.length !== routeIds.length
    || !Array.isArray(state.builtRouteIds) || !knownIds(state.builtRouteIds, routeIds)
    || !record(state.player) || !nonnegativeInteger(state.player.xp)
    || state.player.level !== 1 + Math.floor(state.player.xp / 100)
    || state.builtRouteIds.includes('highland_bridge')
      && (!state.builtRouteIds.includes('greenway_ladder') || state.player.level < 2)) return false
  try {
    const sites = canonicalRouteSites(state)
    return state.routes.every((route, index) => {
      if (!record(route) || route.id !== routeIds[index]
        || route.fromAreaId !== (route.id === 'greenway_ladder' ? 'greenway' : 'northern_ridge')
        || route.toAreaId !== (route.id === 'greenway_ladder' ? 'northern_ridge' : 'eastern_highland')) return false
      const built = state.builtRouteIds.includes(route.id)
      const siteId = built ? route.siteId : legacyRouteSiteIds[route.id]
      if (built ? typeof siteId !== 'string' || !siteId : route.siteId !== null) return false
      const site = sites.find((candidate) => candidate.routeId === route.id && candidate.id === siteId)
      return !!site && sameVec3(route.from, site.from) && sameVec3(route.to, site.to)
    })
  } catch { return false }
}

function validLegacyContent(source: Record<string, unknown>, version: string, base: WizardWorldState): boolean {
  if (!record(source.player) || !record(source.rng)) return false
  const player = source.player
  const equipment = player.equipment
  const tiles = source.tiles as unknown[]
  const resources = source.resources as unknown[]
  const stores = source.stores as unknown[]
  const fairyRings = source.fairyRings as unknown[]
  const expectedResources = version === 'wizard-world/v1'
    ? base.resources.filter((resource) => resource.id.startsWith('resource-tile-')) : base.resources
  return tiles.length === base.tiles.length
    && tiles.every((tile) => record(tile) && typeof tile.id === 'string' && vec3Record(tile.center))
    && completeIdSet(resources, expectedResources) && resources.every((resource) => record(resource)
      && typeof resource.id === 'string' && vec3Record(resource.position)
      && nonnegativeInteger(resource.health) && positiveInteger(resource.maxHealth) && typeof resource.depleted === 'boolean')
    && sameIds(stores, base.stores) && stores.every((store, index) => record(store) && typeof store.id === 'string'
      && vec3Record(store.position) && Array.isArray(store.listings)
      && completeIdSet(store.listings, base.stores[index].listings.filter((listing) => listing.id !== 'spade'))
      && store.listings.every((listing: unknown) => record(listing) && typeof listing.id === 'string'
        && base.stores[index].listings.some((expected) => expected.id === listing.id && expected.itemId === listing.itemId)
        && nonnegativeInteger(listing.price) && nonnegativeInteger(listing.stock)))
    && fairyRings.length === 2 && fairyRings.every((ring) => record(ring) && typeof ring.id === 'string' && vec3Record(ring.position))
    && positiveInteger(source.rng.generation) && positiveInteger(source.rng.simulation)
    && vec3Record(player.position) && Array.isArray(player.inventory)
    && player.inventory.every((entry: unknown) => record(entry) && itemId(entry.itemId) && positiveInteger(entry.quantity))
    && record(equipment) && equipmentSlots.every((slot) => equipment[slot] === null || itemId(equipment[slot]))
    && Array.isArray(player.tradeSlots) && player.tradeSlots.length === 4
    && player.tradeSlots.every((slot: unknown, index: number) => record(slot) && slot.slotIndex === index
      && (slot.itemId === null || itemId(slot.itemId)) && nonnegativeInteger(slot.quantity) && nonnegativeInteger(slot.unitPrice))
    && Array.isArray(player.discoveredRingIds) && player.discoveredRingIds.every((id: unknown) => typeof id === 'string')
    && (source.schemaVersion === 'wizard-world/v1'
      || (Array.isArray(source.areas) && source.areas.length > 0
        && Array.isArray(source.routes) && source.routes.length > 0
        && Array.isArray(source.recipes) && source.recipes.length > 0))
}

function validCurrentContent(source: Record<string, unknown>, base: WizardWorldState): boolean {
  if (!currentSaveArrays.every((key) => Array.isArray(source[key])) || !record(source.player) || !record(source.rng)) return false
  const player = source.player
  const skillXp = player.skillXp
  const equipment = player.equipment
  const backpackCapacity = player.backpackCapacity
  if (!record(skillXp) || !skillIds.every((id) => nonnegativeInteger(skillXp[id]))
    || !knownIds(player.learnedSpellIds, spellIds)
    || !knownIds(source.studiedInscriptionIds, inscriptionIds)
    || !knownIds(source.revealedDigSiteIds, digSiteIds)
    || !knownIds(source.excavatedDigSiteIds, digSiteIds)
    || !nonnegativeInteger(source.tick) || !nonnegativeInteger(source.eventSequence)
    || source.fixedStepMs !== 50 || !positiveInteger(source.rng.generation) || !positiveInteger(source.rng.simulation)
    || !vec3Record(player.position) || ![player.verticalVelocity, player.yaw, player.pitch].every(finite)
    || ![player.coins, player.xp, player.level].every(nonnegativeInteger)
    || !positiveInteger(backpackCapacity) || backpackCapacity > 1_000
    || !Array.isArray(player.inventory) || !player.inventory.every((entry: unknown) => record(entry) && itemId(entry.itemId) && positiveInteger(entry.quantity))
    || !record(equipment) || !equipmentSlots.every((slot) => equipment[slot] === null || itemId(equipment[slot]))
    || !Array.isArray(player.tradeSlots) || player.tradeSlots.length !== 4
    || !player.tradeSlots.every((slot: unknown, index: number) => record(slot) && slot.slotIndex === index
      && (slot.itemId === null ? slot.quantity === 0 && slot.unitPrice === 0
        : itemId(slot.itemId) && positiveInteger(slot.quantity) && positiveInteger(slot.unitPrice)))
    || !knownIds(player.discoveredRingIds, ['ring-greenway', 'ring-highland'])) return false
  const carried = (player.inventory as Array<{ quantity: number }>).reduce((sum, stack) => sum + stack.quantity, 0)
  const reserved = (player.tradeSlots as Array<{ quantity: number }>).reduce((sum, slot) => sum + slot.quantity, 0)
  if (carried + reserved > backpackCapacity) return false
  const tiles = source.tiles as unknown[]
  const resources = source.resources as unknown[]
  const stores = source.stores as unknown[]
  const fairyRings = source.fairyRings as unknown[]
  const areas = source.areas as unknown[]
  const routes = source.routes as unknown[]
  const recipes = source.recipes as unknown[]
  if (!sameIds(tiles, base.tiles) || !sameIds(resources, base.resources)
    || !sameIds(stores, base.stores) || !sameIds(fairyRings, base.fairyRings)
    || !sameIds(areas, base.areas) || !sameIds(routes, base.routes) || !sameIds(recipes, base.recipes)
    || !tiles.every((tile) => record(tile) && typeof tile.id === 'string' && vec3Record(tile.center)
      && [tile.gridX, tile.gridZ].every(signedInteger) && [tile.elevation, tile.temperature, tile.moisture].every(finite)
      && typeof tile.terrain === 'string' && typeof tile.biome === 'string')
    || !resources.every((resource) => record(resource) && typeof resource.id === 'string' && typeof resource.tileId === 'string'
      && typeof resource.kind === 'string' && vec3Record(resource.position) && nonnegativeInteger(resource.health)
      && positiveInteger(resource.maxHealth) && typeof resource.depleted === 'boolean')
    || !stores.every((store, index) => record(store) && typeof store.id === 'string' && vec3Record(store.position)
      && Array.isArray(store.listings) && sameIds(store.listings, base.stores[index].listings)
      && store.listings.every((listing: unknown, listingIndex: number) => record(listing)
        && listing.itemId === base.stores[index].listings[listingIndex].itemId
        && nonnegativeInteger(listing.price) && nonnegativeInteger(listing.stock)))
    || !fairyRings.every((ring) => record(ring) && typeof ring.id === 'string' && vec3Record(ring.position))
    || !areas.every((area) => record(area) && typeof area.id === 'string')
    || !routes.every((route) => record(route) && typeof route.id === 'string' && vec3Record(route.from) && vec3Record(route.to))
    || !recipes.every((recipe) => record(recipe) && typeof recipe.id === 'string')) return false
  const inscriptions = source.inscriptions as unknown[]
  const digSites = source.digSites as unknown[]
  return sameIds(inscriptions, base.inscriptions)
    && inscriptions.every((value) => record(value)
    && inscriptionIds.includes(value.id as InscriptionId) && typeof value.name === 'string'
    && vec3Record(value.position) && value.position.x === 3 && value.position.z === 3 && value.spellId === 'wayfinder_glow')
    && sameIds(digSites, base.digSites)
    && digSites.every((value) => record(value)
      && digSiteIds.includes(value.id as DigSiteId) && typeof value.name === 'string'
      && vec3Record(value.position) && typeof value.visibleFromStart === 'boolean'
      && positiveInteger(value.minimumExcavationLevel)
      && record(value.reward) && itemId(value.reward.itemId)
      && positiveInteger(value.reward.quantity) && positiveInteger(value.xpReward)
      && (value.id === 'practice_mound'
        ? value.position.x === 7 && value.position.z === 3 && value.visibleFromStart === true
          && value.minimumExcavationLevel === 1 && value.reward.itemId === 'stone' && value.reward.quantity === 2 && value.xpReward === 30
        : value.position.x === -6 && value.position.z === -9 && value.visibleFromStart === false
          && value.minimumExcavationLevel === 2 && value.reward.itemId === 'ancient_relic' && value.reward.quantity === 1 && value.xpReward === 40))
}

function validV5Coordinates(source: Record<string, unknown>): boolean {
  const player = source.player as Record<string, unknown>
  if (!savedVec3(player.position)) return false
  for (const [key, field] of [
    ['tiles', 'center'], ['resources', 'position'], ['stores', 'position'], ['fairyRings', 'position'],
    ['inscriptions', 'position'], ['digSites', 'position'], ['routes', 'from'], ['routes', 'to'],
  ] as const) {
    if (!(source[key] as unknown[]).every((entry) => record(entry) && savedVec3(entry[field]))) return false
  }
  return true
}

function validV5ImmutableContent(source: Record<string, unknown>, base: WizardWorldState): boolean {
  const tiles = source.tiles as Array<Record<string, unknown>>
  const resources = source.resources as Array<Record<string, unknown>>
  const stores = source.stores as Array<Record<string, unknown>>
  const rings = source.fairyRings as Array<Record<string, unknown>>
  const areas = source.areas as Array<Record<string, unknown>>
  const routes = source.routes as Array<Record<string, unknown>>
  const recipes = source.recipes as Array<Record<string, unknown>>
  const inscriptions = source.inscriptions as Array<Record<string, unknown>>
  const digSites = source.digSites as Array<Record<string, unknown>>
  return tiles.every((tile, index) => tile.gridX === base.tiles[index].gridX && tile.gridZ === base.tiles[index].gridZ
      && tile.terrain === base.tiles[index].terrain && tile.biome === base.tiles[index].biome)
    && resources.every((resource, index) => resource.tileId === base.resources[index].tileId
      && resource.kind === base.resources[index].kind)
    && stores.every((store, index) => store.name === base.stores[index].name)
    && rings.every((ring, index) => ring.name === base.fairyRings[index].name && ring.kind === base.fairyRings[index].kind)
    && areas.every((area, index) => area.name === base.areas[index].name
      && area.minX === base.areas[index].minX && area.maxX === base.areas[index].maxX
      && area.minZ === base.areas[index].minZ && area.maxZ === base.areas[index].maxZ)
    && routes.every((route, index) => route.name === base.routes[index].name)
    && recipes.every((recipe, index) => recipe.name === base.recipes[index].name
      && recipe.routeId === base.recipes[index].routeId && recipe.logCost === base.recipes[index].logCost
      && recipe.xpReward === base.recipes[index].xpReward && recipe.minimumLevel === base.recipes[index].minimumLevel
      && recipe.prerequisiteRouteId === base.recipes[index].prerequisiteRouteId)
    && inscriptions.every((inscription, index) => inscription.name === base.inscriptions[index].name
      && sameVec3(inscription.position, base.inscriptions[index].position))
    && digSites.every((site, index) => site.name === base.digSites[index].name
      && sameVec3(site.position, base.digSites[index].position))
}

function validV5RuntimeValues(source: Record<string, unknown>, base: WizardWorldState): boolean {
  const player = source.player as Record<string, unknown>
  const rng = source.rng as Record<string, unknown>
  const tiles = source.tiles as WizardWorldState['tiles']
  const resources = source.resources as WizardWorldState['resources']
  const stores = source.stores as WizardWorldState['stores']
  const rings = source.fairyRings as WizardWorldState['fairyRings']
  const equipment = player.equipment as WizardWorldState['player']['equipment']
  const inventory = player.inventory as WizardWorldState['player']['inventory']
  const position = player.position as WizardWorldState['player']['position']
  const unlocked = source.unlockedRecipeIds as unknown[]
  const discovered = source.discoveredTileIds as unknown[]
  const shouldUnlockHighland = (source.builtRouteIds as RouteId[]).includes('greenway_ladder')
    && (player.level as number) >= 2
  return (rng.generation as number) <= 0xffffffff && (rng.simulation as number) <= 0xffffffff
    && tiles.every((tile) => [tile.elevation, tile.temperature, tile.moisture].every((value) => value >= 0 && value <= 1))
    && resources.every((resource) => resource.maxHealth <= 1_000 && resource.health <= resource.maxHealth
      && (resource.health !== 0 || resource.depleted)
      && resource.position.y === terrainHeightAt(tiles, resource.position.x, resource.position.z))
    && stores.every((store) => store.position.y === terrainHeightAt(tiles, store.position.x, store.position.z))
    && rings.every((ring) => ring.position.y === terrainHeightAt(tiles, ring.position.x, ring.position.z))
    && (player.verticalVelocity as number) >= -50 && (player.verticalVelocity as number) <= 50
    && (player.yaw as number) >= -1_000_000 && (player.yaw as number) <= 1_000_000
    && (player.pitch as number) >= -Math.PI / 2 && (player.pitch as number) <= Math.PI / 2
    && position.y >= terrainHeightAt(tiles, position.x, position.z)
    && knownIds(unlocked, base.recipes.map((recipe) => recipe.id)) && unlocked.includes('greenway_ladder')
    && unlocked.includes('highland_bridge') === shouldUnlockHighland
    && knownIds(discovered, base.tiles.map((tile) => tile.id))
    && base.discoveredTileIds.every((id) => discovered.includes(id))
    && equipmentSlots.every((slot) => equipment[slot] === null || canEquipItem(equipment[slot]!, slot)
      && equipmentSlots.filter((other) => equipment[other] === equipment[slot]).length
        <= inventory.filter((stack) => stack.itemId === equipment[slot]).reduce((total, stack) => total + stack.quantity, 0))
}

function parseRestorableSave(serialized: string, expectedProfile?: GenerationProfile) {
  let source: unknown
  try { source = JSON.parse(serialized) } catch { return null }
  if (!record(source) || typeof source.seed !== 'string' || !source.seed) return null
  const version = source.schemaVersion
  if (version !== 'wizard-world/v1' && version !== 'wizard-world/v2' && version !== 'wizard-world/v3'
    && version !== 'wizard-world/v4' && version !== 'wizard-world/v5') return null
  const profile: unknown = source.generationProfile === undefined && (version === 'wizard-world/v1' || version === 'wizard-world/v2')
    ? 'greenway-classic-v1' : source.generationProfile
  if (profile !== 'greenway-classic-v1' && profile !== 'greenway-expanded-v1') return null
  if (version === 'wizard-world/v1' && profile !== 'greenway-classic-v1') return null
  if (expectedProfile && profile !== expectedProfile) return null
  if (version === 'wizard-world/v3' && source.contentRevision !== LEGACY_V3_CONTENT_REVISION) return null
  if (version === 'wizard-world/v4' && source.contentRevision !== LEGACY_V4_CONTENT_REVISION) return null
  if (version === 'wizard-world/v5' && source.contentRevision !== WORLD_CONTENT_REVISION) return null
  if (!commonSaveArrays.every((key) => Array.isArray(source[key])) || !record(source.player) || !record(source.rng)) return null
  if (!record(source.player.position) || !Array.isArray(source.player.inventory) || !record(source.player.equipment)
    || !Array.isArray(source.player.tradeSlots) || !Array.isArray(source.player.discoveredRingIds)) return null
  if (version !== 'wizard-world/v1' && !routeMapArrays.every((key) => Array.isArray(source[key]))) return null
  let generated: WizardWorldState
  try { generated = createGeneratedWorld(source.seed, profile) } catch { return null }
  if ((version === 'wizard-world/v4' || version === 'wizard-world/v5')
    ? !validCurrentContent(source, generated) : !validLegacyContent(source, version, generated)) return null
  if (version === 'wizard-world/v5'
    && (!validV5Coordinates(source) || !validV5ImmutableContent(source, generated)
      || !validV5RuntimeValues(source, generated))) return null
  if (version === 'wizard-world/v5'
    && !hasValidRoutePlacements({ ...generated, ...source, areas: generated.areas } as WizardWorldState)) return null
  return { source, seed: source.seed, profile: profile as GenerationProfile, generated }
}

export function isRestorableWizardSave(serialized: string, profile: GenerationProfile): boolean {
  return parseRestorableSave(serialized, profile) !== null
}

export function serializeWizardWorld(state: WizardWorldState): string {
  return JSON.stringify(state)
}

export function restoreWizardWorld(serialized: string): WizardWorldState {
  const parsed = parseRestorableSave(serialized)
  if (!parsed) throw new Error('Invalid or unsupported Wizard Realms save')
  const { source } = parsed
  const base = parsed.generated
  const state: WizardWorldState = JSON.parse(JSON.stringify(base)) as WizardWorldState
  state.tick = integer(source.tick, base.tick)
  state.eventSequence = integer(source.eventSequence, base.eventSequence)
  state.builtRouteIds = validIds<RouteId>(source.builtRouteIds, base.routes.map((route) => route.id))
  state.unlockedRecipeIds = validIds<RecipeId>(source.unlockedRecipeIds, base.recipes.map((recipe) => recipe.id), ['greenway_ladder'])
  state.discoveredTileIds = validIds(source.discoveredTileIds, base.tiles.map((tile) => tile.id), base.discoveredTileIds)
  state.studiedInscriptionIds = validIds<InscriptionId>(source.studiedInscriptionIds, inscriptionIds)
  state.revealedDigSiteIds = validIds<DigSiteId>(source.revealedDigSiteIds, digSiteIds)
  state.excavatedDigSiteIds = validIds<DigSiteId>(source.excavatedDigSiteIds, digSiteIds)

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
  const newLandmarks = [...base.inscriptions, ...base.digSites].map((entry) => entry.position)
  if (rawResources.length > 0) state.resources = base.resources.map((fallback) => {
    const saved = rawResources.find((candidate) => record(candidate) && candidate.id === fallback.id)
    const value = record(saved) ? saved : {}
    const maxHealth = integer(value.maxHealth, fallback.maxHealth, 1, 1_000)
    const health = integer(value.health, fallback.health, 0, maxHealth)
    const savedPosition = vec3(value.position, fallback.position)
    const position = source.schemaVersion !== 'wizard-world/v4' && source.schemaVersion !== 'wizard-world/v5'
      && newLandmarks.some((anchor) => Math.hypot(savedPosition.x - anchor.x, savedPosition.z - anchor.z) < 1.5)
      ? { ...fallback.position } : savedPosition
    return { ...fallback, position, maxHealth, health, depleted: typeof value.depleted === 'boolean' ? value.depleted || health === 0 : health === 0 }
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
    const listings = fallback.listings.map((listing) => {
        const savedListing = rawListings.find((candidate) => record(candidate) && candidate.id === listing.id)
        const rawListing = record(savedListing) ? savedListing : {}
        return { ...listing, price: integer(rawListing.price, listing.price), stock: integer(rawListing.stock, listing.stock) }
      })
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
    const rawSkillXp = record(player.skillXp) ? player.skillXp : {}
    skillIds.forEach((id) => { state.player.skillXp[id] = integer(rawSkillXp[id], 0) })
    state.player.learnedSpellIds = validIds<SpellId>(player.learnedSpellIds, spellIds)
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
  if (source.schemaVersion === 'wizard-world/v5') {
    const savedRoutes = source.routes as WizardWorldState['routes']
    state.routes = state.routes.map((route, index) => ({ ...route, siteId: savedRoutes[index].siteId,
      from: { ...savedRoutes[index].from }, to: { ...savedRoutes[index].to } }))
  } else {
    const sites = canonicalRouteSites(state)
    state.routes = state.routes.map((route) => {
      if (!state.builtRouteIds.includes(route.id)) return route
      const site = sites.find((candidate) => candidate.routeId === route.id && candidate.id === legacyRouteSiteIds[route.id])!
      return { ...route, siteId: site.id, from: { ...site.from }, to: { ...site.to } }
    })
  }
  return state
}
