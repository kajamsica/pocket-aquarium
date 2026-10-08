import { mireglassAnchors } from './mireglassContent'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import type { Vec3 } from './types'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN, worldTileAtGrid } from './worldChunks'

const CELL = WORLD_CELL_METERS
const MARGIN_CELLS = 16
const CACHE_LIMIT = 8
const DIRECTIONS = [[-1, 0], [0, 1], [1, 0], [0, -1]] as const
const trailCache = new Map<string, readonly Readonly<Vec3>[]>()
const greenwayTrailCache = new Map<string, readonly Readonly<Vec3>[]>()

/** A dry, reversible 4 m connector from the Greenway origin to the fringe marker. */
export function mireglassGreenwayToMarkerTrail(seed: string): readonly Readonly<Vec3>[] {
  const normalizedSeed = seed || 'wizard-realms'
  const cached = greenwayTrailCache.get(normalizedSeed)
  if (cached) {
    greenwayTrailCache.delete(normalizedSeed)
    greenwayTrailCache.set(normalizedSeed, cached)
    return cached
  }
  const marker = mireglassAnchors(normalizedSeed).fringeMarker.tile
  const markerX = marker.center.x / CELL
  const markerZ = marker.center.z / CELL
  if (!Number.isSafeInteger(markerX) || !Number.isSafeInteger(markerZ)
    || markerX >= 0 || markerZ <= 0) {
    throw new Error(`No dry Greenway connector for ${normalizedSeed}: unsupported fringe marker`)
  }
  const centers: Vec3[] = []
  const append = (x: number, z: number) => {
    const tile = worldTileAtGrid(normalizedSeed, x, z)
    const previous = centers.at(-1)
    if (tile.terrain === 'wetland'
      || (previous && (mireglassMoveBarrier(normalizedSeed, previous, tile.center) !== null
        || mireglassMoveBarrier(normalizedSeed, tile.center, previous) !== null))) {
      throw new Error(`No dry Greenway connector for ${normalizedSeed}: blocked at (${tile.center.x}, ${tile.center.z})`)
    }
    centers.push(tile.center)
  }
  append(0, 0)
  for (let x = -1; x >= markerX; x -= 1) append(x, 0)
  for (let z = 1; z <= markerZ; z += 1) append(markerX, z)
  const trail = Object.freeze(centers.map((center) => Object.freeze(center)))
  greenwayTrailCache.set(normalizedSeed, trail)
  if (greenwayTrailCache.size > CACHE_LIMIT) greenwayTrailCache.delete(greenwayTrailCache.keys().next().value!)
  return trail
}

/** A deterministic, dry, cardinal walking route through canonical Mireglass cells. */
export function mireglassApproachTrail(seed: string): readonly Readonly<Vec3>[] {
  const normalizedSeed = seed || 'wizard-realms'
  const cached = trailCache.get(normalizedSeed)
  if (cached) {
    trailCache.delete(normalizedSeed)
    trailCache.set(normalizedSeed, cached)
    return cached
  }
  const anchors = mireglassAnchors(normalizedSeed)
  const start = anchors.fringeMarker.tile
  const goal = anchors.salvager.tile
  const sx = start.center.x / CELL
  const sz = start.center.z / CELL
  const gx = goal.center.x / CELL
  const gz = goal.center.z / CELL
  if (start.terrain === 'wetland' || goal.terrain === 'wetland') {
    throw new Error(`No dry Mireglass approach trail for ${normalizedSeed}: an endpoint is wetland`)
  }

  const minX = Math.max(WORLD_GRID_MIN, Math.min(sx, gx) - MARGIN_CELLS)
  const maxX = Math.min(WORLD_GRID_MAX, Math.max(sx, gx) + MARGIN_CELLS)
  const minZ = Math.max(WORLD_GRID_MIN, Math.min(sz, gz) - MARGIN_CELLS)
  const maxZ = Math.min(WORLD_GRID_MAX, Math.max(sz, gz) + MARGIN_CELLS)
  const width = maxX - minX + 1
  const size = width * (maxZ - minZ + 1)
  const index = (x: number, z: number) => (z - minZ) * width + x - minX
  const point = (at: number) => ({ x: minX + at % width, z: minZ + Math.floor(at / width) })
  const fromIndex = index(sx, sz)
  const goalIndex = index(gx, gz)
  const parent = new Int32Array(size).fill(-1)
  const dry = new Uint8Array(size)
  const queue = new Int32Array(size)
  const dx = gx - sx
  const dz = gz - sz
  const lengthSquared = dx * dx + dz * dz
  const lineError = (x: number, z: number) => Math.abs((x - sx) * dz - (z - sz) * dx)
  const withinCorridor = (x: number, z: number) => {
    const projection = Math.max(0, Math.min(1, ((x - sx) * dx + (z - sz) * dz) / lengthSquared))
    const offsetX = x - sx - projection * dx
    const offsetZ = z - sz - projection * dz
    return offsetX * offsetX + offsetZ * offsetZ <= MARGIN_CELLS * MARGIN_CELLS
  }
  const isDry = (x: number, z: number) => {
    const at = index(x, z)
    if (dry[at] === 0) dry[at] = worldTileAtGrid(normalizedSeed, x, z).terrain === 'wetland' ? 2 : 1
    return dry[at] === 1
  }

  parent[fromIndex] = fromIndex
  queue[0] = fromIndex
  let head = 0
  let tail = 1
  while (head < tail && parent[goalIndex] === -1) {
    const current = queue[head++]
    const { x, z } = point(current)
    const candidates = DIRECTIONS.map(([stepX, stepZ]) => ({ x: x + stepX, z: z + stepZ }))
      .filter(({ x: nextX, z: nextZ }) => nextX >= minX && nextX <= maxX && nextZ >= minZ && nextZ <= maxZ
        && withinCorridor(nextX, nextZ))
      .sort((a, b) => lineError(a.x, a.z) - lineError(b.x, b.z)
        || Math.abs(a.x - gx) + Math.abs(a.z - gz) - Math.abs(b.x - gx) - Math.abs(b.z - gz)
        || a.z - b.z || a.x - b.x)
    for (const next of candidates) {
      const at = index(next.x, next.z)
      if (parent[at] !== -1 || !isDry(next.x, next.z)) continue
      const from = { x: x * CELL, z: z * CELL }
      const to = { x: next.x * CELL, z: next.z * CELL }
      if (mireglassMoveBarrier(normalizedSeed, from, to) !== null
        || mireglassMoveBarrier(normalizedSeed, to, from) !== null) continue
      parent[at] = current
      queue[tail++] = at
      if (at === goalIndex) break
    }
  }
  if (parent[goalIndex] === -1) {
    throw new Error(`No dry Mireglass approach trail for ${normalizedSeed}: (${start.center.x}, ${start.center.z}) to (${goal.center.x}, ${goal.center.z}) within ${MARGIN_CELLS * CELL}m of the direct line`)
  }

  const reversed: Vec3[] = []
  for (let at = goalIndex; ; at = parent[at]) {
    const { x, z } = point(at)
    reversed.push(worldTileAtGrid(normalizedSeed, x, z).center)
    if (at === fromIndex) break
  }
  const trail = Object.freeze(reversed.reverse().map((center) => Object.freeze(center)))
  trailCache.set(normalizedSeed, trail)
  if (trailCache.size > CACHE_LIMIT) trailCache.delete(trailCache.keys().next().value!)
  return trail
}
