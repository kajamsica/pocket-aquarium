import { ironHallSite } from './ironHallSite'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import type { PublicV40WaystationProgress } from './publicWorldV40WaystationAction'
import type { WorldTile } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

/** The dry cell beside the hall alcove, with height supplied by the world seed. */
export function ironHallQuartermasterSite(progress: PublicV40WaystationProgress): WorldTile | null {
  try {
    const hall = ironHallSite(progress)
    if (!hall) return null
    const x = 80, z = 24, gx = x / WORLD_CELL_METERS, gz = z / WORLD_CELL_METERS
    const tile = worldTileAtGrid(progress.state.seed, gx, gz)
    const surface = resolvePublicV23Surface(progress.state, { x, z },
      progress.regionalWorks.builtLadderIds)
    return tile.terrain === 'loam'
      && !publicV25RiverCellAtGrid(progress.state.seed, gx, gz)
      && !publicV26TerrainCellIsWet(progress.state.seed, gx, gz, 'streamed')
      && surface?.support === 'terrain'
      && Math.abs(surface.floorY - tile.center.y) < 1e-6
      && Math.hypot(hall.alcove.center.x - x, hall.alcove.center.z - z)
        === WORLD_CELL_METERS
      && Math.abs(hall.alcove.center.y - tile.center.y) <= 0.8
      ? tile : null
  } catch { return null }
}
