import { createActiveWorldTerrain } from './activeWorldTerrain'
import { createPublicV11RouteSupport } from './publicV11RouteSupport'
import { cloneBoundedPublicV12CompactShape } from './publicWorldV12CompactValidation'
import type { PublicV12Head } from './publicWorldV12Snapshot'
import { isValidTerrainWorkLedger } from './terrainWorkLedger'
import type { TerrainWorkLedger } from './terrainWorkLedger'
import { terrainWorkSupportAt } from './terrainWorkSupport'
import { resolveTerrainWorkSite } from './terrainWorks'

type CompactState = PublicV12Head['state']
export type PublicWorldV13PoseProof = Readonly<{
  originalY: number; originalVerticalVelocity: number
  effectiveFloorY: number | null; legacyFloorY: number | null
  /** Validation-only v12 witness. Persist the caller's original Y instead. */
  witness: CompactState
}>

/** Caller owns and bounds the compact state; P5B must still validate the returned witness. */
export function provePublicWorldV13Pose(state: CompactState,
  ledger: TerrainWorkLedger): PublicWorldV13PoseProof | null {
  try {
    const owned = cloneBoundedPublicV12CompactShape(state)
    if (!owned) return null
    const context = { seed: owned.seed, fieldCampTileIds: owned.fieldCampTileIds,
      authoredBuiltRouteIds: [owned.mireglass.builtRoutes.bridge, owned.mireglass.builtRoutes.ladder]
        .filter((id): id is string => id !== null) }
    if (!isValidTerrainWorkLedger(ledger, context)) return null
    const works = structuredClone(ledger) as TerrainWorkLedger
    if (!isValidTerrainWorkLedger(works, context)) return null
    const { position, verticalVelocity } = owned.player
    if (![position.x, position.y, position.z, verticalVelocity].every(Number.isFinite)) return null
    const originalY = position.y
    if (owned.movementOwner === 'greenway') return { originalY,
      originalVerticalVelocity: verticalVelocity, effectiveFloorY: null,
      legacyFloorY: null, witness: owned }
    if (owned.movementOwner !== 'streamed') return null
    const terrain = createActiveWorldTerrain(owned.seed,
      { cachePitDug: owned.mireglass.cacheExcavated, highlandRidge: true })
    terrain.activate(position)
    const tile = terrain.tileAtWorld(position.x, position.z)
    if (!tile) return null
    const authored = createPublicV11RouteSupport({ ...owned, discoveredTileIds: [] })
    const legacyFloorY = authored.floorY(position, tile.center.y)
    let newFloorY = tile.center.y - (works.dugTileIds.includes(tile.id) ? 0.24 : 0)
    for (const id of works.builtWorkIds) {
      const site = resolveTerrainWorkSite(owned.seed, id)
      if (!site || site.kind === 'dig') return null
      const floor = terrainWorkSupportAt(site, position).floorY
      if (floor !== null) { newFloorY = floor; break }
    }
    const effectiveFloorY = authored.floorY(position, newFloorY)
    if (originalY < effectiveFloorY) return null
    return { originalY, originalVerticalVelocity: verticalVelocity,
      effectiveFloorY, legacyFloorY,
      witness: { ...owned, player: { ...owned.player,
        position: { ...position, y: Math.max(originalY, legacyFloorY) } } } }
  } catch { return null }
}
