import { PUBLIC_RUN_STEP_METERS } from './publicWorldGait'
import { publicV11RouteAtPosition } from './publicV11RouteSupport'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { decodePublicV23Progress } from './publicWorldV23Snapshot'
import type { PublicV24Progress } from './publicWorldV24Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV25RiverTouchesSegment } from './publicWorldV25RiverSweep'
import { terrainWorkSupportAt } from './terrainWorkSupport'
import { resolveTerrainWorkSite } from './terrainWorks'
import type { Vec3 } from './types'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

type Passage = { ok: true } | { ok: false; reason: 'river-needs-bridge' | 'invalid-segment' }
const cell = (value: number) => Math.ceil(value / WORLD_CELL_METERS - 0.5)
const inWorld = (point: Vec3) => [point.x, point.y, point.z].every(Number.isFinite)
  && [cell(point.x), cell(point.z)].every((value) => value >= WORLD_GRID_MIN && value <= WORLD_GRID_MAX)
const EPSILON = 1e-6
/** Gate each old movement segment against the new river and persisted bridge geometry. */
export function publicV25RiverPassage(progress: PublicV24Progress, from: Vec3, to: Vec3): Passage {
  const invalid = { ok: false, reason: 'invalid-segment' } as const,
    blocked = { ok: false, reason: 'river-needs-bridge' } as const
  try {
    if (!inWorld(from) || !inWorld(to)) return invalid
    const length = Math.hypot(to.x - from.x, to.z - from.z)
    if (length > PUBLIC_RUN_STEP_METERS + EPSILON) return invalid
    const seed = progress.state.seed
    if (!publicV25RiverTouchesSegment(seed, from, to)) return { ok: true }
    const checked = decodePublicV23Progress(progress, seed)
    if (!checked) return invalid
    const { state, greenwayWorks, regionalWorks } = checked
    const greenway = state.movementOwner === 'greenway'
    const context = { seed, profile: state.generationProfile,
      route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
      built: state.greenway.builtRouteIds.includes('greenway_ladder'), greenwayWorks }
    const bridges = state.terrainWorks.builtWorkIds.map((id) => resolveTerrainWorkSite(seed, id)).filter((site) => site?.kind === 'bridge')
    const authored = { ...state, generationProfile: 'greenway-expanded-v1' as const,
      greenway: { ...state.greenway, builtRouteIds: [] }, discoveredTileIds: [] }
    let wetSamples = 0
    for (let index = 0, count = Math.max(1, Math.ceil(length / 0.125)); index <= count; index++) {
      const t = index / count
      const point = { x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t }
      if (!publicV25RiverCellAtGrid(seed, cell(point.x), cell(point.z))) continue
      wetSamples++
      if (greenway) {
        const support = publicV17StarterSupportAt(context, point)
        if (support?.kind !== 'bridge' || Math.abs(point.y - support.floorY) > 0.03
          || support.floorY <= publicWorldV16TileAtGrid(seed, cell(point.x), cell(point.z)).center.y + EPSILON) return blocked
      } else {
        const surface = resolvePublicV23Surface(state, point, regionalWorks.builtLadderIds)
        if (!surface || surface.floorY <= surface.terrainY + EPSILON
          || Math.abs(point.y - surface.floorY) > 0.03) return blocked
        const built = bridges.some((site) => site?.kind === 'bridge'
          && Math.abs((terrainWorkSupportAt(site, point).floorY ?? NaN) - surface.floorY) <= EPSILON)
        const route = publicV11RouteAtPosition(authored, point)
        if (!built && !(route?.route.kind === 'fen_bridge'
          && Math.abs(route.floorY - surface.floorY) <= EPSILON)) return blocked
      }
    }
    return wetSamples ? { ok: true } : blocked
  } catch { return invalid }
}
