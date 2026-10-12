import { publicV14InsideGreenway } from './publicWorldV14Boundary'
import { STORE_HALF_DEPTH, STORE_HALF_WIDTH } from './generation'
import { PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS, PUBLIC_V15_STARTER_CREEK_BOUNDS,
  publicWorldV15ClearStarterResources } from './publicWorldV15StarterSites'
import { publicWorldV16TileAtGrid, resolvePublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import type { PublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import { createStarterCliffGreenwayFacts } from './starterCliffWorld'
import type { Vec3, WorldTile } from './types'
import { WORLD_CELL_METERS } from './worldChunks'

type Kind = 'bridge' | 'ladder'
type Structure = Extract<PublicV16GreenwaySite, { kind: Kind }>
const MAX_STEP = 0.55
const BRIDGE_HALF_WIDTH = PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS / 2 + 0.04
const LADDER_HALF_WIDTH = 1.05 / 2 + 0.015
const radius = { tree: 0.55, ore: 0.7, stone: 0.61, herb: 0.7 } as const
const MAX_CACHED_WORKS4_SITES = 64
const works4Sites = new Map<string, Structure | null>()

function validQ(kind: Kind, q: number): boolean {
  return Number.isSafeInteger(q) && (kind === 'bridge' ? Math.abs(q) <= 91
    : Math.abs(q) <= 294 && Math.abs(q) > 10)
}

/** Tie handling is intentionally asymmetric: -0.05 m snaps to zero, +0.05 m to +0.1 m. */
export function placementId(kind: Kind, aimX: number): string | null {
  if ((kind !== 'bridge' && kind !== 'ladder') || !Number.isFinite(aimX)) return null
  const q = Math.floor(aimX * 10 + 0.5)
  return validQ(kind, q) ? `works4:${kind}:${kind === 'bridge' ? 'greenway-creek'
    : 'greenway-north-cliff'}:${q}` : null
}

function parse(id: string): { kind: Kind; q: number } | null {
  const match = /^works4:(bridge|ladder):(greenway-creek|greenway-north-cliff):(-?(?:0|[1-9]\d*))$/.exec(id)
  if (!match || (match[1] === 'bridge') !== (match[2] === 'greenway-creek')
    || match[3] === '-0') return null
  const kind = match[1] as Kind, q = Number(match[3])
  return validQ(kind, q) && String(q) === match[3] ? { kind, q } : null
}

/** Every cell with positive area under the support's horizontal width is affected. */
function columns(x: number, halfWidth: number): number[] {
  const min = Math.floor((x - halfWidth + WORLD_CELL_METERS / 2) / WORLD_CELL_METERS)
  const max = Math.ceil((x + halfWidth + WORLD_CELL_METERS / 2) / WORLD_CELL_METERS) - 1
  return Array.from({ length: max - min + 1 }, (_, index) => min + index)
}
const anchorColumn = (x: number) => Math.ceil(x / WORLD_CELL_METERS - 0.5)
const step = (a: WorldTile, b: WorldTile) => Math.abs(a.center.y - b.center.y) <= MAX_STEP
const dry = (tile: WorldTile) => tile.terrain !== 'wetland' && publicV14InsideGreenway(tile.center)

function resourceScale(id: string): number {
  let hash = 2166136261 ^ 2
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  hash ^= hash >>> 15
  hash = Math.imul(hash, 2246822507)
  hash ^= hash >>> 13
  return 0.88 + (hash >>> 0) / 4294967296 * 0.24
}

function touches(point: Vec3, x: number, minZ: number, maxZ: number,
  reach: number): boolean {
  const dz = Math.max(minZ - point.z, 0, point.z - maxZ)
  return Math.hypot(point.x - x, dz) <= reach
}

function blockers(seed: string, kind: Kind, x: number): string[] | null {
  const facts = createStarterCliffGreenwayFacts(seed)
  const resources = publicWorldV15ClearStarterResources(seed, facts.resources)
  const minZ = kind === 'bridge' ? 3.5 : -6.5
  const maxZ = kind === 'bridge' ? 12.5 : -4.85
  const halfWidth = kind === 'bridge' ? BRIDGE_HALF_WIDTH : LADDER_HALF_WIDTH
  const landmarks = [
    ...facts.fairyRings.map(({ position }) => ({ position, radius: 1.7 })),
    ...facts.inscriptions.map(({ position }) => ({ position, radius: 0.9 })),
    ...facts.digSites.map(({ position }) => ({ position, radius: 1 })),
  ]
  if (landmarks.some(({ position, radius }) =>
    touches(position, x, minZ, maxZ, radius + halfWidth))
    || facts.stores.some(({ position }) =>
      Math.abs(position.x - x) <= STORE_HALF_WIDTH + halfWidth
      && position.z + STORE_HALF_DEPTH + halfWidth >= minZ
      && position.z - STORE_HALF_DEPTH - halfWidth <= maxZ)) return null
  const trees: string[] = []
  for (const resource of resources) {
    if (!touches(resource.position, x, minZ, maxZ,
      radius[resource.kind] * resourceScale(resource.id) + halfWidth)) continue
    if (resource.kind !== 'tree') return null
    trees.push(resource.id)
  }
  return trees.sort()
}

function resolve(seed: string, id: string, { kind, q }: { kind: Kind; q: number }): Structure | null {
  const x = q / 10
  const xs = columns(x, kind === 'bridge' ? BRIDGE_HALF_WIDTH : LADDER_HALF_WIDTH)
  const anchor = anchorColumn(x)
  const zs = kind === 'bridge' ? [0, 1, 2, 3, 4] : [0, -1, -2, -3]
  const tile = (gx: number, gz: number) => publicWorldV16TileAtGrid(seed, gx, gz)
  const rows = xs.map((gx) => zs.map((gz) => tile(gx, gz)))
  const anchorRows = zs.map((gz) => tile(anchor, gz))
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    if (!row.every((entry, z) => kind === 'bridge' && z === 2
      ? entry.terrain === 'wetland' : dry(entry))) return null
    if (!step(row[0], row[1]) || !step(row[row.length - 2], row[row.length - 1])) return null
    if (kind === 'bridge') {
      if (Math.abs(row[1].center.y - row[3].center.y) > 0.8) return null
    } else {
      const rise = row[2].center.y - row[1].center.y
      if (rise <= MAX_STEP || rise > 2.1) return null
    }
    if (index > 0 && row.some((entry, z) => kind === 'bridge' && z === 2
      ? false : !step(entry, rows[index - 1][z]))) return null
  }
  const blockingResourceIds = blockers(seed, kind, x)
  if (!blockingResourceIds) return null
  const at = (entry: WorldTile): Vec3 => ({ x, y: entry.center.y, z: entry.center.z })
  const footprintTileIds = [...anchorRows.map(({ id: tileId }) => tileId),
    ...rows.flatMap((row, index) => xs[index] === anchor ? [] : row.map(({ id: tileId }) => tileId))]
  if (kind === 'bridge') {
    const [approach, from, gap, to, exit] = anchorRows
    return { id, kind, obstacle: 'greenway_creek', approach: at(approach), from: at(from),
      gapCenter: at(gap), to: at(to), exit: at(exit),
      gapBounds: PUBLIC_V15_STARTER_CREEK_BOUNDS,
      wetGapTileIds: xs.map((gx) => tile(gx, 2).id),
      supportPath: [at(from), { ...at(gap), y: Math.max(from.center.y, to.center.y) + 0.16 }, at(to)],
      footprintTileIds, blockingResourceIds,
      widthMeters: PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS,
      logCost: 8, xpReward: 80, rewardClass: 'construction' }
  }
  const [approach, from, to, exit] = anchorRows
  return { id, kind, obstacle: 'greenway_north_cliff', approach: at(approach),
    from: at(from), to: at(to), exit: at(exit),
    supportPath: [at(from), { x, y: from.center.y, z: -5.35 },
      { x, y: to.center.y, z: -6 }, at(to)],
    footprintTileIds, blockingResourceIds,
    widthMeters: 1.05, logCost: 4, xpReward: 60, rewardClass: 'construction' }
}

/** Only the canonical ID and seed determine a site; client endpoints are never accepted. */
export function resolvePublicV17GreenwaySite(seed: string, id: unknown): PublicV16GreenwaySite | null {
  if (typeof id === 'string' && id.startsWith('works3:'))
    return resolvePublicV16GreenwaySite(seed, id)
  if (typeof seed !== 'string' || typeof id !== 'string') return null
  const parsed = parse(id)
  if (!parsed) return null
  const sourceSeed = seed || 'wizard-realms'
  const key = sourceSeed.length <= 128 ? JSON.stringify([sourceSeed, id]) : null
  try {
    if (key !== null && works4Sites.has(key)) {
      const cached = works4Sites.get(key) ?? null
      works4Sites.delete(key)
      works4Sites.set(key, cached)
      return cached ? structuredClone(cached) : null
    }
    const site = resolve(sourceSeed, id, parsed)
    const canonical = site ? structuredClone(site) : null
    if (key !== null) {
      works4Sites.set(key, canonical)
      if (works4Sites.size > MAX_CACHED_WORKS4_SITES)
        works4Sites.delete(works4Sites.keys().next().value!)
    }
    return canonical ? structuredClone(canonical) : null
  }
  catch { return null }
}
