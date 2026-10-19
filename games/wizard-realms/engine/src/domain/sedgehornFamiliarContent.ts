import { hashSeed } from './generation'
import { mireglassAnchors } from './mireglassContent'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import type { PublicV42RewardProgress } from './publicWorldV42RewardAction'
import type { WorldTile } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

export type SedgehornFamiliarSite = Readonly<{
  id: string
  tracks: WorldTile
  habitat: WorldTile
  shelter: WorldTile
  dryApproach: WorldTile
  careStation: WorldTile
  keeper: WorldTile
}>

/** A seed-bound marsh edge, not an arbitrary client-selected creature position. */
export function resolveSedgehornFamiliarSite(
  progress: PublicV42RewardProgress,
): SedgehornFamiliarSite | null {
  try {
    const seed = progress.state.seed
    const anchors = mireglassAnchors(seed)
    const patches = mireglassHerbPatches(seed)
    if (patches.length < 3 || anchors.bellAlder.tile.terrain !== 'wetland') return null
    const ranked = patches.map(({ tile }) => tile)
      .sort((a, b) => Math.hypot(a.center.x - anchors.bellAlder.tile.center.x,
        a.center.z - anchors.bellAlder.tile.center.z)
        - Math.hypot(b.center.x - anchors.bellAlder.tile.center.x,
          b.center.z - anchors.bellAlder.tile.center.z)
        || a.id.localeCompare(b.id))
    // A few valid seeds have only three herb patches. Do not alter the saved herb
    // catalog: place the fourth encounter anchor on walkable dry ground beside one.
    if (ranked.length === 3) {
      const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
      const keeper = ranked.flatMap((patch) => directions.map(([dx, dz]) => {
        const tile = worldTileAtGrid(seed, patch.center.x / WORLD_CELL_METERS + dx,
          patch.center.z / WORLD_CELL_METERS + dz)
        return { patch, tile }
      })).find(({ patch, tile }) => tile.terrain === 'loam'
        && !ranked.some(({ id }) => id === tile.id)
        && mireglassMoveBarrier(seed, patch.center, tile.center) === null
        && mireglassMoveBarrier(seed, tile.center, patch.center) === null
        && (() => {
          const surface = resolvePublicV23Surface(progress.state, tile.center,
            progress.regionalWorks.builtLadderIds)
          return surface?.support === 'terrain'
            && Math.abs(surface.floorY - tile.center.y) <= 1e-6
        })())?.tile
      if (!keeper) return null
      ranked.push(keeper)
    }
    const [shelter, tracks, dryApproach, keeper] = ranked
    const dry = [tracks, shelter, dryApproach, keeper]
    if (dry.some((tile) => {
      const surface = resolvePublicV23Surface(progress.state, tile.center,
        progress.regionalWorks.builtLadderIds)
      return tile.terrain !== 'loam' || surface?.support !== 'terrain'
        || Math.abs(surface.floorY - tile.center.y) > 1e-6
    })) return null
    return {
      id: `sedgehorn-juvenile-${hashSeed(`${seed}:lost-familiar/v1`)}`,
      tracks, habitat: anchors.bellAlder.tile, shelter, dryApproach,
      careStation: shelter, keeper,
    }
  } catch { return null }
}
