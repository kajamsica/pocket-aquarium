import { discoveryMaskHasTileId } from './discoveryMask'
import { MIREGLASS_RING_ID, mireglassFairyRing } from './mireglassContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { projectPublicV31Pose } from './publicWorldV31Support'
import type { PublicV32Progress } from './publicWorldV32Migration'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const GREENWAY_RING_ID = 'ring-greenway' as const
const REACH_METERS = 3
const EPSILON = 1e-6

export type PublicV33FairyRingWitness = Readonly<{
  kind: 'fairy-ring-discover/v1'; ringId: typeof GREENWAY_RING_ID
}> | Readonly<{
  kind: 'fairy-ring-travel/v1'
  sourceRingId: typeof GREENWAY_RING_ID | typeof MIREGLASS_RING_ID
  targetRingId: typeof GREENWAY_RING_ID | typeof MIREGLASS_RING_ID
}>
export type PublicV33FairyRingResult = Readonly<{ progress: PublicV32Progress; rejection?: never }>
  | Readonly<{ progress?: never; rejection: string }>

export function decodePublicV33FairyRingWitness(value: unknown): PublicV33FairyRingWitness | null {
  try {
    if (exactPublicV23(value, ['kind', 'ringId'])
      && value.kind === 'fairy-ring-discover/v1' && value.ringId === GREENWAY_RING_ID)
      return { kind: 'fairy-ring-discover/v1', ringId: GREENWAY_RING_ID }
    if (exactPublicV23(value, ['kind', 'sourceRingId', 'targetRingId'])
      && value.kind === 'fairy-ring-travel/v1'
      && (value.sourceRingId === GREENWAY_RING_ID && value.targetRingId === MIREGLASS_RING_ID
        || value.sourceRingId === MIREGLASS_RING_ID && value.targetRingId === GREENWAY_RING_ID))
      return { kind: 'fairy-ring-travel/v1', sourceRingId: value.sourceRingId,
        targetRingId: value.targetRingId }
  } catch { /* Reject proxies and accessor-bearing requests. */ }
  return null
}

/** The witness carries IDs only; ring positions and arrival support come from checked world facts. */
export function confirmPublicV33FairyRingAction(rawProgress: PublicV32Progress,
  rawWitness: unknown): PublicV33FairyRingResult {
  const reject = (rejection: string): PublicV33FairyRingResult => ({ rejection })
  const witness = decodePublicV33FairyRingWitness(rawWitness)
  if (!witness) return reject('invalid_action')
  const progress = decodePublicV31ActionProgress(rawProgress)
  if (!progress) return reject('invalid_progress')
  try {
    const { state } = progress
    const greenway = state.greenway.fairyRings.find(({ id }) => id === GREENWAY_RING_ID)
    if (!greenway) return reject('not_found')
    const mireglass = mireglassFairyRing(state.seed)
    const greenwayTile = worldTileAtGrid(state.seed,
      Math.ceil(greenway.position.x / WORLD_CELL_METERS - 0.5),
      Math.ceil(greenway.position.z / WORLD_CELL_METERS - 0.5))
    const sourceIsGreenway = witness.kind === 'fairy-ring-discover/v1'
      || witness.sourceRingId === GREENWAY_RING_ID
    const source = sourceIsGreenway ? greenway.position : mireglass.tile.center
    const sourceTileId = sourceIsGreenway ? greenwayTile.id : mireglass.tile.id
    if (state.movementOwner !== (sourceIsGreenway ? 'greenway' : 'streamed'))
      return reject('wrong_region')
    const pose = projectPublicV31Pose(progress)
    if (!pose || state.player.verticalVelocity !== 0
      || Math.abs(pose.effective.position.y - pose.effective.floorY) > EPSILON)
      return reject('not_grounded')
    if (!discoveryMaskHasTileId(state.discoveryMask, sourceTileId))
      return reject('unrevealed')
    if (Math.hypot(pose.effective.position.x - source.x,
      pose.effective.position.y - source.y,
      pose.effective.position.z - source.z) > REACH_METERS) return reject('too_far')
    if (!Number.isSafeInteger(state.eventSequence + 1)) return reject('overflow')
    if (witness.kind === 'fairy-ring-discover/v1') {
      if (state.player.discoveredRingIds.includes(GREENWAY_RING_ID))
        return reject('already_discovered')
      const next: PublicV32Progress = { ...progress, state: { ...state,
        eventSequence: state.eventSequence + 1,
        player: { ...state.player, discoveredRingIds: [
          ...state.player.discoveredRingIds, GREENWAY_RING_ID] } } }
      return decodePublicV31ActionProgress(next) ? { progress: next } : reject('invalid_value')
    }
    if (!state.player.discoveredRingIds.includes(GREENWAY_RING_ID)
      || !state.player.discoveredRingIds.includes(MIREGLASS_RING_ID))
      return reject('undiscovered')
    const targetIsGreenway = witness.targetRingId === GREENWAY_RING_ID
    const target = targetIsGreenway ? greenway.position : mireglass.tile.center
    const targetTile = targetIsGreenway ? greenwayTile : mireglass.tile
    if (!discoveryMaskHasTileId(state.discoveryMask, targetTile.id))
      return reject('unrevealed')
    if (!Number.isSafeInteger(state.tick + 1)) return reject('overflow')
    const floor = targetIsGreenway
      ? publicV17StarterSupportAt({ seed: state.seed, profile: state.generationProfile,
        route: state.greenway.routes.find(({ id }) => id === 'greenway_ladder') ?? null,
        built: state.greenway.builtRouteIds.includes('greenway_ladder'),
        greenwayWorks: progress.greenwayWorks }, target)
      : resolvePublicV23Surface(state, target, progress.regionalWorks.builtLadderIds)
    if (!floor) return reject('unsafe_arrival')
    const next: PublicV32Progress = { ...progress, state: { ...state,
      tick: state.tick + 1, eventSequence: state.eventSequence + 1,
      movementOwner: targetIsGreenway ? 'greenway' : 'streamed',
      player: { ...state.player, position: { x: target.x, y: floor.floorY, z: target.z },
        verticalVelocity: 0 } } }
    const arrival = projectPublicV31Pose(next)
    if (!arrival || arrival.support !== 'ground' && arrival.support !== 'terrain'
      || publicV25RiverCellAtGrid(state.seed, arrival.cell.gx, arrival.cell.gz)
      || targetTile.terrain === 'wetland'
      || progress.terrain.columns.some(({ gx, gz, openDepth }) =>
        gx === arrival.cell.gx && gz === arrival.cell.gz && openDepth > 0)
      || Math.abs(arrival.effective.position.y - arrival.effective.floorY) > EPSILON)
      return reject('unsafe_arrival')
    return decodePublicV31ActionProgress(next) ? { progress: next } : reject('unsafe_arrival')
  } catch { return reject('invalid_progress') }
}
