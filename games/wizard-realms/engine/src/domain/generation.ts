import type {
  AreaProfile, BiomeId, FairyRing, PlayerState, RecipeProfile, ResourceKind, RouteProfile,
  StoreState, TerrainId, WizardWorldState, WorldTile,
} from './types'

const SIZE = 7
const TILE_METERS = 4
const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

export function hashSeed(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0 || 1
}

function unit(seed: string): number {
  let value = hashSeed(seed)
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return (value >>> 0) / 4294967296
}

function classify(elevation: number, temperature: number, moisture: number): [BiomeId, TerrainId] {
  if (temperature < 0.32) return ['alpine', 'snow']
  if (moisture > 0.65 && elevation < 0.52) return ['marsh', 'wetland']
  if (elevation > 0.58 && moisture < 0.45) return ['dry_highland', 'rocky']
  return ['temperate_forest', 'loam']
}

const resourceByBiome: Record<BiomeId, ResourceKind> = {
  temperate_forest: 'tree', marsh: 'herb', dry_highland: 'stone', alpine: 'ore',
}

function makeTiles(seed: string): WorldTile[] {
  const tiles: WorldTile[] = []
  for (let gridZ = 0; gridZ < SIZE; gridZ += 1) for (let gridX = 0; gridX < SIZE; gridX += 1) {
    const nx = (gridX - 3) / 3
    const nz = (gridZ - 3) / 3
    const key = `${seed}:tile:${gridX}:${gridZ}`
    const elevation = clamp01(0.36 + Math.max(nx, 0) * 0.34 + Math.max(-nz, 0) * 0.26 + (unit(`${key}:e`) - 0.5) * 0.12)
    const temperature = clamp01(0.82 - elevation * 0.55 - Math.max(-nz, 0) * 0.28 + (unit(`${key}:t`) - 0.5) * 0.08)
    const moisture = clamp01(0.56 - Math.max(nx, 0) * 0.42 + Math.max(nz, 0) * 0.22 + (unit(`${key}:m`) - 0.5) * 0.18)
    const [biome, terrain] = classify(elevation, temperature, moisture)
    tiles.push({ id: `tile-${gridX}-${gridZ}`, gridX, gridZ, center: { x: (gridX - 3) * TILE_METERS, y: elevation * 3, z: (gridZ - 3) * TILE_METERS }, elevation, temperature, moisture, terrain, biome })
  }
  return tiles
}

export const AREA_PROFILES: readonly AreaProfile[] = [
  { id: 'greenway', name: 'Greenway', minX: -12, maxX: 12, minZ: -4, maxZ: 12 },
  { id: 'northern_ridge', name: 'Northern Ridge', minX: -12, maxX: 4, minZ: -12, maxZ: -4 },
  { id: 'eastern_highland', name: 'Eastern Highland', minX: 4, maxX: 12, minZ: -12, maxZ: -4 },
]

export const RECIPE_PROFILES: readonly RecipeProfile[] = [
  { id: 'greenway_ladder', name: 'Greenway ladder', routeId: 'greenway_ladder', logCost: 4, xpReward: 60, minimumLevel: 1, prerequisiteRouteId: null },
  { id: 'highland_bridge', name: 'Highland bridge', routeId: 'highland_bridge', logCost: 6, xpReward: 80, minimumLevel: 2, prerequisiteRouteId: 'greenway_ladder' },
]

export function areaAt(areas: readonly AreaProfile[], x: number, z: number): AreaProfile {
  return areas.find((area) => x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ) ?? areas[0]
}

export function terrainHeightAt(tiles: readonly WorldTile[], x: number, z: number): number {
  return tiles.reduce((closest, tile) => {
    const closestDistance = Math.hypot(x - closest.center.x, z - closest.center.z)
    return Math.hypot(x - tile.center.x, z - tile.center.z) < closestDistance ? tile : closest
  }).center.y
}

function makePlayer(tiles: readonly WorldTile[]): PlayerState {
  const empty = (slotIndex: 0 | 1 | 2 | 3) => ({ slotIndex, itemId: null, quantity: 0, unitPrice: 0 } as const)
  return {
    position: { x: 0, y: terrainHeightAt(tiles, 0, 0), z: 0 }, verticalVelocity: 0,
    yaw: 0, pitch: 0, coins: 120, xp: 0, level: 1,
    backpackCapacity: 20, inventory: [{ itemId: 'woodcutters_axe', quantity: 1 }],
    equipment: { head: null, chest: null, legs: null, feet: null, mainHand: null, offHand: null },
    tradeSlots: [empty(0), empty(1), empty(2), empty(3)], discoveredRingIds: [],
  }
}

export function createGeneratedWorld(seed: string): WizardWorldState {
  const normalizedSeed = seed || 'wizard-realms'
  const tiles = makeTiles(normalizedSeed)
  const resources = tiles.map((tile) => {
    const kind = resourceByBiome[tile.biome]
    const maxHealth = kind === 'tree' ? 2 : 1
    return { id: `resource-${tile.id}`, tileId: tile.id, kind, position: { x: tile.center.x + (unit(`${normalizedSeed}:${tile.id}:x`) - 0.5) * 1.5, y: tile.center.y, z: tile.center.z + (unit(`${normalizedSeed}:${tile.id}:z`) - 0.5) * 1.5 }, health: maxHealth, maxHealth, depleted: false }
  })
  const greenwayTrees = tiles.filter((tile) => tile.center.z >= -4).slice(0, 4).map((tile, index) => ({
    id: `greenway-journey-tree-${index}`, tileId: tile.id, kind: 'tree' as const,
    position: { x: tile.center.x + 1.15, y: tile.center.y, z: tile.center.z - 1.15 },
    health: 2, maxHealth: 2, depleted: false,
  }))
  resources.push(...greenwayTrees)
  const stores: [StoreState, StoreState] = [
    { id: 'store-greenway', name: 'Greenway Outfitters', position: { x: -2, y: terrainHeightAt(tiles, -2, 2), z: 2 }, listings: [{ id: 'hat', itemId: 'apprentice_hat', price: 20, stock: 3 }, { id: 'axe', itemId: 'woodcutters_axe', price: 35, stock: 2 }] },
    { id: 'store-highland', name: 'Highland Arcanum', position: { x: 8, y: terrainHeightAt(tiles, 8, -8), z: -8 }, listings: [{ id: 'wand', itemId: 'oak_wand', price: 45, stock: 2 }, { id: 'shield', itemId: 'wooden_shield', price: 40, stock: 2 }] },
  ]
  const fairyRings: FairyRing[] = [
    { id: 'ring-greenway', name: 'Greenway Ring', kind: 'mushroom', position: { x: 2, y: terrainHeightAt(tiles, 2, -2), z: -2 } },
    { id: 'ring-highland', name: 'Highland Ring', kind: 'mushroom', position: { x: 8, y: terrainHeightAt(tiles, 8, -8), z: -8 } },
  ]
  const route = (profile: Omit<RouteProfile, 'from' | 'to'>, from: [number, number], to: [number, number]): RouteProfile => ({
    ...profile,
    from: { x: from[0], y: terrainHeightAt(tiles, from[0], from[1]), z: from[1] },
    to: { x: to[0], y: terrainHeightAt(tiles, to[0], to[1]), z: to[1] },
  })
  const routes: RouteProfile[] = [
    route({ id: 'greenway_ladder', name: 'Greenway ladder', fromAreaId: 'greenway', toAreaId: 'northern_ridge' }, [0, -4], [0, -8]),
    route({ id: 'highland_bridge', name: 'Highland bridge', fromAreaId: 'northern_ridge', toAreaId: 'eastern_highland' }, [4, -8], [8, -8]),
  ]
  const areas = AREA_PROFILES.map((area) => ({ ...area }))
  const recipes = RECIPE_PROFILES.map((recipe) => ({ ...recipe }))
  const discoveredTileIds = tiles.filter((tile) => areaAt(areas, tile.center.x, tile.center.z).id === 'greenway').map((tile) => tile.id).sort()
  const generation = hashSeed(`${normalizedSeed}:generation`)
  return {
    schemaVersion: 'wizard-world/v2', seed: normalizedSeed, tick: 0, fixedStepMs: 50,
    rng: { generation, simulation: hashSeed(`${normalizedSeed}:simulation`) }, tiles, resources, stores,
    fairyRings, areas, routes, recipes, builtRouteIds: [], unlockedRecipeIds: ['greenway_ladder'],
    discoveredTileIds, player: makePlayer(tiles), eventSequence: 0,
  }
}
