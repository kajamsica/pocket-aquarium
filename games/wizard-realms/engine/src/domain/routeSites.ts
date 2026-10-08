import { areaAt, STORE_HALF_DEPTH, STORE_HALF_WIDTH, terrainHeightAt } from './generation'
import type { AreaId, RouteBuildOption, RouteSite, Vec3, WizardWorldState, WorldTile } from './types'

const SITE_STEP = 2
const BUILD_DISTANCE = 3
const LANDMARK_CLEARANCE = 1.5

const planarDistance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z)
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const logsOwned = (state: WizardWorldState) => state.player.inventory
  .filter((stack) => stack.itemId === 'logs').reduce((total, stack) => total + stack.quantity, 0)

function nearestAreaTile(state: WizardWorldState, point: Vec3, areaId: AreaId): WorldTile | undefined {
  let nearest: WorldTile | undefined
  let nearestDistance = Infinity
  for (const tile of state.tiles) {
    if (areaAt(state.areas, tile.center.x, tile.center.z).id !== areaId) continue
    const separation = planarDistance(tile.center, point)
    if (separation < nearestDistance) {
      nearest = tile
      nearestDistance = separation
    }
  }
  return nearest
}

function segmentDistance(point: Vec3, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const lengthSquared = dx * dx + dz * dz
  const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared))
  return Math.hypot(point.x - from.x - projection * dx, point.z - from.z - projection * dz)
}

function intersectsStore(site: RouteSite, store: WizardWorldState['stores'][number]): boolean {
  if (site.from.x === site.to.x) return Math.abs(site.from.x - store.position.x) < STORE_HALF_WIDTH
    && Math.max(site.from.z, site.to.z) > store.position.z - STORE_HALF_DEPTH
    && Math.min(site.from.z, site.to.z) < store.position.z + STORE_HALF_DEPTH
  return Math.abs(site.from.z - store.position.z) < STORE_HALF_DEPTH
    && Math.max(site.from.x, site.to.x) > store.position.x - STORE_HALF_WIDTH
    && Math.min(site.from.x, site.to.x) < store.position.x + STORE_HALF_WIDTH
}

function obstructedReason(state: WizardWorldState, site: RouteSite, fromAreaId: AreaId, toAreaId: AreaId): string | null {
  const fromTile = nearestAreaTile(state, site.from, fromAreaId)
  const toTile = nearestAreaTile(state, site.to, toAreaId)
  if (!fromTile || !toTile || fromTile.terrain === 'wetland' || toTile.terrain === 'wetland'
    || !Number.isFinite(site.from.y) || !Number.isFinite(site.to.y)) return 'The ground cannot support this route.'
  if (state.stores.some((store) => intersectsStore(site, store))) return 'A store blocks this site.'
  const landmarks = [...state.fairyRings, ...state.inscriptions, ...state.digSites]
  if (landmarks.some((landmark) => segmentDistance(landmark.position, site.from, site.to) < LANDMARK_CLEARANCE)) return 'A landmark blocks this site.'
  if (state.resources.some((resource) => !resource.depleted
    && segmentDistance(resource.position, site.from, site.to) < LANDMARK_CLEARANCE)) return 'Clear the resource from this site.'
  if (state.routes.some((route) => route.siteId !== null && route.id !== site.routeId
    && (segmentDistance(route.from, site.from, site.to) < LANDMARK_CLEARANCE
      || segmentDistance(route.to, site.from, site.to) < LANDMARK_CLEARANCE))) return 'A completed route blocks this site.'
  return null
}

export function canonicalRouteSites(state: WizardWorldState): readonly RouteSite[] {
  const greenway = state.areas.find((area) => area.id === 'greenway')!
  const ridge = state.areas.find((area) => area.id === 'northern_ridge')!
  const highland = state.areas.find((area) => area.id === 'eastern_highland')!
  const sites: RouteSite[] = []
  const ladderFromZ = greenway.minZ
  const ladderToZ = ladderFromZ - 4
  const ladderMinX = Math.ceil(Math.max(greenway.minX, ridge.minX) / SITE_STEP) * SITE_STEP
  const ladderMaxX = Math.min(greenway.maxX, ridge.maxX)
  for (let x = ladderMinX; x <= ladderMaxX; x += SITE_STEP) {
    if (areaAt(state.areas, x, ladderFromZ).id !== 'greenway'
      || areaAt(state.areas, x, ladderToZ).id !== 'northern_ridge') continue
    sites.push({ id: `greenway_ladder:x:${x}`, routeId: 'greenway_ladder',
      from: { x, y: terrainHeightAt(state.tiles, x, ladderFromZ), z: ladderFromZ },
      to: { x, y: terrainHeightAt(state.tiles, x, ladderToZ), z: ladderToZ } })
  }
  const bridgeFromX = ridge.maxX
  const bridgeToX = bridgeFromX + SITE_STEP
  const bridgeMinZ = Math.ceil(Math.max(ridge.minZ, highland.minZ) / SITE_STEP) * SITE_STEP
  const bridgeMaxZ = Math.min(ridge.maxZ, highland.maxZ)
  for (let z = bridgeMinZ; z <= bridgeMaxZ; z += SITE_STEP) {
    if (areaAt(state.areas, bridgeFromX, z).id !== 'northern_ridge'
      || areaAt(state.areas, bridgeToX, z).id !== 'eastern_highland') continue
    sites.push({ id: `highland_bridge:z:${z}`, routeId: 'highland_bridge',
      from: { x: bridgeFromX, y: terrainHeightAt(state.tiles, bridgeFromX, z), z },
      to: { x: bridgeToX, y: terrainHeightAt(state.tiles, bridgeToX, z), z } })
  }
  return sites
}

export function routeBuildOptions(state: WizardWorldState): readonly RouteBuildOption[] {
  return canonicalRouteSites(state).map((site) => {
    const route = state.routes.find((candidate) => candidate.id === site.routeId)!
    const recipe = state.recipes.find((candidate) => candidate.routeId === site.routeId)!
    const option = (status: RouteBuildOption['status'], reason: string): RouteBuildOption => ({ ...site, status, reason })
    if (route.siteId === site.id) return option('built', 'This route is complete here.')
    if (state.builtRouteIds.includes(site.routeId)) return option('locked', 'This route is complete at another site.')
    if (recipe.prerequisiteRouteId && !state.builtRouteIds.includes(recipe.prerequisiteRouteId))
      return option('locked', 'Build the Greenway ladder first.')
    if (!state.unlockedRecipeIds.includes(recipe.id) || state.player.level < recipe.minimumLevel)
      return option('locked', `Reach level ${recipe.minimumLevel} to unlock this route.`)
    const sourceTile = nearestAreaTile(state, site.from, route.fromAreaId)
    if (!sourceTile || !state.discoveredTileIds.includes(sourceTile.id)) return option('locked', 'Discover this boundary first.')
    const obstruction = obstructedReason(state, site, route.fromAreaId, route.toAreaId)
    if (obstruction) return option('obstructed', obstruction)
    if (areaAt(state.areas, state.player.position.x, state.player.position.z).id !== route.fromAreaId
      || distance(state.player.position, site.from) > BUILD_DISTANCE) return option('too_far', 'Approach this site from the route source area.')
    if (logsOwned(state) < recipe.logCost) return option('needs_logs', `Requires ${recipe.logCost} logs.`)
    return option('ready', 'Ready to build.')
  })
}
