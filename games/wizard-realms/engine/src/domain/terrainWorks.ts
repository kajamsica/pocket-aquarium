import { mireglassAnchors, mireglassFairyRing, mireglassResources } from './mireglassContent'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { mireglassRouteSites } from './mireglassRouteSites'
import { MIREGLASS_CORE, mireglassFenDepthAt, mireglassPlateauCliffBetween } from './mireglassTerrain'
import type { Vec3, WorldTile } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const CELL = WORLD_CELL_METERS
const CLEARANCE = CELL
const MAX_WINDOW_CELLS = 16
const DIRECTIONS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as const
type Direction = keyof typeof DIRECTIONS
type ParsedWorkId =
  | { kind: 'bridge'; gx: number; gz: number; axis: 'x' | 'z' }
  | { kind: 'ladder'; gx: number; gz: number; direction: Direction }
  | { kind: 'dig'; gx: number; gz: number }

export type TerrainWorkSite = Readonly<{
  id: string; kind: 'bridge' | 'ladder'; obstacle: 'fen_channel' | 'slate_cliff'
  from: Readonly<Vec3>; to: Readonly<Vec3>; approach: Readonly<Vec3>; exit: Readonly<Vec3>
  supportPath: readonly Readonly<Vec3>[]; footprintTileIds: readonly string[]
  widthMeters: number; logCost: 4 | 8; rewardClass: 'construction'
}> | Readonly<{
  id: string; kind: 'dig'; obstacle: 'suitable_ground'; center: Readonly<Vec3>
  loweredCenter: Readonly<Vec3>; footprintTileIds: readonly string[]
  depthMeters: 0.24; rewardClass: 'stone'
}>

export type TerrainWorkWindow = Readonly<{ minGX: number; maxGX: number; minGZ: number; maxGZ: number }>

/** IDs are canonical grid anchors, never serialized or client-supplied world coordinates. */
export function parseTerrainWorkId(id: unknown): ParsedWorkId | null {
  if (typeof id !== 'string') return null
  const bridge = /^works1:bridge:(-?\d+):(-?\d+):(x|z)$/.exec(id)
  const ladder = /^works1:ladder:(-?\d+):(-?\d+):([NESW])$/.exec(id)
  const dig = /^tile-(-?\d+)-(-?\d+)$/.exec(id)
  const match = bridge ?? ladder ?? dig
  if (!match) return null
  const gx = Number(match[1]) - (dig ? 3 : 0)
  const gz = Number(match[2]) - (dig ? 3 : 0)
  if (!Number.isSafeInteger(gx) || !Number.isSafeInteger(gz)) return null
  if (bridge && id === `works1:bridge:${gx}:${gz}:${bridge[3]}`)
    return { kind: 'bridge', gx, gz, axis: bridge[3] as 'x' | 'z' }
  if (ladder && id === `works1:ladder:${gx}:${gz}:${ladder[3]}`)
    return { kind: 'ladder', gx, gz, direction: ladder[3] as Direction }
  if (dig && id === `tile-${gx + 3}-${gz + 3}`) return { kind: 'dig', gx, gz }
  return null
}

const insideCore = (x: number, z: number, margin: number) =>
  x >= MIREGLASS_CORE.minX + margin && x <= MIREGLASS_CORE.maxX - margin
  && z >= MIREGLASS_CORE.minZ + margin && z <= MIREGLASS_CORE.maxZ - margin
const tileAt = (seed: string, x: number, z: number) => worldTileAtGrid(seed, x / CELL, z / CELL)
const walkableStep = (a: WorldTile, b: WorldTile) => Math.abs(a.center.y - b.center.y) <= 0.9
const segmentDistance = (p: Vec3, a: Vec3, b: Vec3) => {
  const dx = b.x - a.x, dz = b.z - a.z
  if (dx === 0 && dz === 0) return Math.hypot(p.x - a.x, p.z - a.z)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz)
}

function context(seed: string) {
  return {
    occupied: [...Object.values(mireglassAnchors(seed)).map(({ tile }) => tile.center),
      ...mireglassResources(seed).map(({ tile }) => tile.center),
      ...mireglassHerbPatches(seed).map(({ tile }) => tile.center),
      mireglassFairyRing(seed).tile.center],
    routes: mireglassRouteSites(seed),
  }
}
type Context = ReturnType<typeof context>
const clear = (occupied: readonly Vec3[], a: Vec3, b: Vec3) =>
  occupied.every((point) => segmentDistance(point, a, b) >= CLEARANCE)

function resolve(seed: string, id: string, ctx: Context): TerrainWorkSite | null {
  const parsed = parseTerrainWorkId(id)
  if (!parsed) return null
  const x = parsed.gx * CELL, z = parsed.gz * CELL
  if (!insideCore(x, z, parsed.kind === 'dig' ? CELL : 2 * CELL)) return null
  if (parsed.kind === 'dig') {
    const ground = tileAt(seed, x, z)
    const neighbors = Object.values(DIRECTIONS).map(([dx, dz]) => tileAt(seed, x + dx * CELL, z + dz * CELL))
    const loweredCenter = { ...ground.center, y: ground.center.y - 0.24 }
    if (ground.terrain !== 'loam' || mireglassFenDepthAt(seed, x, z) !== null
      || neighbors.some((tile) => tile.terrain !== 'loam' || Math.abs(tile.center.y - loweredCenter.y) > 0.9)
      || Object.values(DIRECTIONS).some(([dx, dz]) =>
        mireglassPlateauCliffBetween(seed, x, z, x + dx * CELL, z + dz * CELL))
      || !clear(ctx.occupied, ground.center, ground.center)
      || ctx.routes.some((site) => segmentDistance(ground.center, site.from, site.to) < CLEARANCE)) return null
    return { id, kind: 'dig', obstacle: 'suitable_ground', center: { ...ground.center },
      loweredCenter, footprintTileIds: [ground.id], depthMeters: 0.24, rewardClass: 'stone' }
  }
  if (parsed.kind === 'bridge') {
    const [dx, dz] = parsed.axis === 'x' ? [1, 0] : [0, 1]
    const approach = tileAt(seed, x - 2 * dx * CELL, z - 2 * dz * CELL)
    const from = tileAt(seed, x - dx * CELL, z - dz * CELL)
    const water = tileAt(seed, x, z)
    const to = tileAt(seed, x + dx * CELL, z + dz * CELL)
    const exit = tileAt(seed, x + 2 * dx * CELL, z + 2 * dz * CELL)
    if (mireglassFenDepthAt(seed, x, z) !== 'shallow' || water.terrain !== 'wetland'
      || [approach, from, to, exit].some((tile) => tile.terrain !== 'loam')
      || !walkableStep(approach, from) || !walkableStep(from, water)
      || !walkableStep(water, to) || !walkableStep(to, exit)
      || !clear(ctx.occupied, approach.center, exit.center)
      || mireglassMoveBarrier(seed, from.center, water.center) !== 'fen_channel'
      || mireglassMoveBarrier(seed, water.center, to.center) !== 'fen_channel') return null
    return { id, kind: 'bridge', obstacle: 'fen_channel', from: { ...from.center }, to: { ...to.center },
      approach: { ...approach.center }, exit: { ...exit.center },
      supportPath: [{ ...from.center }, { ...water.center, y: Math.max(from.center.y, to.center.y) + 0.16 },
        { ...to.center }], footprintTileIds: [approach.id, from.id, water.id, to.id, exit.id],
      widthMeters: 1.6, logCost: 8, rewardClass: 'construction' }
  }
  const [dx, dz] = DIRECTIONS[parsed.direction]
  const approach = tileAt(seed, x - dx * CELL, z - dz * CELL)
  const from = tileAt(seed, x, z)
  const to = tileAt(seed, x + dx * CELL, z + dz * CELL)
  const exit = tileAt(seed, x + 2 * dx * CELL, z + 2 * dz * CELL)
  if (!mireglassPlateauCliffBetween(seed, x, z, to.center.x, to.center.z)
    || approach.terrain !== 'loam' || from.terrain !== 'loam'
    || to.terrain !== 'rocky' || exit.terrain !== 'rocky'
    || Math.abs(to.center.y - from.center.y - 1.56) > 1e-6
    || !walkableStep(approach, from) || !walkableStep(to, exit)
    || !clear(ctx.occupied, approach.center, exit.center)
    || mireglassMoveBarrier(seed, from.center, to.center) !== 'slate_cliff') return null
  const nearFace = (t: number, y: number) => ({ x: from.center.x + dx * CELL * t, y,
    z: from.center.z + dz * CELL * t })
  return { id, kind: 'ladder', obstacle: 'slate_cliff', from: { ...from.center }, to: { ...to.center },
    approach: { ...approach.center }, exit: { ...exit.center },
    supportPath: [{ ...from.center }, nearFace(0.41875, from.center.y),
      nearFace(0.58125, to.center.y), { ...to.center }],
    footprintTileIds: [approach.id, from.id, to.id, exit.id],
    widthMeters: 1.05, logCost: 4, rewardClass: 'construction' }
}

/** Pure intrinsic geometry only; player reach, inventory and mutable occupancy belong to action authority. */
export function resolveTerrainWorkSite(seed: string, id: string): TerrainWorkSite | null {
  if (typeof seed !== 'string' || typeof id !== 'string' || !parseTerrainWorkId(id)) return null
  try { const normalized = seed || 'wizard-realms'; return resolve(normalized, id, context(normalized)) }
  catch { return null }
}

/** A caller scans at most one 16 by 16 cell window, never the full 2 km world. */
export function enumerateTerrainWorkSites(seed: string, window: TerrainWorkWindow): readonly TerrainWorkSite[] {
  if (typeof seed !== 'string') throw new TypeError('Terrain work seed must be a string.')
  if (window === null || typeof window !== 'object') throw new RangeError('Terrain work window is required.')
  const { minGX, maxGX, minGZ, maxGZ } = window
  if (![minGX, maxGX, minGZ, maxGZ].every(Number.isSafeInteger)
    || maxGX < minGX || maxGZ < minGZ
    || maxGX - minGX >= MAX_WINDOW_CELLS || maxGZ - minGZ >= MAX_WINDOW_CELLS) {
    throw new RangeError('Terrain work window must contain at most 16 by 16 canonical cells.')
  }
  const normalized = seed || 'wizard-realms'
  const ctx = context(normalized)
  const sites: TerrainWorkSite[] = []
  for (let gz = minGZ; gz <= maxGZ; gz++) for (let gx = minGX; gx <= maxGX; gx++) {
    for (const id of [`works1:bridge:${gx}:${gz}:x`, `works1:bridge:${gx}:${gz}:z`,
      ...Object.keys(DIRECTIONS).map((direction) => `works1:ladder:${gx}:${gz}:${direction}`),
      `tile-${gx + 3}-${gz + 3}`]) {
      const site = resolve(normalized, id, ctx)
      if (site) sites.push(site)
    }
  }
  return sites.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
