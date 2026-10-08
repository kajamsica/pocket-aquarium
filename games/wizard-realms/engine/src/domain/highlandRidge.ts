import { WORLD_CELL_METERS } from './worldChunks'

export const HIGHLAND_RIDGE_REVISION = 'highland-ridge-v1' as const

type Point = Readonly<{ x: number; z: number }>
type RidgeCell = 'rock' | 'gallery' | null

const RIDGE = { minX: 560, maxX: 596, minZ: -520, maxZ: -416 } as const
const gridAtWorld = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)

/** Fixed 4 m center-cell mask, independent of the generated world's seed. */
export function highlandRidgeCellAt(x: number, z: number): RidgeCell {
  if (!Number.isFinite(x) || !Number.isFinite(z)
    || x % WORLD_CELL_METERS !== 0 || z % WORLD_CELL_METERS !== 0
    || x < RIDGE.minX || x > RIDGE.maxX || z < RIDGE.minZ || z > RIDGE.maxZ) return null
  return z === -468 || z === -464 ? 'gallery' : 'rock'
}

const cellAtGrid = (gx: number, gz: number) =>
  highlandRidgeCellAt(gx * WORLD_CELL_METERS, gz * WORLD_CELL_METERS)

/** Applies the same lower-center half-cell tie used by movement and terrain lookup. */
export function highlandRidgeCellAtWorld(x: number, z: number): RidgeCell {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  return cellAtGrid(gridAtWorld(x), gridAtWorld(z))
}

/** Suggests an open center for an old save inside rock; does not move the player. */
export function highlandRidgeRecoveryTarget(x: number, z: number): { x: number; z: number; distance: number } | null {
  if (highlandRidgeCellAtWorld(x, z) !== 'rock') return null
  const cellX = gridAtWorld(x) * WORLD_CELL_METERS
  const cellZ = gridAtWorld(z) * WORLD_CELL_METERS
  // Fixed order breaks equal-distance ties without depending on a world seed.
  const candidates = [
    { x: RIDGE.minX - WORLD_CELL_METERS, z: cellZ },
    { x: RIDGE.maxX + WORLD_CELL_METERS, z: cellZ },
    { x: cellX, z: RIDGE.minZ - WORLD_CELL_METERS },
    { x: cellX, z: RIDGE.maxZ + WORLD_CELL_METERS },
    { x: cellX, z: -468 },
    { x: cellX, z: -464 },
  ]
  let best = { ...candidates[0], distance: Math.hypot(candidates[0].x - x, candidates[0].z - z) }
  for (const candidate of candidates.slice(1)) {
    const distance = Math.hypot(candidate.x - x, candidate.z - z)
    if (distance < best.distance) best = { ...candidate, distance }
  }
  return best
}

/** Prevents entering the ridge rock, including a swept sliver or diagonal corner cut. */
export function highlandRidgeMoveBarrier(from: Point, to: Point): 'ridge_rock' | null {
  if (![from.x, from.z, to.x, to.z].every(Number.isFinite)) return 'ridge_rock'
  const dx = to.x - from.x
  const dz = to.z - from.z
  if (!Number.isFinite(dx) || !Number.isFinite(dz)
    || Math.hypot(dx, dz) > WORLD_CELL_METERS) return 'ridge_rock'
  if (Math.max(from.x, to.x) < RIDGE.minX - WORLD_CELL_METERS / 2
    || Math.min(from.x, to.x) > RIDGE.maxX + WORLD_CELL_METERS / 2
    || Math.max(from.z, to.z) < RIDGE.minZ - WORLD_CELL_METERS / 2
    || Math.min(from.z, to.z) > RIDGE.maxZ + WORLD_CELL_METERS / 2) return null

  const fromGX = gridAtWorld(from.x)
  const fromGZ = gridAtWorld(from.z)
  const toGX = gridAtWorld(to.x)
  const toGZ = gridAtWorld(to.z)
  // Old saves may put the player inside new rock. Let them walk out, then reject re-entry.
  if (cellAtGrid(fromGX, fromGZ) === 'rock') return null
  if (cellAtGrid(toGX, toGZ) === 'rock') return 'ridge_rock'

  // A move is at most one cell long on either axis. If both axes cross a grid
  // edge, the earlier edge determines the side cell traversed; at an exact
  // corner both side cells count, so there is no zero-width passage through rock.
  if (fromGX !== toGX && fromGZ !== toGZ) {
    const xEdge = (Math.min(fromGX, toGX) + 0.5) * WORLD_CELL_METERS
    const zEdge = (Math.min(fromGZ, toGZ) + 0.5) * WORLD_CELL_METERS
    const tx = (xEdge - from.x) / dx
    const tz = (zEdge - from.z) / dz
    if (tx <= tz && cellAtGrid(toGX, fromGZ) === 'rock') return 'ridge_rock'
    if (tz <= tx && cellAtGrid(fromGX, toGZ) === 'rock') return 'ridge_rock'
  }
  return null
}
