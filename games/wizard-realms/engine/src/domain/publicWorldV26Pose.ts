import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import type { PublicV24Progress } from './publicWorldV24Snapshot'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import type { PublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import type { Vec3 } from './types'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

const EPSILON = 1e-6
const cell = (value: number) => Math.ceil(value / WORLD_CELL_METERS - 0.5)
const withinWorld = (value: number) => value >= WORLD_GRID_MIN && value <= WORLD_GRID_MAX

type Floor = Readonly<{ floorY: number;
  kind: 'ground' | 'bridge' | 'ladder' | 'terrain' | 'work' | 'authored_route' }>
export type PublicV26PoseProjection = Readonly<{
  cell: Readonly<{ gx: number; gz: number }>
  support: Floor['kind']
  carrier: Readonly<{ position: Vec3; floorY: number }>
  effective: Readonly<{ position: Vec3; floorY: number }>
  homePose: Vec3 | null
}>

function oldFloorAt(progress: PublicV24Progress, point: { x: number; z: number },
  owner: 'greenway' | 'streamed'): Floor | null {
  const { state, greenwayWorks, regionalWorks } = progress
  if (owner === 'greenway') {
    const support = publicV17StarterSupportAt({ seed: state.seed,
      profile: state.generationProfile,
      route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
      built: state.greenway.builtRouteIds.includes('greenway_ladder'), greenwayWorks }, point)
    return support ? { floorY: support.floorY, kind: support.kind } : null
  }
  const support = resolvePublicV23Surface(state, point, regionalWorks.builtLadderIds)
  return support ? { floorY: support.floorY, kind: support.support } : null
}

/** A read-only V26 view. Old validated Y remains the source-replay carrier. */
export function projectPublicV26Pose(progress: PublicV24Progress,
  ledger: PublicV26TerrainLedger, carrier: Vec3 = progress.state.player.position):
  PublicV26PoseProjection | null {
  try {
    if (![carrier.x, carrier.y, carrier.z].every(Number.isFinite)) return null
    const gx = cell(carrier.x), gz = cell(carrier.z)
    if (!withinWorld(gx) || !withinWorld(gz)) return null
    const old = oldFloorAt(progress, carrier, progress.state.movementOwner)
    if (!old || !Number.isFinite(old.floorY) || carrier.y < old.floorY - EPSILON) return null
    const ground = old.kind === 'ground' || old.kind === 'terrain'
    const depth = ground ? ledger.columns.find((column) => column.gx === gx
      && column.gz === gz)?.openDepth ?? 0 : 0
    if (!Number.isSafeInteger(depth) || depth < 0 || depth > 12) return null
    const effectiveFloorY = old.floorY - depth * 0.4
    const homeOpen = ledger.columns.some((column) => column.gx === 0
      && column.gz === 0 && column.openDepth > 0)
    const home = !homeOpen && !publicV25RiverCellAtGrid(progress.state.seed, 0, 0)
      ? oldFloorAt(progress, { x: 0, z: 0 }, 'greenway') : null
    const homePose = home?.kind === 'ground' && Number.isFinite(home.floorY)
      ? { x: 0, y: home.floorY, z: 0 } : null
    return { cell: { gx, gz }, support: old.kind,
      carrier: { position: { ...carrier }, floorY: old.floorY },
      effective: { position: { ...carrier, y: effectiveFloorY + carrier.y - old.floorY },
        floorY: effectiveFloorY }, homePose }
  } catch { return null }
}
