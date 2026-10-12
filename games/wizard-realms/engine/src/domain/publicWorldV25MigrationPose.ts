import { publicV14InsideGreenway } from './publicWorldV14Boundary'
import { publicV11RouteAtPosition } from './publicV11RouteSupport'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { decodePublicV23Progress } from './publicWorldV23Snapshot'
import type { PublicV24Progress } from './publicWorldV24Snapshot'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { publicV25RiverCellAtGrid, publicV25RiverCenterZ } from './publicWorldV25River'
import { starterCliffWorldTileAtGrid } from './starterCliffWorld'
import { terrainWorkSupportAt } from './terrainWorkSupport'
import { resolveTerrainWorkSite } from './terrainWorks'
import type { Vec3 } from './types'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

export type PublicV25Relocation = Readonly<{ from: Vec3; to: Vec3 }>
const EPSILON = 1e-6
const cellAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
const inWorld = (coordinate: number) => Number.isSafeInteger(coordinate)
  && coordinate >= WORLD_GRID_MIN && coordinate <= WORLD_GRID_MAX

/** Pure pose mapping. The future checked V25 writer owns the source receipt. */
export function relocatePublicV25RiverSource(raw: PublicV24Progress):
  { progress: PublicV24Progress; relocation: PublicV25Relocation | null } | null {
  try {
    const checked = decodePublicV23Progress(raw, raw?.state?.seed)
    if (!checked) return null
    const { state, greenwayWorks, regionalWorks } = checked
    const from = state.player.position, gx = cellAt(from.x), gz = cellAt(from.z)
    if (!inWorld(gx) || !inWorld(gz)) return null
    if (!publicV25RiverCellAtGrid(state.seed, gx, gz)) {
      return { progress: checked, relocation: null }
    }

    const greenway = state.movementOwner === 'greenway'
    const starterContext = { seed: state.seed, profile: state.generationProfile,
      route: state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
      built: state.greenway.builtRouteIds.includes('greenway_ladder'), greenwayWorks }
    if (greenway) {
      if (publicV17StarterSupportAt(starterContext, from)?.kind === 'bridge') {
        return { progress: checked, relocation: null }
      }
    } else {
      const surface = resolvePublicV23Surface(state, from, regionalWorks.builtLadderIds)
      if (surface && surface.support !== 'terrain'
        && surface.floorY > surface.terrainY + EPSILON) {
        const builtDeck = state.terrainWorks.builtWorkIds.some((id) => {
          const site = resolveTerrainWorkSite(state.seed, id)
          return site?.kind === 'bridge'
            && Math.abs((terrainWorkSupportAt(site, from).floorY ?? NaN) - surface.floorY) <= EPSILON
        })
        const authored = publicV11RouteAtPosition({ ...state,
          generationProfile: 'greenway-expanded-v1',
          greenway: { ...state.greenway, builtRouteIds: [] },
          discoveredTileIds: [] }, from)
        if (builtDeck || authored?.route.kind === 'fen_bridge'
          && Math.abs(authored.floorY - surface.floorY) <= EPSILON) {
          return { progress: checked, relocation: null }
        }
      }
    }

    const centerlineZ = publicV25RiverCenterZ(state.seed, gx) * WORLD_CELL_METERS
    const northBank = from.z <= centerlineZ
    const rows = Array.from({ length: 17 }, (_, index) => gz + index - 8)
      .filter(inWorld)
      .sort((a, b) => Math.abs(a * WORLD_CELL_METERS - from.z)
        - Math.abs(b * WORLD_CELL_METERS - from.z) || a - b)
    for (const row of rows) {
      if (publicV25RiverCellAtGrid(state.seed, gx, row)) continue
      const point = { x: from.x, z: row * WORLD_CELL_METERS }
      if (northBank ? point.z >= centerlineZ : point.z <= centerlineZ) continue
      if (publicV14InsideGreenway(point) !== greenway) continue
      const oldTile = greenway
        ? publicWorldV16TileAtGrid(state.seed, gx, row)
        : starterCliffWorldTileAtGrid(state.seed, gx, row)
      if (oldTile.terrain === 'wetland') continue
      let floorY: number | null
      if (greenway) {
        const support = publicV17StarterSupportAt(starterContext, point)
        floorY = support?.kind === 'ground' ? support.floorY : null
      } else {
        const support = resolvePublicV23Surface(state, point, regionalWorks.builtLadderIds)
        floorY = support?.support === 'terrain' ? support.floorY : null
      }
      if (floorY === null) continue
      const to = { ...point, y: floorY }
      const candidate = decodePublicV23Progress({ ...checked, state: { ...state,
        player: { ...state.player, position: to, verticalVelocity: 0 } } }, state.seed)
      if (candidate) return { progress: candidate, relocation: {
        from: { ...from }, to: { ...to } } }
    }
    return null
  } catch { return null }
}
