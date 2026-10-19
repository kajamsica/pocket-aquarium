import { MIREGLASS_CORE, MIREGLASS_ENVELOPES } from './mireglassTerrain'
import type { PublicV23Corridor } from './publicWorldV23Sites'
import { publicV25RiverCellAtGrid, publicV25RiverCenterZ } from './publicWorldV25River'
import type { Vec3, WorldTile } from './types'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN, worldTileAtGrid } from './worldChunks'

const MAX_WINDOW_CELLS = 16
const MAX_BANK_GRADE_METERS = 0.55
const OWNER_BUFFER_METERS = 8
const DECK_RISE_METERS = 0.16
const WIDTH_METERS = 1.6

export type PublicV28RiverBridgeWindow = Readonly<{
  minGX: number; maxGX: number; minGZ: number; maxGZ: number
}>

export type PublicV28RiverBridgeSite = Readonly<{
  id: string; kind: 'bridge'; obstacle: 'connected_river'
  approach: Readonly<Vec3>; from: Readonly<Vec3>; to: Readonly<Vec3>; exit: Readonly<Vec3>
  supportPath: readonly Readonly<Vec3>[]
  footprintTileIds: readonly string[]; wetGapTileIds: readonly string[]
  corridor: PublicV23Corridor
  widthMeters: typeof WIDTH_METERS; logCost: 8; xpReward: 80; rewardClass: 'construction'
}>

const validGrid = (value: number) => Number.isSafeInteger(value)
  && value >= WORLD_GRID_MIN && value <= WORLD_GRID_MAX
const validSeed = (seed: unknown): seed is string => typeof seed === 'string'
  && seed.length > 0 && seed.length <= 128

/** IDs carry only the column. The seed and V25 river supply every other coordinate. */
export function parsePublicV28RiverBridgeId(id: unknown): number | null {
  if (typeof id !== 'string') return null
  const match = /^works6:river-bridge:(-?(?:0|[1-9]\d*))$/.exec(id)
  if (!match || match[1] === '-0') return null
  const gx = Number(match[1])
  return validGrid(gx) && String(gx) === match[1] ? gx : null
}

export function publicV28RiverBridgeId(gx: number): string {
  if (!validGrid(gx)) throw new RangeError('River bridge column is outside the world.')
  return `works6:river-bridge:${gx}`
}

const inside = (point: Vec3, rect: Readonly<{
  minX: number; maxX: number; minZ: number; maxZ: number
}>, margin: number) => point.x >= rect.minX - margin && point.x <= rect.maxX + margin
  && point.z >= rect.minZ - margin && point.z <= rect.maxZ + margin

const GREENWAY_OWNER = { minX: -30, maxX: 34, minZ: -30, maxZ: 34 } as const
const protectedRects = [GREENWAY_OWNER, MIREGLASS_CORE,
  ...Object.values(MIREGLASS_ENVELOPES)] as const
const protectedPoint = (point: Vec3) => protectedRects.some((rect) =>
  inside(point, rect, OWNER_BUFFER_METERS))
const dryLoam = (seed: string, tile: WorldTile) => tile.terrain === 'loam'
  && !publicV25RiverCellAtGrid(seed, tile.gridX - 3, tile.gridZ - 3)
const grade = (a: WorldTile, b: WorldTile) =>
  Math.abs(a.center.y - b.center.y) <= MAX_BANK_GRADE_METERS

function resolve(seed: string, gx: number): PublicV28RiverBridgeSite | null {
  // Both lateral columns are needed to reject an unsafe diagonal dry approach.
  if (gx <= WORLD_GRID_MIN || gx >= WORLD_GRID_MAX) return null
  const centers = [publicV25RiverCenterZ(seed, gx - 1), publicV25RiverCenterZ(seed, gx)]
  const firstWet = Math.min(...centers), lastWet = Math.max(...centers)
  if (lastWet - firstWet > 1 || firstWet - 2 < WORLD_GRID_MIN
    || lastWet + 2 > WORLD_GRID_MAX) return null
  const rows = Array.from({ length: lastWet - firstWet + 5 }, (_, index) =>
    firstWet - 2 + index)
  const tiles = rows.map((gz) => worldTileAtGrid(seed, gx, gz))
  const [approach, from] = tiles
  const to = tiles[tiles.length - 2], exit = tiles[tiles.length - 1]
  const wet = tiles.slice(2, -2)
  if (!wet.every((tile) => publicV25RiverCellAtGrid(seed, gx, tile.gridZ - 3))
    || ![approach, from, to, exit].every((tile) => dryLoam(seed, tile))
    || !grade(approach, from) || !grade(from, to) || !grade(to, exit)
    || tiles.some((tile) => protectedPoint(tile.center))) return null
  for (const sideGX of [gx - 1, gx + 1]) {
    // The guarded 1.6 m deck never reaches the neighboring 4 m column. A
    // meander can therefore touch a bank diagonally without wetting the deck.
    if ([approach, exit].some((tile) =>
      publicV25RiverCellAtGrid(seed, sideGX, tile.gridZ - 3))) return null
  }
  const deckY = Math.max(from.center.y, to.center.y) + DECK_RISE_METERS
  if (wet.some((tile) => deckY <= tile.center.y + 0.01)) return null
  const supportPath = [from.center, ...wet.map((tile) => ({ ...tile.center, y: deckY })), to.center]
    .map((point) => ({ ...point }))
  const span = to.center.z - from.center.z
  return { id: publicV28RiverBridgeId(gx), kind: 'bridge', obstacle: 'connected_river',
    approach: { ...approach.center }, from: { ...from.center }, to: { ...to.center },
    exit: { ...exit.center }, supportPath,
    footprintTileIds: tiles.map((tile) => tile.id), wetGapTileIds: wet.map((tile) => tile.id),
    corridor: { center: { x: from.center.x, y: deckY,
      z: (from.center.z + to.center.z) / 2 }, normal: { x: 0, z: 1 },
    tangent: { x: 1, z: 0 }, halfLength: span / 2, halfWidth: WIDTH_METERS / 2 + 0.04 },
    widthMeters: WIDTH_METERS, logCost: 8, xpReward: 80, rewardClass: 'construction' }
}

/** Pure geometry and intrinsic clearance; reach, inventory and mutable occupancy belong to V28 authority. */
export function resolvePublicV28RiverBridge(seed: string, id: unknown): PublicV28RiverBridgeSite | null {
  const gx = parsePublicV28RiverBridgeId(id)
  if (!validSeed(seed) || gx === null) return null
  try { return resolve(seed, gx) } catch { return null }
}

/** Resolve only a local, in-world 16 by 16 window, never the full river at render time. */
export function enumeratePublicV28RiverBridges(seed: string,
  window: PublicV28RiverBridgeWindow): readonly PublicV28RiverBridgeSite[] {
  if (!validSeed(seed)) throw new RangeError('River bridge seed must be nonempty and at most 128 characters.')
  if (!window || typeof window !== 'object') throw new RangeError('River bridge window is required.')
  const { minGX, maxGX, minGZ, maxGZ } = window
  if (![minGX, maxGX, minGZ, maxGZ].every(validGrid)
    || maxGX < minGX || maxGZ < minGZ
    || maxGX - minGX >= MAX_WINDOW_CELLS || maxGZ - minGZ >= MAX_WINDOW_CELLS) {
    throw new RangeError('River bridge window must contain at most 16 by 16 in-world cells.')
  }
  const sites: PublicV28RiverBridgeSite[] = []
  for (let gx = minGX; gx <= maxGX; gx++) {
    const site = resolve(seed, gx)
    if (site && site.footprintTileIds.every((_, index) => {
      const gz = site.approach.z / WORLD_CELL_METERS + index
      return gz >= minGZ && gz <= maxGZ
    })) sites.push(site)
  }
  return sites
}
