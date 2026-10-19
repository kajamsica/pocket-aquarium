import { publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { worldTileAtGrid } from './worldChunks'

/** Match the checked movement owner's canonical surface, not the unoverlaid world tile. */
export function publicV26TerrainCellIsWet(seed: string, gx: number, gz: number,
  movementOwner: 'greenway' | 'streamed'): boolean {
  return (movementOwner === 'greenway'
    ? publicWorldV16TileAtGrid(seed, gx, gz)
    : worldTileAtGrid(seed, gx, gz)).terrain === 'wetland'
}
