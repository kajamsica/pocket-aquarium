import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import type { PublicV40WaystationProgress } from './publicWorldV40WaystationAction'
import type { WorldTile } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

/** Fixed world coordinates, with tile height and support resolved from the save's seed. */
export function ironHallSite(progress: PublicV40WaystationProgress):
  Readonly<{ alcove: WorldTile; ward: WorldTile; door: WorldTile }> | null {
  try {
    const { state } = progress
    const at = (x: number, z: number): WorldTile | null => {
      const gx = x / WORLD_CELL_METERS, gz = z / WORLD_CELL_METERS
      const tile = worldTileAtGrid(state.seed, gx, gz)
      const surface = resolvePublicV23Surface(state, { x, z },
        progress.regionalWorks.builtLadderIds)
      return tile.terrain === 'loam' && !publicV25RiverCellAtGrid(state.seed, gx, gz)
        && !publicV26TerrainCellIsWet(state.seed, gx, gz, 'streamed')
        && surface?.support === 'terrain'
        && Math.abs(surface.floorY - tile.center.y) < 1e-6 ? tile : null
    }
    const alcove = at(80, 28), ward = at(84, 32), door = at(84, 36)
    return alcove && ward && door ? { alcove, ward, door } : null
  } catch { return null }
}
