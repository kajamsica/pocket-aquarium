import { discoveryMaskHasTileId } from './discoveryMask'
import { highlandQuarryRing } from './highlandQuarryRingContent'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV31HasRaisedSoilCell } from './publicWorldV31Soil'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { decodePublicV38Progress } from './publicWorldV38Snapshot'
import { PUBLIC_V38_PROGRESS_KEYS } from './publicWorldV38SignalAction'
import type { PublicV38SignalProgress } from './publicWorldV38SignalAction'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

export type PublicV39RingProgress = PublicV38SignalProgress & Readonly<{
  quarryRingDiscovered: boolean
  ringLinkEstablished: boolean
  ringOutboundCompleted: boolean
  ringReturnCompleted: boolean
  ringkeeperClaimed: boolean
}>
export type PublicV39RingWitness = Readonly<{ kind: 'ringkeeper-discover/v1' }>
  | Readonly<{ kind: 'ringkeeper-link/v1' }>
  | Readonly<{ kind: 'ringkeeper-claim/v1' }> | Readonly<{
  kind: 'ringkeeper-travel/v1'
  direction: 'greenway-to-highland' | 'highland-to-greenway'
}>
export type PublicV39RingRejection = 'invalid_value' | 'invalid_progress' | 'wrong_region'
  | 'not_grounded' | 'unsafe_source' | 'unsafe_arrival' | 'undiscovered'
  | 'unrevealed' | 'too_far' | 'already_discovered' | 'already_linked'
  | 'requires_link' | 'requires_outbound' | 'requires_return' | 'already_claimed'
export type PublicV39RingResult = Readonly<{
  progress: PublicV39RingProgress; rejection?: never
}> | Readonly<{ progress?: never; rejection: PublicV39RingRejection }>

export const PUBLIC_V39_PROGRESS_KEYS = [...PUBLIC_V38_PROGRESS_KEYS,
  'quarryRingDiscovered', 'ringLinkEstablished', 'ringOutboundCompleted',
  'ringReturnCompleted', 'ringkeeperClaimed'] as const

const REACH = 3
const EPSILON = 1e-6

export function decodePublicV39RingProgress(raw: unknown): PublicV39RingProgress | null {
  try {
    if (!exactPublicV23(raw, PUBLIC_V39_PROGRESS_KEYS)) return null
    const { quarryRingDiscovered, ringLinkEstablished, ringOutboundCompleted,
      ringReturnCompleted, ringkeeperClaimed } = raw
    if ([quarryRingDiscovered, ringLinkEstablished, ringOutboundCompleted,
      ringReturnCompleted, ringkeeperClaimed].some((flag) => typeof flag !== 'boolean')
      || ringLinkEstablished && !quarryRingDiscovered
      || ringOutboundCompleted && !ringLinkEstablished
      || ringReturnCompleted && !ringOutboundCompleted
      || ringkeeperClaimed && !ringReturnCompleted) return null
    const inherited = decodePublicV38Progress(Object.fromEntries(
      PUBLIC_V38_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    return inherited ? { ...inherited, quarryRingDiscovered: quarryRingDiscovered as boolean,
      ringLinkEstablished: ringLinkEstablished as boolean,
      ringOutboundCompleted: ringOutboundCompleted as boolean,
      ringReturnCompleted: ringReturnCompleted as boolean,
      ringkeeperClaimed: ringkeeperClaimed as boolean } : null
  } catch { return null }
}

/** Witnesses carry no position, destination ID, flag or reward supplied by the client. */
export function decodePublicV39RingWitness(raw: unknown): PublicV39RingWitness | null {
  try {
    if (exactPublicV23(raw, ['kind']) && (raw.kind === 'ringkeeper-discover/v1'
      || raw.kind === 'ringkeeper-link/v1' || raw.kind === 'ringkeeper-claim/v1')) {
      structuredClone(raw)
      return { kind: raw.kind }
    }
    if (exactPublicV23(raw, ['kind', 'direction'])
      && raw.kind === 'ringkeeper-travel/v1'
      && (raw.direction === 'greenway-to-highland'
        || raw.direction === 'highland-to-greenway')) {
      structuredClone(raw)
      return { kind: raw.kind, direction: raw.direction }
    }
  } catch { /* Reject proxies and accessor-bearing values. */ }
  return null
}

/** Pure checked transition. The V39 writer replays it against its locked head. */
export function confirmPublicV39RingAction(raw: PublicV39RingProgress,
  rawWitness: unknown): PublicV39RingResult {
  const reject = (rejection: PublicV39RingRejection): PublicV39RingResult => ({ rejection })
  const witness = decodePublicV39RingWitness(rawWitness)
  if (!witness) return reject('invalid_value')
  let progress: PublicV39RingProgress | null
  try { progress = decodePublicV39RingProgress(Object.fromEntries(
    PUBLIC_V39_PROGRESS_KEYS.map((key) => [key, raw[key]]))) }
  catch { return reject('invalid_progress') }
  if (!progress) return reject('invalid_progress')
  return confirmDecodedRingAction(progress, witness)
}

function confirmDecodedRingAction(progress: PublicV39RingProgress,
  witness: PublicV39RingWitness): PublicV39RingResult {
  const reject = (rejection: PublicV39RingRejection): PublicV39RingResult => ({ rejection })
  try {
    const { state } = progress, { player } = state
    const greenway = state.greenway.fairyRings.find(({ id }) => id === 'ring-greenway')
    if (!greenway) return reject('invalid_progress')
    const quarry = highlandQuarryRing(state.seed)
    const greenwayTile = worldTileAtGrid(state.seed,
      Math.ceil(greenway.position.x / WORLD_CELL_METERS - 0.5),
      Math.ceil(greenway.position.z / WORLD_CELL_METERS - 0.5))
    const sourceIsGreenway = witness.kind !== 'ringkeeper-discover/v1'
      && (witness.kind !== 'ringkeeper-travel/v1'
        || witness.direction === 'greenway-to-highland')
    const source = sourceIsGreenway ? greenway.position : quarry.tile.center
    const sourceTile = sourceIsGreenway ? greenwayTile : quarry.tile
    const owner = sourceIsGreenway ? 'greenway' : 'streamed'
    if (state.movementOwner !== owner) return reject('wrong_region')
    const pose = projectPublicV31Pose(progress)
    if (!pose || player.verticalVelocity !== 0
      || pose.support !== 'ground' && pose.support !== 'terrain'
      || Math.abs(pose.effective.position.y - pose.effective.floorY) > EPSILON)
      return reject('not_grounded')
    if (publicV25RiverCellAtGrid(state.seed, pose.cell.gx, pose.cell.gz)
      || publicV26TerrainCellIsWet(state.seed, pose.cell.gx, pose.cell.gz, owner)
      || progress.terrain.columns.some(({ gx, gz, openDepth }) =>
        gx === pose.cell.gx && gz === pose.cell.gz && openDepth > 0)
      || publicV31HasRaisedSoilCell(progress.raisedSoilCells, pose.cell.gx, pose.cell.gz)
      || sourceTile.terrain === 'wetland') return reject('unsafe_source')
    if (!discoveryMaskHasTileId(state.discoveryMask, sourceTile.id)) return reject('unrevealed')
    if (Math.hypot(pose.effective.position.x - source.x,
      pose.effective.position.y - source.y,
      pose.effective.position.z - source.z) > REACH) return reject('too_far')
    if (!Number.isSafeInteger(state.eventSequence + 1)) return reject('invalid_value')

    if (witness.kind === 'ringkeeper-discover/v1') {
      if (progress.quarryRingDiscovered) return reject('already_discovered')
      const next: PublicV39RingProgress = { ...progress, quarryRingDiscovered: true,
        state: { ...state, eventSequence: state.eventSequence + 1 } }
      return decodePublicV39RingProgress(next) ? { progress: next } : reject('invalid_value')
    }
    if (!progress.quarryRingDiscovered
      || !player.discoveredRingIds.includes('ring-greenway')) return reject('undiscovered')

    if (witness.kind === 'ringkeeper-link/v1') {
      if (progress.ringLinkEstablished) return reject('already_linked')
      const next: PublicV39RingProgress = { ...progress, ringLinkEstablished: true,
        state: { ...state, eventSequence: state.eventSequence + 1 } }
      return decodePublicV39RingProgress(next) ? { progress: next } : reject('invalid_value')
    }
    if (!progress.ringLinkEstablished) return reject('requires_link')

    if (witness.kind === 'ringkeeper-claim/v1') {
      if (progress.ringkeeperClaimed) return reject('already_claimed')
      if (!progress.ringReturnCompleted) return reject('requires_return')
      const coins = player.coins + 25, wayfinding = player.skillXp.wayfinding + 30
      const spellcraft = player.skillXp.spellcraft + 20, xp = player.xp + 35
      if (![coins, wayfinding, spellcraft, xp].every(Number.isSafeInteger))
        return reject('invalid_value')
      const next: PublicV39RingProgress = { ...progress, ringkeeperClaimed: true,
        state: { ...state, eventSequence: state.eventSequence + 1,
          player: { ...player, coins, xp, level: 1 + Math.floor(xp / 100),
            skillXp: { ...player.skillXp, wayfinding, spellcraft } } } }
      return decodePublicV39RingProgress(next) ? { progress: next } : reject('invalid_value')
    }

    if (witness.direction === 'highland-to-greenway' && !progress.ringOutboundCompleted)
      return reject('requires_outbound')
    if (!discoveryMaskHasTileId(state.discoveryMask, greenwayTile.id)
      || !discoveryMaskHasTileId(state.discoveryMask, quarry.tile.id)) return reject('unrevealed')
    if (!Number.isSafeInteger(state.tick + 1)) return reject('invalid_value')
    const targetIsGreenway = witness.direction === 'highland-to-greenway'
    const target = targetIsGreenway ? greenway.position : quarry.tile.center
    const targetTile = targetIsGreenway ? greenwayTile : quarry.tile
    const floor = targetIsGreenway
      ? publicV17StarterSupportAt({ seed: state.seed, profile: state.generationProfile,
        route: state.greenway.routes.find(({ id }) => id === 'greenway_ladder') ?? null,
        built: state.greenway.builtRouteIds.includes('greenway_ladder'),
        greenwayWorks: progress.greenwayWorks }, target)
      : resolvePublicV23Surface(state, target, progress.regionalWorks.builtLadderIds)
    if (!floor) return reject('unsafe_arrival')
    const next: PublicV39RingProgress = { ...progress,
      ringOutboundCompleted: progress.ringOutboundCompleted || !targetIsGreenway,
      ringReturnCompleted: progress.ringReturnCompleted || targetIsGreenway,
      state: { ...state, tick: state.tick + 1, eventSequence: state.eventSequence + 1,
        movementOwner: targetIsGreenway ? 'greenway' : 'streamed',
        player: { ...player, position: { x: target.x, y: floor.floorY, z: target.z },
          verticalVelocity: 0 } } }
    const arrival = projectPublicV31Pose(next)
    if (!arrival || arrival.support !== 'ground' && arrival.support !== 'terrain'
      || Math.abs(arrival.effective.position.y - arrival.effective.floorY) > EPSILON
      || targetTile.terrain === 'wetland'
      || publicV25RiverCellAtGrid(state.seed, arrival.cell.gx, arrival.cell.gz)
      || publicV26TerrainCellIsWet(state.seed, arrival.cell.gx, arrival.cell.gz,
        next.state.movementOwner)
      || progress.terrain.columns.some(({ gx, gz, openDepth }) =>
        gx === arrival.cell.gx && gz === arrival.cell.gz && openDepth > 0)
      || publicV31HasRaisedSoilCell(progress.raisedSoilCells,
        arrival.cell.gx, arrival.cell.gz)) return reject('unsafe_arrival')
    return decodePublicV39RingProgress(next) ? { progress: next } : reject('unsafe_arrival')
  } catch { return reject('invalid_progress') }
}

/** Advisory only. The V39 writer checks again against its own locked head. */
export function previewPublicV39RingAction(progress: PublicV39RingProgress,
  witness: unknown): Readonly<{ rejection: PublicV39RingRejection | null }> {
  return { rejection: confirmPublicV39RingAction(progress, witness).rejection ?? null }
}

/** Read-only view batch: validate the checked progress once for independent actions. */
export function previewPublicV39RingActions(progress: PublicV39RingProgress,
  kinds: readonly ('ringkeeper-discover/v1' | 'ringkeeper-link/v1' | 'ringkeeper-claim/v1')[]):
  readonly Readonly<{ rejection: PublicV39RingRejection | null }>[] {
  const witnesses = kinds.map((kind) => decodePublicV39RingWitness({ kind }))
  let decoded: PublicV39RingProgress | null
  try { decoded = decodePublicV39RingProgress(Object.fromEntries(
    PUBLIC_V39_PROGRESS_KEYS.map((key) => [key, progress[key]]))) }
  catch { decoded = null }
  return witnesses.map((witness) => ({ rejection: !witness ? 'invalid_value' : decoded
    ? confirmDecodedRingAction(decoded, witness).rejection ?? null : 'invalid_progress' }))
}
