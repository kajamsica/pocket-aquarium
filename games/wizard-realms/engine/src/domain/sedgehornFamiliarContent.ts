import { hashSeed } from './generation'
import { mireglassAnchors } from './mireglassContent'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import type { PublicV42RewardProgress } from './publicWorldV42RewardAction'
import type { WorldTile } from './types'

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
    if (patches.length < 4 || anchors.bellAlder.tile.terrain !== 'wetland') return null
    const [shelter, tracks, dryApproach, keeper] = patches.map(({ tile }) => tile)
      .sort((a, b) => Math.hypot(a.center.x - anchors.bellAlder.tile.center.x,
        a.center.z - anchors.bellAlder.tile.center.z)
        - Math.hypot(b.center.x - anchors.bellAlder.tile.center.x,
          b.center.z - anchors.bellAlder.tile.center.z)
        || a.id.localeCompare(b.id))
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
