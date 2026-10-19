import { projectPublicV28Pose } from './publicWorldV28RiverSupport'
import type { PublicV28PoseProjection } from './publicWorldV28RiverSupport'
import type { PublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import type { PublicV31Progress } from './publicWorldV31Migration'
import { decodePublicV31RaisedSoilCells, publicV31HasRaisedSoilCell } from './publicWorldV31Soil'
import type { Vec3 } from './types'

/** The V30 carrier remains canonical; only dry ground's effective top rises. */
export function projectPublicV31Pose(progress: PublicV31Progress,
  carrier?: Vec3): PublicV28PoseProjection | null {
  try {
    const cells = decodePublicV31RaisedSoilCells(progress.raisedSoilCells)
    if (!cells) return null
    const base = projectPublicV28Pose(progress, progress.terrain, progress.riverBridgeIds,
      carrier ?? progress.state.player.position)
    if (!base) return null
    if (!publicV31HasRaisedSoilCell(cells, base.cell.gx, base.cell.gz)) return base
    if (base.support !== 'ground' && base.support !== 'terrain'
      || progress.terrain.columns.some((column) => column.gx === base.cell.gx
        && column.gz === base.cell.gz && column.openDepth > 0)) return null
    return { ...base, effective: { floorY: base.effective.floorY + 0.4,
      position: { ...base.effective.position, y: base.effective.position.y + 0.4 } } }
  } catch { return null }
}

/** V31 can only tighten a checked inherited move, never bypass river or rim gates. */
export function publicV31EffectiveStepAccepted(start: PublicV28PoseProjection,
  end: PublicV28PoseProjection, terrain: PublicV26TerrainLedger): boolean {
  const epsilon = 1e-6
  const change = Math.abs(end.effective.floorY - start.effective.floorY)
  const pit = start.effective.floorY < start.carrier.floorY - epsilon
    || end.effective.floorY < end.carrier.floorY - epsilon
  if (pit) {
    if (change <= 0.55 + epsilon) return true
    return Math.abs(end.carrier.floorY - start.carrier.floorY) <= 0.55 + epsilon
      && (start.cell.gx !== end.cell.gx || start.cell.gz !== end.cell.gz)
      && [start, end].some((pose) => pose.effective.floorY < pose.carrier.floorY - epsilon
        && terrain.columns.some((column) => column.gx === pose.cell.gx
          && column.gz === pose.cell.gz && column.openDepth > 0 && column.pitLadder))
  }
  const ordinary = (start.support === 'ground' || start.support === 'terrain')
    && (end.support === 'ground' || end.support === 'terrain')
  if (change <= (ordinary ? 0.8 : 0.55) + epsilon) return true
  return start.support === 'ladder' || end.support === 'ladder'
    || start.support === 'bridge' || end.support === 'bridge'
}
