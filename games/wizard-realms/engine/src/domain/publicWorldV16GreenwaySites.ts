import { STORE_HALF_DEPTH, STORE_HALF_WIDTH } from './generation'
import { PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS, PUBLIC_V15_STARTER_CREEK_BOUNDS,
  publicWorldV15ClearStarterResources, publicWorldV15StarterTileAtGrid } from './publicWorldV15StarterSites'
import { createStarterCliffGreenwayFacts } from './starterCliffWorld'
import type { Vec3, WorldTile } from './types'
import { WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

export const PUBLIC_V16_GREENWAY_CENTER_BRIDGE_ID = 'works3:bridge:0' as const
export const PUBLIC_V16_GREENWAY_AUTHORED_DIG_ID = 'works3:dig:1:3' as const

/** The V14 owner rectangle, kept acyclic so world support can be read during content initialization. */
export const publicV16InsideGreenway = (point: Readonly<{ x: number; z: number }>): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.z)
    && point.x >= -30 && point.x <= 34 && point.z >= -30 && point.z <= 34

const CELL = 4
const MAX_WINDOW_CELLS = 16
const MAX_GROUND_STEP = 0.55
const DIG_DEPTH_METERS = 0.24
const BRIDGE_MIN_GX = -2
const BRIDGE_MAX_GX = 2
const LADDER_MIN_GX = -3
const LADDER_MAX_GX = 3
// Rendered planks extend 0.04 m beyond each edge of the nominal deck.
const BRIDGE_HALF_WIDTH = PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS / 2 + 0.04
const BRIDGE_MAX_SHIFT = CELL / 2 - BRIDGE_HALF_WIDTH
const LADDER_MAX_SHIFT = 1.2
const LADDER_CLEARANCE = 0.54
const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const

export type PublicV16GreenwayWindow = Readonly<{
  minGX: number; maxGX: number; minGZ: number; maxGZ: number
}>

export type PublicV16GreenwaySite = Readonly<{
  id: string; kind: 'bridge'; obstacle: 'greenway_creek'
  from: Readonly<Vec3>; to: Readonly<Vec3>; approach: Readonly<Vec3>; exit: Readonly<Vec3>
  gapCenter: Readonly<Vec3>; gapBounds: typeof PUBLIC_V15_STARTER_CREEK_BOUNDS
  supportPath: readonly Readonly<Vec3>[]; footprintTileIds: readonly string[]
  blockingResourceIds: readonly string[]
  wetGapTileIds: readonly string[]; widthMeters: typeof PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS
  logCost: 8; xpReward: 80; rewardClass: 'construction'
}> | Readonly<{
  id: string; kind: 'ladder'; obstacle: 'greenway_north_cliff'
  from: Readonly<Vec3>; to: Readonly<Vec3>; approach: Readonly<Vec3>; exit: Readonly<Vec3>
  supportPath: readonly Readonly<Vec3>[]; footprintTileIds: readonly string[]
  blockingResourceIds: readonly string[]
  widthMeters: 1.05; logCost: 4; xpReward: 60; rewardClass: 'construction'
}> | Readonly<{
  id: string; kind: 'dig'; obstacle: 'suitable_ground'
  center: Readonly<Vec3>; loweredCenter: Readonly<Vec3>; adjacentStance: Readonly<Vec3>
  footprintTileIds: readonly string[]; depthMeters: typeof DIG_DEPTH_METERS
  rewardClass: 'stone'; reward: Readonly<{ itemId: 'stone'; quantity: 1; xp: 30 }>
}>

const validGrid = (value: number) => Number.isSafeInteger(value)
  && value >= WORLD_GRID_MIN && value <= WORLD_GRID_MAX
const canonical = (value: string) => /^-?(0|[1-9]\d*)$/.test(value)
  && value !== '-0' && validGrid(Number(value)) && value === String(Number(value))

export function publicV16GreenwayBridgeId(gx: number): string {
  if (!validGrid(gx)) throw new RangeError('Bridge grid coordinate is outside the world.')
  return `works3:bridge:${gx}`
}
export function publicV16GreenwayLadderId(gx: number): string {
  if (!validGrid(gx)) throw new RangeError('Ladder grid coordinate is outside the world.')
  return `works3:ladder:${gx}`
}
export function publicV16GreenwayDigId(gx: number, gz: number): string {
  if (!validGrid(gx) || !validGrid(gz)) throw new RangeError('Dig grid coordinate is outside the world.')
  return `works3:dig:${gx}:${gz}`
}

type Parsed = { kind: 'bridge' | 'ladder' | 'dig'; gx: number; gz: number }
function parse(id: unknown): Parsed | null {
  if (typeof id !== 'string') return null
  const match = /^works3:(bridge|ladder|dig):([^:]+)(?::([^:]+))?$/.exec(id)
  if (!match || !canonical(match[2]) || (match[1] === 'dig') !== (match[3] !== undefined)
    || match[3] !== undefined && !canonical(match[3])) return null
  return { kind: match[1] as Parsed['kind'], gx: Number(match[2]),
    gz: match[3] === undefined ? 0 : Number(match[3]) }
}

/** V16-only dry bank cells. V15 tiles and the authored center crossing stay unchanged. */
export function publicWorldV16TileAtGrid(seed: string, gx: number, gz: number): WorldTile {
  const base = publicWorldV15StarterTileAtGrid(seed, gx, gz)
  if (gx >= BRIDGE_MIN_GX && gx <= BRIDGE_MAX_GX
    && (gz === 0 || gz === 1 || gz === 3 || gz === 4)
    && base.terrain !== 'loam') return { ...base, terrain: 'loam', biome: 'temperate_forest' }
  return base
}

const dry = (tile: WorldTile) => tile.terrain !== 'wetland'
const step = (a: WorldTile, b: WorldTile) => Math.abs(a.center.y - b.center.y) <= MAX_GROUND_STEP
const inGreenway = (tile: WorldTile) => publicV16InsideGreenway(tile.center)
const seam = (gz: number) => gz === -1 || gz === -2

type Context = ReturnType<typeof context>
function context(seed: string) {
  const facts = createStarterCliffGreenwayFacts(seed)
  const resources = publicWorldV15ClearStarterResources(seed, facts.resources)
  const landmarks = [...facts.fairyRings.map((item) => item.position),
    ...facts.inscriptions.map((item) => item.position),
    ...facts.digSites.map((item) => item.position)]
  return {
    stores: facts.stores,
    resources, landmarks: [
      ...facts.fairyRings.map((item) => ({ position: item.position, radius: 1.7 })),
      ...facts.inscriptions.map((item) => ({ position: item.position, radius: 0.9 })),
      ...facts.digSites.map((item) => ({ position: item.position, radius: 1 })),
    ],
    occupied: [...resources.map((resource) => resource.position), ...landmarks, facts.playerStart],
  }
}
const clear = (ctx: Context, point: Vec3) => ctx.occupied.every((occupied) =>
  Math.abs(point.x - occupied.x) >= CELL / 2
    || Math.abs(point.z - occupied.z) >= CELL / 2)
  && ctx.stores.every(({ position }) => Math.abs(point.x - position.x) >= STORE_HALF_WIDTH + CELL / 2
    || Math.abs(point.z - position.z) >= STORE_HALF_DEPTH + CELL / 2)
function resourceScale(id: string): number {
  let hash = 2166136261 ^ 2
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  hash ^= hash >>> 15
  hash = Math.imul(hash, 2246822507)
  hash ^= hash >>> 13
  return 0.88 + (hash >>> 0) / 4294967296 * 0.24
}

type Interval = readonly [number, number]
function pointInterval(point: Vec3, radius: number, halfWidth: number,
  minZ: number, maxZ: number): Interval | null {
  const dz = Math.max(minZ - point.z, 0, point.z - maxZ)
  const reach = radius + halfWidth
  if (dz >= reach) return null
  const dx = Math.sqrt(reach * reach - dz * dz)
  return [point.x - dx, point.x + dx]
}

/** Physical structure only; approach/exit terrain is checked separately. */
function connector(ctx: Context, anchorX: number, minZ: number, maxZ: number,
  halfWidth: number, maxShift: number): { x: number; blockingResourceIds: string[] } | null {
  const hard: Interval[] = []
  const trees: { id: string; interval: Interval }[] = []
  const radius = { tree: 0.55, ore: 0.7, stone: 0.61, herb: 0.7 } as const
  for (const resource of ctx.resources) {
    const interval = pointInterval(resource.position,
      radius[resource.kind] * resourceScale(resource.id), halfWidth, minZ, maxZ)
    if (!interval) continue
    if (resource.kind === 'tree') trees.push({ id: resource.id, interval })
    else hard.push(interval)
  }
  for (const landmark of ctx.landmarks) {
    const interval = pointInterval(landmark.position, landmark.radius, halfWidth, minZ, maxZ)
    if (interval) hard.push(interval)
  }
  for (const { position } of ctx.stores) {
    const halfZ = 1.25 + halfWidth
    if (maxZ < position.z - halfZ || minZ > position.z + halfZ) continue
    const halfX = 1.75 + halfWidth
    hard.push([position.x - halfX, position.x + halfX])
  }
  const low = anchorX - maxShift, high = anchorX + maxShift
  const edges = [low, high, anchorX, ...hard.flat(),
    ...trees.flatMap(({ interval }) => interval)]
    .filter((x) => x >= low && x <= high).sort((a, b) => a - b)
  const samples = [...edges, ...edges.slice(1).map((edge, i) => (edge + edges[i]) / 2)]
  const within = ([a, b]: Interval, x: number) => x >= a - 1e-9 && x <= b + 1e-9
  const candidates = samples.filter((x) => !hard.some((interval) => within(interval, x)))
    .map((x) => ({ x, blockingResourceIds: trees.filter(({ interval }) => within(interval, x))
      .map(({ id }) => id).sort() }))
    .sort((a, b) => a.blockingResourceIds.length - b.blockingResourceIds.length
      || Math.abs(a.x - anchorX) - Math.abs(b.x - anchorX) || a.x - b.x)
  return candidates[0] ?? null
}

function resolve(seed: string, id: string, parsed: Parsed, ctx: Context | null): PublicV16GreenwaySite | null {
  const tile = (gx: number, gz: number) => publicWorldV16TileAtGrid(seed, gx, gz)
  const { gx, gz } = parsed
  if (parsed.kind === 'bridge') {
    if (gx < BRIDGE_MIN_GX || gx > BRIDGE_MAX_GX) return null
    const [approach, from, gap, to, exit] = [0, 1, 2, 3, 4].map((z) => tile(gx, z))
    if (!ctx || ![approach, from, to, exit].every(dry) || gap.terrain !== 'wetland'
      || !step(approach, from) || !step(to, exit)
      || Math.abs(from.center.y - to.center.y) > 0.8) return null
    const placement = connector(ctx, gx * CELL, 3.5, 12.5, BRIDGE_HALF_WIDTH, BRIDGE_MAX_SHIFT)
    if (!placement) return null
    const shifted = (point: Vec3) => ({ ...point, x: placement.x })
    return { id, kind: 'bridge', obstacle: 'greenway_creek',
      approach: shifted(approach.center), from: shifted(from.center), gapCenter: shifted(gap.center),
      to: shifted(to.center), exit: shifted(exit.center),
      blockingResourceIds: placement.blockingResourceIds,
      footprintTileIds: [approach.id, from.id, gap.id, to.id, exit.id],
      wetGapTileIds: Array.from({ length: BRIDGE_MAX_GX - BRIDGE_MIN_GX + 1 }, (_, offset) =>
        tile(BRIDGE_MIN_GX + offset, 2).id),
      gapBounds: PUBLIC_V15_STARTER_CREEK_BOUNDS,
      supportPath: [shifted(from.center), { ...shifted(gap.center),
        y: Math.max(from.center.y, to.center.y) + 0.16 }, shifted(to.center)],
      widthMeters: PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS,
      logCost: 8, xpReward: 80, rewardClass: 'construction' }
  }
  if (parsed.kind === 'ladder') {
    if (gx === 0 || gx < LADDER_MIN_GX || gx > LADDER_MAX_GX) return null
    const [approach, from, to, exit] = [0, -1, -2, -3].map((z) => tile(gx, z))
    const rise = to.center.y - from.center.y
    if (!ctx || ![approach, from, to, exit].every(inGreenway)
      || ![approach, from, to, exit].every(dry)
      || !step(approach, from) || !step(to, exit)
      || rise <= MAX_GROUND_STEP || rise > 2.1) return null
    const placement = connector(ctx, gx * CELL, -6.5, -4.85, LADDER_CLEARANCE, LADDER_MAX_SHIFT)
    if (!placement) return null
    const shifted = (point: Vec3) => ({ ...point, x: placement.x })
    const faceFrom = { x: placement.x, y: from.center.y, z: -5.35 }
    const faceTo = { x: placement.x, y: to.center.y, z: -6 }
    return { id, kind: 'ladder', obstacle: 'greenway_north_cliff',
      approach: shifted(approach.center), from: shifted(from.center), to: shifted(to.center),
      exit: shifted(exit.center), supportPath: [shifted(from.center), faceFrom, faceTo,
        shifted(to.center)], footprintTileIds: [approach.id, from.id, to.id, exit.id],
      blockingResourceIds: placement.blockingResourceIds,
      widthMeters: 1.05, logCost: 4, xpReward: 60, rewardClass: 'construction' }
  }
  if (!ctx || seam(gz)) return null
  const ground = tile(gx, gz)
  if (!inGreenway(ground) || ground.terrain !== 'loam' || !clear(ctx, ground.center)) return null
  const loweredCenter = { ...ground.center, y: ground.center.y - DIG_DEPTH_METERS }
  const stance = directions.map(([dx, dz]) => {
    const nx = gx + dx, nz = gz + dz
    return validGrid(nx) && validGrid(nz) && !seam(nz) ? tile(nx, nz) : null
  }).find((neighbor) => neighbor && inGreenway(neighbor) && neighbor.terrain === 'loam'
    && Math.abs(neighbor.center.y - loweredCenter.y) <= MAX_GROUND_STEP
    && clear(ctx, neighbor.center))
  if (!stance) return null
  return { id, kind: 'dig', obstacle: 'suitable_ground', center: { ...ground.center },
    loweredCenter, adjacentStance: { ...stance.center },
    footprintTileIds: [ground.id, stance.id], depthMeters: DIG_DEPTH_METERS,
    rewardClass: 'stone', reward: { itemId: 'stone', quantity: 1, xp: 30 } }
}

/** ID and seed alone resolve intrinsic sites; client coordinates never enter this path. */
export function resolvePublicV16GreenwaySite(seed: string, id: unknown): PublicV16GreenwaySite | null {
  if (typeof seed !== 'string') return null
  const parsed = parse(id)
  if (!parsed) return null
  try { return resolve(seed || 'wizard-realms', id as string, parsed,
    context(seed || 'wizard-realms')) }
  catch { return null }
}

/** Only anchors in one validated 16 by 16 cell window are examined. */
export function enumeratePublicV16GreenwaySites(seed: string,
  window: PublicV16GreenwayWindow): readonly PublicV16GreenwaySite[] {
  if (typeof seed !== 'string') throw new TypeError('Greenway work seed must be a string.')
  if (!window || typeof window !== 'object') throw new RangeError('Greenway work window is required.')
  const { minGX, maxGX, minGZ, maxGZ } = window
  if (![minGX, maxGX, minGZ, maxGZ].every(validGrid) || maxGX < minGX || maxGZ < minGZ
    || maxGX - minGX >= MAX_WINDOW_CELLS || maxGZ - minGZ >= MAX_WINDOW_CELLS) {
    throw new RangeError('Greenway work window must contain at most 16 by 16 world cells.')
  }
  const normalized = seed || 'wizard-realms'
  const ctx = context(normalized)
  const sites: PublicV16GreenwaySite[] = []
  for (let gz = minGZ; gz <= maxGZ; gz++) for (let gx = minGX; gx <= maxGX; gx++) {
    const ids = [publicV16GreenwayDigId(gx, gz)]
    if (gz === 2) ids.push(publicV16GreenwayBridgeId(gx))
    if (gz === -1) ids.push(publicV16GreenwayLadderId(gx))
    for (const id of ids) {
      const parsed = parse(id)!
      const site = resolve(normalized, id, parsed, ctx)
      if (site) sites.push(site)
    }
  }
  return sites.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
