import { mireglassAnchors, mireglassResources } from './mireglassContent'
import { MIREGLASS_CONTENT_REVISION, MIREGLASS_ENVELOPES, mireglassBermFaceRowAt, mireglassFenRowAt } from './mireglassTerrain'
import type { Vec3, WorldTile } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

export type MireglassRouteSite = Readonly<{
  id: string
  routeId: 'mireglass_reach/route/fen_bridge' | 'mireglass_reach/route/slate_ladder'
  revision: typeof MIREGLASS_CONTENT_REVISION
  kind: 'bridge' | 'ladder'
  from: Readonly<Vec3>
  to: Readonly<Vec3>
  logCost: 4 | 8
  spanMeters: 4 | 8
  riseMeters: number
}>

const CELL = WORLD_CELL_METERS
const MAX_WALKABLE_STEP = 0.9
const CLEARANCE = CELL
const tileAt = (seed: string, x: number, z: number) => worldTileAtGrid(seed, x / CELL, z / CELL)
const walkableStep = (a: WorldTile, b: WorldTile) => Math.abs(a.center.y - b.center.y) <= MAX_WALKABLE_STEP

function segmentDistance(point: Vec3, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const projection = Math.max(0, Math.min(1,
    ((point.x - from.x) * dx + (point.z - from.z) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(point.x - from.x - projection * dx, point.z - from.z - projection * dz)
}

function clearOfContent(occupied: readonly Vec3[], approach: Vec3, exit: Vec3): boolean {
  return occupied.every((point) => segmentDistance(point, approach, exit) >= CLEARANCE)
}

function site(kind: MireglassRouteSite['kind'], x: number, seamZ: number, from: WorldTile, to: WorldTile): MireglassRouteSite {
  const routeId = kind === 'bridge' ? 'mireglass_reach/route/fen_bridge' : 'mireglass_reach/route/slate_ladder'
  return Object.freeze({
    id: `${routeId}/${x / CELL}/${seamZ / CELL}`,
    routeId,
    revision: MIREGLASS_CONTENT_REVISION,
    kind,
    from: Object.freeze({ ...from.center }),
    to: Object.freeze({ ...to.center }),
    logCost: kind === 'bridge' ? 8 : 4,
    spanMeters: kind === 'bridge' ? 8 : 4,
    riseMeters: Number((to.center.y - from.center.y).toFixed(2)),
  })
}

/** Canonical route choices for the active Mireglass revision, independent of chunk activation and caller mutation. */
export function mireglassRouteSites(seed: string): readonly MireglassRouteSite[] {
  const normalizedSeed = seed || 'wizard-realms'
  const occupied = [
    ...Object.values(mireglassAnchors(normalizedSeed)).map(({ tile }) => tile.center),
    ...mireglassResources(normalizedSeed).map(({ tile }) => tile.center),
  ]
  const sites: MireglassRouteSite[] = []

  const fen = MIREGLASS_ENVELOPES.fenChannel
  for (let x = fen.minX; x < fen.maxX; x += CELL) {
    const row = mireglassFenRowAt(normalizedSeed, x)
    const approach = tileAt(normalizedSeed, x, row - 2 * CELL)
    const from = tileAt(normalizedSeed, x, row - CELL)
    const water = tileAt(normalizedSeed, x, row)
    const to = tileAt(normalizedSeed, x, row + CELL)
    const exit = tileAt(normalizedSeed, x, row + 2 * CELL)
    if (water.terrain !== 'wetland' || [approach, from, to, exit].some(({ terrain }) => terrain !== 'loam')
      || !walkableStep(approach, from) || !walkableStep(from, water)
      || !walkableStep(water, to) || !walkableStep(to, exit)
      || !clearOfContent(occupied, approach.center, exit.center)) continue
    sites.push(site('bridge', x, row, from, to))
  }

  const berm = MIREGLASS_ENVELOPES.slateBerm
  for (let x = berm.minX; x < berm.maxX; x += CELL) {
    const row = mireglassBermFaceRowAt(normalizedSeed, x)
    const approach = tileAt(normalizedSeed, x, row - 2 * CELL)
    const from = tileAt(normalizedSeed, x, row - CELL)
    const to = tileAt(normalizedSeed, x, row)
    const exit = tileAt(normalizedSeed, x, row + CELL)
    const rise = to.center.y - from.center.y
    if (approach.terrain !== 'loam' || from.terrain !== 'loam'
      || to.terrain !== 'rocky' || exit.terrain !== 'rocky'
      || Math.abs(rise - 1.56) > 1e-6
      || !walkableStep(approach, from) || !walkableStep(to, exit)
      || !clearOfContent(occupied, approach.center, exit.center)) continue
    sites.push(site('ladder', x, row, from, to))
  }

  if (sites.filter(({ kind }) => kind === 'bridge').length < 2
    || sites.filter(({ kind }) => kind === 'ladder').length < 2) {
    throw new Error(`Insufficient Mireglass route sites for ${normalizedSeed} in ${MIREGLASS_CONTENT_REVISION}`)
  }
  return Object.freeze(sites)
}
