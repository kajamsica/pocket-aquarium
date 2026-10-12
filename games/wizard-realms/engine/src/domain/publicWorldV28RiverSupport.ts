import type { PublicV24Progress } from './publicWorldV24Snapshot'
import { projectPublicV26Pose } from './publicWorldV26Pose'
import type { PublicV26PoseProjection } from './publicWorldV26Pose'
import { decodePublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import type { PublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import type { PublicV28RiverBridgeSite } from './publicWorldV28RiverBridgeSites'
import { terrainWorkSupportAt } from './terrainWorkSupport'
import type { Vec3 } from './types'

export const PUBLIC_V28_MAX_RIVER_BRIDGES = 128

/** A saved ledger is canonical, sorted and re-resolved, never a bag of client coordinates. */
export function publicV28ResolvedRiverBridges(seed: string, ids: readonly string[]):
  readonly PublicV28RiverBridgeSite[] | null {
  try {
    if (!Array.isArray(ids) || Object.getPrototypeOf(ids) !== Array.prototype
      || ids.length > PUBLIC_V28_MAX_RIVER_BRIDGES
      || Reflect.ownKeys(ids).length !== ids.length + 1) return null
    const sites: PublicV28RiverBridgeSite[] = []
    for (let index = 0; index < ids.length; index++) {
      if (typeof ids[index] !== 'string' || index > 0 && ids[index - 1] >= ids[index]) return null
      const site = resolvePublicV28RiverBridge(seed, ids[index])
      if (!site) return null
      sites.push(site)
    }
    return sites
  } catch { return null }
}

/** Generic work interpolation is the sole authority for the rendered deck path. */
export function publicV28RiverBridgeFloorAt(site: PublicV28RiverBridgeSite,
  point: Readonly<{ x: number; z: number }>): number | null {
  // The interpolator reads path and width only; its older obstacle union is nominal.
  return terrainWorkSupportAt(site as unknown as Parameters<typeof terrainWorkSupportAt>[0], point).floorY
}

export type PublicV28PoseProjection = PublicV26PoseProjection & Readonly<{ bridgeId: string | null }>

/** Keep V26's validated carrier Y; lift only its effective floor and visible pose. */
export function projectPublicV28Pose(progress: PublicV24Progress,
  terrain: PublicV26TerrainLedger, riverBridgeIds: readonly string[],
  carrier: Vec3 = progress.state.player.position): PublicV28PoseProjection | null {
  try {
    const checkedTerrain = decodePublicV26TerrainLedger(terrain)
    const sites = publicV28ResolvedRiverBridges(progress.state.seed, riverBridgeIds)
    if (!checkedTerrain || !sites) return null
    const base = projectPublicV26Pose(progress, checkedTerrain, carrier)
    if (!base) return null
    const onDeck = sites.map((site) => ({ site,
      floorY: publicV28RiverBridgeFloorAt(site, carrier) }))
      .filter((value): value is { site: PublicV28RiverBridgeSite; floorY: number } =>
        value.floorY !== null)
    if (onDeck.length > 1) return null
    if (!onDeck.length) return { ...base, bridgeId: null }
    const { site, floorY } = onDeck[0]
    if (floorY < base.effective.floorY - 1e-6) return null
    return { ...base, support: 'bridge', bridgeId: site.id,
      effective: { position: { ...base.effective.position,
        y: base.effective.position.y + floorY - base.effective.floorY }, floorY } }
  } catch { return null }
}
