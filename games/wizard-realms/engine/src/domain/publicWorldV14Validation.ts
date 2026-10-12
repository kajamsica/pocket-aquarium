import { canonicalRouteSites } from './routeSites'
import { DISCOVERY_MASK_BYTES, discoveryMaskHasTileId,
  encodeDiscoveredTileIds, isDiscoveryMaskSubset, isValidDiscoveryMask } from './discoveryMask'
import { createGeneratedWorld } from './generation'
import { HIGHLAND_CONTENT_REVISION, highlandStoneNodes } from './highlandContent'
import { HIGHLAND_WIND_CONTENT_REVISION, HIGHLAND_WINDWARD_STEP,
  isHighlandWindTrailSegmentIndex } from './highlandWindContent'
import { resolveFieldCampSite } from './fieldCamp'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { HERB_CYCLE_TICKS } from './mireglassHerbForaging'
import { createMireglassRegionProgress } from './mireglassExpedition'
import { isValidMireglassWorldContent } from './mireglassPersistence'
import { mireglassFenDepthAt } from './mireglassTerrain'
import { discoveredTileIdsInActiveWindow } from './publicV13DiscoveryWindow'
import { cloneBoundedPublicV13StateShape } from './publicWorldV13Snapshot'
import { PUBLIC_V10_TERRAIN_REVISION } from './publicWorldV10State'
import { nearbyWorldTileIds, PUBLIC_START_REVEAL_RADIUS_METERS,
  PUBLIC_START_TILE_ID } from './publicWorldDiscovery'
import { preservesPublicV13History } from './publicV13History'
import { starterCliffPoseValid } from './starterCliffMovement'
import { STARTER_CLIFF_PROFILE, STARTER_CLIFF_SITE_ID } from './starterCliffProfile'
import { createStarterCliffGreenwayFacts } from './starterCliffWorld'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { emptyTerrainWorkLedger, isValidTerrainWorkLedger } from './terrainWorkLedger'
import { resolveTerrainWorkSite } from './terrainWorks'
import { activeChunkCoordinates, WORLD_CELL_METERS, WORLD_CHUNK_CELLS,
  WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'
import type { PublicV14State } from './publicWorldV14Snapshot'
import type { RouteSite, WizardWorldState } from './types'

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const positiveUint32 = (value: unknown): value is number => count(value) && value > 0 && value <= 0xffffffff
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key))
const sortedFrom = (value: unknown, allowed: readonly string[]): value is string[] =>
  Array.isArray(value) && value.every((id, index) => typeof id === 'string'
    && allowed.includes(id) && (index === 0 || value[index - 1] < id))

/** Exact comparison is used only after the v13 compact-shape copier has detached bounded input. */
export function samePublicV14Value(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a instanceof Uint8Array || b instanceof Uint8Array) return a instanceof Uint8Array
    && b instanceof Uint8Array && a.length === b.length
    && a.every((byte, index) => byte === b[index])
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object'
    || Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = Reflect.ownKeys(left)
  return keys.length === Reflect.ownKeys(right).length
    && keys.every((key) => typeof key === 'string' && Object.hasOwn(right, key)
      && samePublicV14Value(left[key], right[key]))
}

/** Only for immutable Greenway facts after the V13 copier has rejected malformed shapes. */
function sameCopiedImmutableGreenwayValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object'
    || Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && a.length !== (b as unknown[]).length) return false
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key)
      && sameCopiedImmutableGreenwayValue(left[key], right[key]))
}

/** New-profile genesis only. The old generator supplies unchanged non-geometric facts. */
export function createFreshPublicV14State(seed: string): PublicV14State {
  if (typeof seed !== 'string' || !seed || seed.length > 128) throw new RangeError('Invalid v14 seed.')
  const facts = createStarterCliffGreenwayFacts(seed)
  const base = createGeneratedWorld(seed, 'greenway-expanded-v1')
  const { seed: _seed, generationProfile: _profile, tick: _tick, rng,
    eventSequence: _sequence, player, discoveredTileIds: _ids, ...greenway } = base
  const stones = highlandStoneNodes(seed).map(({ id }) => ({ id, readyAtTick: 0 }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return {
    seed, generationProfile: STARTER_CLIFF_PROFILE, movementOwner: 'greenway',
    tick: 0, rng, eventSequence: 0,
    player: { ...player, position: facts.playerStart },
    discoveryMask: encodeDiscoveredTileIds(nearbyWorldTileIds(facts.playerStart,
      PUBLIC_START_REVEAL_RADIUS_METERS)),
    greenway: { ...greenway, tiles: facts.tiles, resources: facts.resources,
      stores: facts.stores, fairyRings: facts.fairyRings,
      inscriptions: facts.inscriptions, digSites: facts.digSites, routes: facts.routes },
    mireglass: { ...createMireglassRegionProgress(seed), herbHarvestCycles: [] },
    fieldCampTileIds: [], terrainRevision: PUBLIC_V10_TERRAIN_REVISION,
    highlandContentRevision: HIGHLAND_CONTENT_REVISION,
    highland: { landmarkDiscovered: false, stoneNodes: stones },
    windContentRevision: HIGHLAND_WIND_CONTENT_REVISION,
    windstep: { learned: false, activeUntilTick: 0, nextCastTick: 0,
      practicedRouteIndices: [] }, terrainWorks: emptyTerrainWorkLedger(),
  } as PublicV14State
}

// Validation compares against genesis repeatedly during preview and replay. Keep only
// a few private, read-only baselines; callers still receive a newly generated world.
const MAX_CANONICAL_BASELINES = 4
const canonicalBaselines = new Map<string, PublicV14State>()
function canonicalBaseline(seed: string): PublicV14State {
  const cached = canonicalBaselines.get(seed)
  if (cached) {
    canonicalBaselines.delete(seed)
    canonicalBaselines.set(seed, cached)
    return cached
  }
  const fresh = createFreshPublicV14State(seed)
  canonicalBaselines.set(seed, fresh)
  if (canonicalBaselines.size > MAX_CANONICAL_BASELINES) {
    canonicalBaselines.delete(canonicalBaselines.keys().next().value!)
  }
  return fresh
}

// Bridge geometry depends only on the seed and canonical Greenway tiles. Keep
// the cached sites detached and frozen; every candidate route is still checked.
const canonicalBridgeSites = new Map<string, readonly RouteSite[]>()
function bridgeSitesForValidation(base: PublicV14State): readonly RouteSite[] {
  const seed = base.seed
  const cached = canonicalBridgeSites.get(seed)
  if (cached) {
    canonicalBridgeSites.delete(seed)
    canonicalBridgeSites.set(seed, cached)
    return cached
  }
  const sites = Object.freeze(canonicalRouteSites({ ...createGeneratedWorld(seed,
    'greenway-expanded-v1'), tiles: base.greenway.tiles } as WizardWorldState)
    .filter((site) => site.routeId === 'highland_bridge')
    .map((site) => Object.freeze({ ...site,
      from: Object.freeze({ ...site.from }), to: Object.freeze({ ...site.to }) })))
  canonicalBridgeSites.set(seed, sites)
  if (canonicalBridgeSites.size > MAX_CANONICAL_BASELINES) {
    canonicalBridgeSites.delete(canonicalBridgeSites.keys().next().value!)
  }
  return sites
}

/** V17 needs only these genesis facts. Detach them so no caller can mutate the cache. */
export function canonicalPublicV14StarterFacts(seed: string): Readonly<{
  playerStart: PublicV14State['player']['position']
  resources: PublicV14State['greenway']['resources']
}> {
  const baseline = canonicalBaseline(seed)
  return { playerStart: structuredClone(baseline.player.position),
    resources: structuredClone(baseline.greenway.resources) }
}

function validGreenway(state: PublicV14State, base: PublicV14State): boolean {
  const actual = state.greenway, canonical = base.greenway
  const immutable = ['schemaVersion', 'contentRevision', 'fixedStepMs', 'tiles', 'fairyRings',
    'inscriptions', 'digSites', 'areas', 'recipes'] as const
  if (!exact(actual, Object.keys(canonical))
    || immutable.some((field) => !sameCopiedImmutableGreenwayValue(actual[field], canonical[field]))
    || !Array.isArray(actual.resources) || actual.resources.length !== canonical.resources.length
    || !Array.isArray(actual.stores) || actual.stores.length !== canonical.stores.length
    || !Array.isArray(actual.routes) || actual.routes.length !== canonical.routes.length) return false
  if (!actual.resources.every((resource, index) => {
    const expected = canonical.resources[index]
    return count(resource.health) && resource.health <= expected.maxHealth
      && typeof resource.depleted === 'boolean' && (resource.health !== 0 || resource.depleted)
      && samePublicV14Value({ ...resource, health: expected.health,
        depleted: expected.depleted }, expected)
  })) return false
  if (!actual.stores.every((store, index) => {
    const expected = canonical.stores[index]
    return Array.isArray(store.listings) && store.listings.length === expected.listings.length
      && store.listings.every((listing, listingIndex) => {
        const initial = expected.listings[listingIndex]
        return count(listing.stock) && listing.stock <= initial.stock
          && samePublicV14Value({ ...listing, stock: initial.stock }, initial)
      }) && samePublicV14Value({ ...store, listings: expected.listings }, expected)
  })) return false
  const routeIds = canonical.routes.map((route) => route.id)
  if (!sortedFrom(actual.builtRouteIds, routeIds)
    || !sortedFrom(actual.unlockedRecipeIds, canonical.recipes.map((recipe) => recipe.id))
    || !actual.unlockedRecipeIds.includes('greenway_ladder')
    || !sortedFrom(actual.studiedInscriptionIds, canonical.inscriptions.map((item) => item.id))
    || !sortedFrom(actual.revealedDigSiteIds, canonical.digSites.map((item) => item.id))
    || !sortedFrom(actual.excavatedDigSiteIds, canonical.digSites.map((item) => item.id))
    || !actual.excavatedDigSiteIds.every((id) => actual.revealedDigSiteIds.includes(id))
    || actual.builtRouteIds.includes('highland_bridge')
      && (!actual.builtRouteIds.includes('greenway_ladder') || state.player.level < 2)
    || actual.unlockedRecipeIds.includes('highland_bridge') !==
      (actual.builtRouteIds.includes('greenway_ladder') && state.player.level >= 2)) return false
  const bridgeSites = bridgeSitesForValidation(base)
  if (!actual.routes.every((route, index) => {
    const expected = canonical.routes[index]
    const built = actual.builtRouteIds.includes(route.id)
    const site = route.id === 'greenway_ladder'
      ? { id: STARTER_CLIFF_SITE_ID, from: expected.from, to: expected.to }
      : bridgeSites.find((candidate) => candidate.id === route.siteId)
    if (built && (!site || route.siteId !== site.id) || !built && route.siteId !== null) return false
    return samePublicV14Value(route, { ...expected, siteId: built ? site!.id : null,
      from: built ? site!.from : expected.from, to: built ? site!.to : expected.to })
  })) return false
  const builtXp = (actual.builtRouteIds.includes('greenway_ladder') ? 60 : 0)
    + (actual.builtRouteIds.includes('highland_bridge') ? 80 : 0)
  return state.player.skillXp.construction >= builtXp && state.player.xp >= builtXp
}

/** Minimum XP already claimed by v14 routes, regional progress and terrain work. */
export function requiredPublicV14EarnedXpMinima(state: PublicV14State): Readonly<{
  total: number; construction: number; excavation: number
}> {
  const terrainBuilt = state.terrainWorks.builtWorkIds.reduce((total, id) => {
    const site = resolveTerrainWorkSite(state.seed, id)
    return total + (site?.kind === 'bridge' ? 80 : site?.kind === 'ladder' ? 60 : 0)
  }, 0)
  const terrainDug = state.terrainWorks.dugTileIds.length * 30
  const greenway = (state.greenway.builtRouteIds.includes('greenway_ladder') ? 60 : 0)
    + (state.greenway.builtRouteIds.includes('highland_bridge') ? 80 : 0)
  const regionalBuild = (state.mireglass.builtRoutes.bridge ? 80 : 0)
    + (state.mireglass.builtRoutes.ladder ? 60 : 0)
  const regionalOther = state.mireglass.depletedResourceIds.length * 20
    + state.mireglass.dugStumpIds.length * 30
    + (state.mireglass.cacheRevealed ? 10 : 0)
    + (state.mireglass.cacheExcavated ? 40 : 0)
  return {
    total: greenway + regionalBuild + regionalOther + terrainBuilt + terrainDug,
    construction: greenway + regionalBuild + terrainBuilt,
    excavation: state.mireglass.dugStumpIds.length * 30
      + (state.mireglass.cacheExcavated ? 40 : 0) + terrainDug,
  }
}

function validAdditions(state: PublicV14State): boolean {
  if (state.terrainRevision !== PUBLIC_V10_TERRAIN_REVISION
    || state.highlandContentRevision !== HIGHLAND_CONTENT_REVISION
    || state.windContentRevision !== HIGHLAND_WIND_CONTENT_REVISION
    || !Array.isArray(state.fieldCampTileIds) || state.fieldCampTileIds.length > 1
    || state.fieldCampTileIds.some((id) => typeof id !== 'string'
      || !discoveryMaskHasTileId(state.discoveryMask, id)
      || resolveFieldCampSite(state.seed, id) === null)) return false
  const context = { seed: state.seed, fieldCampTileIds: state.fieldCampTileIds,
    authoredBuiltRouteIds: [state.mireglass.builtRoutes.bridge, state.mireglass.builtRoutes.ladder]
      .filter((id): id is string => id !== null) }
  if (!isValidTerrainWorkLedger(state.terrainWorks, context)) return false
  const earned = requiredPublicV14EarnedXpMinima(state)
  if (state.player.xp < earned.total
    || state.player.skillXp.construction < earned.construction
    || state.player.skillXp.excavation < earned.excavation) return false
  if (!exact(state.highland, ['landmarkDiscovered', 'stoneNodes'])
    || typeof state.highland.landmarkDiscovered !== 'boolean'
    || !Array.isArray(state.highland.stoneNodes)) return false
  const stoneIds = highlandStoneNodes(state.seed).map(({ id }) => id).sort()
  if (state.highland.stoneNodes.length !== stoneIds.length
    || !state.highland.stoneNodes.every((node, index) => exact(node, ['id', 'readyAtTick'])
      && node.id === stoneIds[index] && count(node.readyAtTick)
      && (node.readyAtTick <= state.tick || node.readyAtTick - state.tick <= 3000))
    || !state.highland.landmarkDiscovered
      && state.highland.stoneNodes.some((node) => node.readyAtTick > 0)) return false
  const wind = state.windstep
  if (!exact(wind, ['learned', 'activeUntilTick', 'nextCastTick', 'practicedRouteIndices'])
    || typeof wind.learned !== 'boolean' || !count(wind.activeUntilTick)
    || !count(wind.nextCastTick) || wind.activeUntilTick > wind.nextCastTick
    || !Array.isArray(wind.practicedRouteIndices)
    || !wind.practicedRouteIndices.every((index, offset) =>
      isHighlandWindTrailSegmentIndex(index)
      && (offset === 0 || wind.practicedRouteIndices[offset - 1] < index))) return false
  if ((wind.activeUntilTick > state.tick
      && wind.activeUntilTick - state.tick > HIGHLAND_WINDWARD_STEP.durationTicks)
    || (wind.nextCastTick > state.tick
      && wind.nextCastTick - state.tick > HIGHLAND_WINDWARD_STEP.cooldownTicks)
    || (!wind.learned && (wind.activeUntilTick !== 0 || wind.nextCastTick !== 0
      || wind.practicedRouteIndices.length !== 0))
    || wind.learned && !state.highland.landmarkDiscovered) return false
  if (wind.activeUntilTick !== 0 || wind.nextCastTick !== 0) {
    const cast = wind.nextCastTick - HIGHLAND_WINDWARD_STEP.cooldownTicks
    if (cast < 0 || cast > state.tick
      || wind.activeUntilTick !== cast + HIGHLAND_WINDWARD_STEP.durationTicks) return false
  }
  return wind.practicedRouteIndices.length === 0 || wind.activeUntilTick > 0
}

/** Independent, fail-closed v14 proof. No v7-v13 profile or world validator is invoked. */
export function validatePublicV14State(value: unknown, expectedSeed: string): PublicV14State | null {
  try {
    const maskField = value !== null && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, 'discoveryMask') : null
    if (!maskField?.enumerable || !Object.hasOwn(maskField, 'value')
      || !isValidDiscoveryMask(maskField.value)
      || Reflect.ownKeys(maskField.value).length !== DISCOVERY_MASK_BYTES) return null
    const state = cloneBoundedPublicV13StateShape(value) as unknown as PublicV14State | null
    if (!state || typeof expectedSeed !== 'string' || !expectedSeed || expectedSeed.length > 128
      || state.seed !== expectedSeed || state.generationProfile !== STARTER_CLIFF_PROFILE
      || state.movementOwner !== 'greenway' && state.movementOwner !== 'streamed'
      || !count(state.tick) || !count(state.eventSequence)
      || !exact(state.rng, ['generation', 'simulation'])
      || !positiveUint32(state.rng.generation) || !positiveUint32(state.rng.simulation)) return null
    const base = canonicalBaseline(expectedSeed)
    if (state.rng.generation !== base.rng.generation
      || !isDiscoveryMaskSubset(base.discoveryMask, state.discoveryMask)
      || !discoveryMaskHasTileId(state.discoveryMask, PUBLIC_START_TILE_ID)) return null
    const { herbHarvestCycles, ...region } = state.mireglass
    if (!isValidMireglassWorldContent({ seed: state.seed, contentRevision: region.contentRevision,
      tick: state.tick, player: state.player, discoveredTileIds: [], expedition: region }, state.seed)
      || !Array.isArray(herbHarvestCycles)
      || herbHarvestCycles.length > mireglassHerbPatches(state.seed).length) return null
    const herbs = new Set(mireglassHerbPatches(state.seed).map((patch) => patch.id))
    if (!herbHarvestCycles.every((entry, index) => exact(entry, ['patchId', 'cycle'])
      && typeof entry.patchId === 'string' && herbs.has(entry.patchId)
      && (index === 0 || herbHarvestCycles[index - 1].patchId < entry.patchId)
      && count(entry.cycle) && entry.cycle <= Math.floor(state.tick / HERB_CYCLE_TICKS))) return null
    if (!validGreenway(state, base) || !validAdditions(state)) return null
    const position = state.player.position
    if (state.player.yaw < -1_000_000 || state.player.yaw > 1_000_000
      || state.player.pitch < -Math.PI / 2 || state.player.pitch > Math.PI / 2) return null
    const xs = base.greenway.tiles.map((tile) => tile.center.x)
    const zs = base.greenway.tiles.map((tile) => tile.center.z)
    const inGreenway = position.x >= Math.min(...xs) - WORLD_CELL_METERS / 2
      && position.x <= Math.max(...xs) + WORLD_CELL_METERS / 2
      && position.z >= Math.min(...zs) - WORLD_CELL_METERS / 2
      && position.z <= Math.max(...zs) + WORLD_CELL_METERS / 2
    if (state.movementOwner === 'greenway') {
      if (!inGreenway || !starterCliffPoseValid({ seed: state.seed, profile: state.generationProfile,
        route: state.greenway.routes[0] ?? null,
        built: state.greenway.builtRouteIds.includes('greenway_ladder') },
        position, state.player.verticalVelocity)) return null
    } else {
      const gx = Math.ceil(position.x / WORLD_CELL_METERS - 0.5)
      const gz = Math.ceil(position.z / WORLD_CELL_METERS - 0.5)
      if (inGreenway || gx < WORLD_GRID_MIN || gx > WORLD_GRID_MAX
        || gz < WORLD_GRID_MIN || gz > WORLD_GRID_MAX) return null
      const surface = resolvePublicV14Surface(state, position)
      if (!surface || surface.tileId !== `tile-${gx + 3}-${gz + 3}`
        || !Number.isFinite(surface.floorY) || !Number.isFinite(surface.terrainY)
        || state.player.verticalVelocity !== 0
        || Math.abs(position.y - surface.floorY) > 1e-6
        || !discoveryMaskHasTileId(state.discoveryMask, surface.tileId)
        || surface.support === 'terrain'
          && mireglassFenDepthAt(state.seed, gx * WORLD_CELL_METERS,
            gz * WORLD_CELL_METERS) !== null) return null
      const window = activeChunkCoordinates(position)
      if (window.length < 1 || window.length > 9
        || !window.some(({ chunkX, chunkZ }) =>
          chunkX === Math.floor(gx / WORLD_CHUNK_CELLS)
          && chunkZ === Math.floor(gz / WORLD_CHUNK_CELLS))
        || !discoveredTileIdsInActiveWindow(state.discoveryMask, position)
          .includes(surface.tileId)) return null
    }
    if (!preservesPublicV13History(base as never, state as never)) return null
    return state
  } catch { return null }
}
