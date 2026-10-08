import { mireglassAnchors } from './mireglassContent'
import type { WorldTile } from './types'

/** Only new-world callers supply these facts; omission retains seed-only terrain. */
export interface TerrainFacts {
  readonly cachePitDug: boolean
  readonly highlandRidge?: true
}

/** Copies the canonical cache cell without changing generated chunks or Mireglass content. */
export function createCachePitOverlay(seed: string, facts?: TerrainFacts): (tiles: WorldTile[]) => WorldTile[] {
  const cacheTileId = facts?.cachePitDug === true ? mireglassAnchors(seed).sealCache.tile.id : null
  return (tiles) => {
    if (!cacheTileId) return tiles
    const index = tiles.findIndex((tile) => tile.id === cacheTileId)
    if (index < 0) return tiles
    const overlaid = tiles.slice()
    const tile = tiles[index]
    overlaid[index] = { ...tile, elevation: 0.55, center: { ...tile.center, y: 1.65 } }
    return overlaid
  }
}
