import { hashSeed } from './generation'
import type { ReadonlyWorldTile } from './activeWorldTerrain'
import { mireglassAnchors, mireglassFairyRing, mireglassResources } from './mireglassContent'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { mireglassRouteSites } from './mireglassRouteSites'
import { MIREGLASS_CONTENT_REVISION, MIREGLASS_CORE, MIREGLASS_ENVELOPES } from './mireglassTerrain'
import type { Vec3, WorldTile } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

export interface MireglassHerbPatch {
  readonly id: string
  readonly tile: ReadonlyWorldTile
  readonly kind: 'herb'
  readonly itemId: 'marsh_herb'
}

const CELL = WORLD_CELL_METERS
const CLEARANCE = 2 * CELL
const ALDER_RADIUS = 8 * CELL
const CACHE_LIMIT = 8
const DIRECTIONS = [[-CELL, 0], [CELL, 0], [0, -CELL], [0, CELL]] as const
const patchCache = new Map<string, readonly MireglassHerbPatch[]>()
const REACH_WINDOW = {
  minX: MIREGLASS_ENVELOPES.bellAlder.minX - 8 * CELL,
  maxX: MIREGLASS_CORE.maxX,
  minZ: MIREGLASS_CORE.minZ + 2 * CELL,
  maxZ: MIREGLASS_ENVELOPES.bellAlder.maxZ + CELL,
} as const

const key = (x: number, z: number) => `${x},${z}`
const distance = (a: Pick<Vec3, 'x' | 'z'>, b: Pick<Vec3, 'x' | 'z'>) =>
  Math.hypot(a.x - b.x, a.z - b.z)

function segmentDistance(point: Vec3, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const projection = Math.max(0, Math.min(1,
    ((point.x - from.x) * dx + (point.z - from.z) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(point.x - from.x - projection * dx, point.z - from.z - projection * dz)
}

/** Ordinary movement can cross wetland outside the gated fen. The patch itself must be dry. */
function reachableFromOutpost(seed: string, outpost: Vec3): Set<string> {
  const reached = new Set([key(outpost.x, outpost.z)])
  const queue: Array<Pick<Vec3, 'x' | 'z'>> = [outpost]
  for (let head = 0; head < queue.length; head += 1) {
    const from = queue[head]
    for (const [dx, dz] of DIRECTIONS) {
      const to = { x: from.x + dx, z: from.z + dz }
      if (to.x < REACH_WINDOW.minX || to.x > REACH_WINDOW.maxX
        || to.z < REACH_WINDOW.minZ || to.z > REACH_WINDOW.maxZ
        || reached.has(key(to.x, to.z))
        || mireglassMoveBarrier(seed, from, to) !== null
        || mireglassMoveBarrier(seed, to, from) !== null) continue
      reached.add(key(to.x, to.z))
      queue.push(to)
    }
  }
  return reached
}

/** Dry marsh-edge patches reachable from the authored outpost approach. */
export function mireglassHerbPatches(seed: string): MireglassHerbPatch[] {
  const normalizedSeed = seed || 'wizard-realms'
  const cached = patchCache.get(normalizedSeed)
  if (cached) {
    patchCache.delete(normalizedSeed)
    patchCache.set(normalizedSeed, cached)
    return [...cached]
  }
  const anchors = mireglassAnchors(normalizedSeed)
  const alder = anchors.bellAlder.tile.center
  const reached = reachableFromOutpost(normalizedSeed, anchors.salvager.tile.center)
  const occupied = [
    ...Object.values(anchors).map(({ tile }) => tile.center),
    ...mireglassResources(normalizedSeed).map(({ tile }) => tile.center),
    mireglassFairyRing(normalizedSeed).tile.center,
  ]
  const sites = mireglassRouteSites(normalizedSeed)
  const envelope = MIREGLASS_ENVELOPES.bellAlder
  const candidates: WorldTile[] = []

  for (let z = envelope.minZ - CELL; z <= envelope.maxZ; z += CELL) {
    for (let x = envelope.minX - CELL; x <= envelope.maxX; x += CELL) {
      const tile = worldTileAtGrid(normalizedSeed, x / CELL, z / CELL)
      if (tile.terrain !== 'loam' || distance(tile.center, alder) > ALDER_RADIUS
        || !reached.has(key(x, z))
        || occupied.some((point) => distance(tile.center, point) < CLEARANCE)
        || sites.some((site) => segmentDistance(tile.center,
          { ...site.from, z: site.from.z - CELL },
          { ...site.to, z: site.to.z + CELL }) < CLEARANCE)) continue

      const bordersAlderWetland = DIRECTIONS.some(([dx, dz]) => {
        const adjacentX = x + dx
        const adjacentZ = z + dz
        return adjacentX >= envelope.minX && adjacentX < envelope.maxX
          && adjacentZ >= envelope.minZ && adjacentZ < envelope.maxZ
          && worldTileAtGrid(normalizedSeed, adjacentX / CELL, adjacentZ / CELL).terrain === 'wetland'
      })
      if (bordersAlderWetland) candidates.push(tile)
    }
  }

  candidates.sort((a, b) => hashSeed(`${normalizedSeed}:${MIREGLASS_CONTENT_REVISION}:marsh-herb:${a.id}`)
    - hashSeed(`${normalizedSeed}:${MIREGLASS_CONTENT_REVISION}:marsh-herb:${b.id}`)
    || a.gridZ - b.gridZ || a.gridX - b.gridX)
  const patches: MireglassHerbPatch[] = []
  for (const tile of candidates) {
    if (patches.some((patch) => distance(tile.center, patch.tile.center) < CLEARANCE)) continue
    patches.push({ id: `mireglass_reach/resource/herb/${tile.gridX - 3}/${tile.gridZ - 3}`,
      tile, kind: 'herb', itemId: 'marsh_herb' })
    if (patches.length === 4) break
  }
  if (patches.length < 3) {
    throw new Error(`Insufficient dry Bell Alder herb patches for ${normalizedSeed} in ${MIREGLASS_CONTENT_REVISION}`)
  }
  const immutable = Object.freeze(patches.map((patch) => Object.freeze({ ...patch,
    tile: Object.freeze({ ...patch.tile, center: Object.freeze({ ...patch.tile.center }) }),
  })))
  patchCache.set(normalizedSeed, immutable)
  if (patchCache.size > CACHE_LIMIT) patchCache.delete(patchCache.keys().next().value!)
  return [...immutable]
}
