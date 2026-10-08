import { hashSeed } from './generation'
import { mireglassFullApproachTrail } from './mireglassApproachTrail'
import { MIREGLASS_CORE, MIREGLASS_ENVELOPES, MIREGLASS_FEN_BACK } from './mireglassTerrain'
import type { WorldTile } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

export const HIGHLAND_CONTENT_REVISION = 'highland-quarry-v1' as const
export const HIGHLAND_CORE = Object.freeze({ minX: 448, maxX: 544, minZ: -512, maxZ: -424 })
export const HIGHLAND_LANDMARK = Object.freeze({ id: 'highland_quarry/landmark/quarry_crown', x: 464, z: -432 })

type Point = Readonly<{ x: number; z: number }>
export type HighlandStoneNode = Readonly<{ id: string; tile: WorldTile }>
export type StreamedRegion = 'highland_quarry' | 'mireglass_reach' | 'wilderness'

const WAYPOINTS: readonly Point[] = [
  { x: 12, z: 0 }, { x: 96, z: 0 }, { x: 192, z: -96 }, { x: 320, z: -224 },
  { x: 448, z: -384 }, { x: 464, z: -432 }, { x: 520, z: -480 },
]

/** Pinned 4 m cardinal route. At each step, reduce the larger remaining axis; x wins a tie. */
const corridor = (() => {
  const points: Point[] = [{ ...WAYPOINTS[0] }]
  for (const target of WAYPOINTS.slice(1)) {
    let current = points.at(-1)!
    while (current.x !== target.x || current.z !== target.z) {
      const dx = target.x - current.x
      const dz = target.z - current.z
      current = Math.abs(dx) >= Math.abs(dz)
        ? { x: current.x + Math.sign(dx) * WORLD_CELL_METERS, z: current.z }
        : { x: current.x, z: current.z + Math.sign(dz) * WORLD_CELL_METERS }
      points.push(current)
    }
  }
  return Object.freeze(points.map((point) => Object.freeze(point)))
})()

const lateCorridor = corridor.slice(corridor.findIndex(({ x, z }) => x === 384 && z === -320))
const nodeCache = new Map<string, readonly HighlandStoneNode[]>()
const CACHE_LIMIT = 8
// Mireglass terrain authors side banks one cell beyond the core and a back bank at fenBack + 12.
const mireglassBankEnvelope = { minX: MIREGLASS_CORE.minX - 4, maxX: MIREGLASS_CORE.maxX + 4,
  minZ: 380, maxZ: MIREGLASS_FEN_BACK + 12 }
const normalized = (seed: string) => seed || 'wizard-realms'
const inside = (point: Point, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
  point.x >= bounds.minX && point.x <= bounds.maxX && point.z >= bounds.minZ && point.z <= bounds.maxZ
const near = (point: Point, path: readonly Point[], radius: number) =>
  path.some((cell) => Math.hypot(point.x - cell.x, point.z - cell.z) <= radius)

export function highlandCorridorCells(): readonly Point[] { return corridor }

export function highlandLandmark(seed: string): Readonly<{ id: typeof HIGHLAND_LANDMARK.id; tile: WorldTile }> {
  const tile = worldTileAtGrid(normalized(seed), HIGHLAND_LANDMARK.x / WORLD_CELL_METERS,
    HIGHLAND_LANDMARK.z / WORLD_CELL_METERS)
  return Object.freeze({ id: HIGHLAND_LANDMARK.id,
    tile: Object.freeze({ ...tile, center: Object.freeze({ ...tile.center }) }) })
}

/** Four seed-ranked physical rocky cells. IDs use world-grid indices, not legacy tile.gridX/gridZ. */
export function highlandStoneNodes(seed: string): readonly HighlandStoneNode[] {
  const worldSeed = normalized(seed)
  const cached = nodeCache.get(worldSeed)
  if (cached) return cached
  const candidates: WorldTile[] = []
  for (let z = -500; z < -460; z += WORLD_CELL_METERS) {
    for (let x = 500; x < 540; x += WORLD_CELL_METERS) {
      const tile = worldTileAtGrid(worldSeed, x / WORLD_CELL_METERS, z / WORLD_CELL_METERS)
      if (tile.terrain === 'rocky') candidates.push(tile)
    }
  }
  candidates.sort((a, b) =>
    hashSeed(`${worldSeed}:${HIGHLAND_CONTENT_REVISION}:stone:${a.id}`)
      - hashSeed(`${worldSeed}:${HIGHLAND_CONTENT_REVISION}:stone:${b.id}`)
      || a.gridZ - b.gridZ || a.gridX - b.gridX)
  const chosen: HighlandStoneNode[] = []
  const seedHash = hashSeed(worldSeed).toString(16).padStart(8, '0')
  for (const tile of candidates) {
    if (chosen.some((node) => Math.hypot(tile.center.x - node.tile.center.x,
      tile.center.z - node.tile.center.z) < 20)) continue
    const gx = tile.center.x / WORLD_CELL_METERS
    const gz = tile.center.z / WORLD_CELL_METERS
    chosen.push(Object.freeze({
      id: `highland_quarry/${HIGHLAND_CONTENT_REVISION}/stone/${seedHash}/${gx}/${gz}`,
      tile: Object.freeze({ ...tile, center: Object.freeze({ ...tile.center }) }),
    }))
    if (chosen.length === 4) break
  }
  if (chosen.length !== 4) throw new Error(`Insufficient separated rocky quarry cells for ${worldSeed}`)
  const nodes = Object.freeze(chosen)
  nodeCache.set(worldSeed, nodes)
  if (nodeCache.size > CACHE_LIMIT) nodeCache.delete(nodeCache.keys().next().value!)
  return nodes
}

/** Region identity is for presentation only; it never changes movement ownership. */
export function isHighlandAuthoredPosition(position: Point): boolean {
  if (position.x < 376 || position.x > 552 || position.z < -520 || position.z > -312) return false
  return inside(position, HIGHLAND_CORE) || near(position, lateCorridor, 8)
}

export function classifyStreamedRegion(seed: string, position: Point): StreamedRegion {
  if (isHighlandAuthoredPosition(position)) return 'highland_quarry'
  if (position.x > 8 || position.x < MIREGLASS_CORE.minX - 8
    || position.z < -8 || position.z > MIREGLASS_CORE.maxZ + 8) return 'wilderness'
  if (inside(position, MIREGLASS_CORE) || inside(position, mireglassBankEnvelope)
    || inside(position, MIREGLASS_ENVELOPES.fringeMarker)
    || near(position, mireglassFullApproachTrail(normalized(seed)), 8)) return 'mireglass_reach'
  return 'wilderness'
}
