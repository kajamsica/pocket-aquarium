import { discoveryMaskHasTileId } from './discoveryMask'
import { highlandLandmark } from './highlandContent'
import { highlandWindCastWindow, highlandWindTrailLocation } from './highlandWindContent'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { resolvePublicV28RiverBridge } from './publicWorldV28RiverBridgeSites'
import { decodePublicV31ActionProgress } from './publicWorldV31Soil'
import { projectPublicV31Pose } from './publicWorldV31Support'
import type { PublicV36MarkerProgress } from './publicWorldV36MarkerAction'

export type PublicV37WindwardWitness = Readonly<{
  kind: 'windward-study/v1' | 'windward-cast/v1'
}>
export type PublicV37WindwardRejection = 'invalid_value' | 'invalid_progress'
  | 'unavailable_here' | 'not_grounded' | 'undiscovered' | 'unrevealed'
  | 'too_far' | 'already_learned' | 'not_learned' | 'not_on_trail' | 'cooldown'
export type PublicV37WindwardResult = Readonly<{
  progress: PublicV36MarkerProgress; rejection?: never
}> | Readonly<{ progress?: never; rejection: PublicV37WindwardRejection }>

export const PUBLIC_V37_PROGRESS_KEYS = ['state', 'greenwayWorks', 'regionalWorks',
  'terrain', 'nextHomeAtMs', 'riverBridgeIds', 'miningTools', 'claimedBridgeheadId',
  'raisedSoilCells', 'ledgerSurveyBridgeId', 'ledgerClaimReward', 'markerClaimReward'] as const
const baseKeys = PUBLIC_V37_PROGRESS_KEYS.slice(0, 9)

/** Same inherited progress contract as V36, with no second spell ledger. */
export function decodePublicV37WindwardProgress(raw: unknown): PublicV36MarkerProgress | null {
  try {
    if (!exactPublicV23(raw, PUBLIC_V37_PROGRESS_KEYS)) return null
    const old = decodePublicV31ActionProgress(Object.fromEntries(baseKeys.map((key) =>
      [key, raw[key]])) as PublicV36MarkerProgress)
    if (!old) return null
    const survey = raw.ledgerSurveyBridgeId, ledger = raw.ledgerClaimReward
    const marker = raw.markerClaimReward
    if (survey !== null && (typeof survey !== 'string'
      || !resolvePublicV28RiverBridge(old.state.seed, survey)
      || !old.riverBridgeIds.includes(survey) || old.claimedBridgeheadId === null)
      || ledger !== null && (survey === null || ledger !== 'traveler_tunic'
        && ledger !== 'coins')
      || marker !== null && (ledger === null || marker !== 'fen_waders'
        && marker !== 'coins')) return null
    return { ...old, ledgerSurveyBridgeId: survey as string | null,
      ledgerClaimReward: ledger as PublicV36MarkerProgress['ledgerClaimReward'],
      markerClaimReward: marker as PublicV36MarkerProgress['markerClaimReward'] }
  } catch { return null }
}

export function decodePublicV37WindwardWitness(raw: unknown): PublicV37WindwardWitness | null {
  try {
    if (!exactPublicV23(raw, ['kind'])
      || raw.kind !== 'windward-study/v1' && raw.kind !== 'windward-cast/v1') return null
    structuredClone(raw)
    return { kind: raw.kind }
  } catch { return null }
}

/** Pure checked action. Target, spell clocks, and learning come only from the writer's head. */
export function confirmPublicV37WindwardAction(raw: PublicV36MarkerProgress,
  rawWitness: unknown): PublicV37WindwardResult {
  const reject = (rejection: PublicV37WindwardRejection): PublicV37WindwardResult => ({ rejection })
  const witness = decodePublicV37WindwardWitness(rawWitness)
  if (!witness) return reject('invalid_value')
  let progress: PublicV36MarkerProgress | null
  try {
    progress = decodePublicV37WindwardProgress(Object.fromEntries(
      PUBLIC_V37_PROGRESS_KEYS.map((key) => [key, raw[key]])))
  } catch { return reject('invalid_progress') }
  if (!progress) return reject('invalid_progress')
  try {
    const { state } = progress, { player, windstep } = state
    if (state.movementOwner !== 'streamed') return reject('unavailable_here')
    const pose = projectPublicV31Pose(progress)
    if (!pose || player.verticalVelocity !== 0
      || pose.support !== 'terrain' && pose.support !== 'ground'
      || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6)
      return reject('not_grounded')
    if (!Number.isSafeInteger(state.eventSequence + 1)) return reject('invalid_value')
    let nextWindstep: typeof windstep
    if (witness.kind === 'windward-study/v1') {
      if (windstep.learned) return reject('already_learned')
      if (!state.highland.landmarkDiscovered) return reject('undiscovered')
      const glyph = highlandLandmark(state.seed)
      if (!discoveryMaskHasTileId(state.discoveryMask, glyph.tile.id)) return reject('unrevealed')
      if (Math.hypot(pose.effective.position.x - glyph.tile.center.x,
        pose.effective.position.y - glyph.tile.center.y,
        pose.effective.position.z - glyph.tile.center.z) > 3) return reject('too_far')
      nextWindstep = { ...windstep, learned: true }
    } else {
      if (!windstep.learned) return reject('not_learned')
      if (!highlandWindTrailLocation(pose.effective.position)
        || publicV26TerrainCellIsWet(state.seed, pose.cell.gx, pose.cell.gz,
          state.movementOwner)) return reject('not_on_trail')
      if (!discoveryMaskHasTileId(state.discoveryMask,
        `tile-${pose.cell.gx + 3}-${pose.cell.gz + 3}`)) return reject('unrevealed')
      if (state.tick < windstep.nextCastTick) return reject('cooldown')
      const window = highlandWindCastWindow(state.tick)
      if (!window) return reject('invalid_value')
      nextWindstep = { ...windstep, activeUntilTick: window.activeUntilTick,
        nextCastTick: window.readyAtTick }
    }
    const next: PublicV36MarkerProgress = { ...progress, state: { ...state,
      eventSequence: state.eventSequence + 1, windstep: nextWindstep } }
    return decodePublicV37WindwardProgress(next)
      ? { progress: next } : reject('invalid_value')
  } catch { return reject('invalid_progress') }
}

/** Advisory only. Commit reruns this action against the locked checked head. */
export function previewPublicV37WindwardAction(progress: PublicV36MarkerProgress,
  witness: unknown): Readonly<{ rejection: PublicV37WindwardRejection | null }> {
  return { rejection: confirmPublicV37WindwardAction(progress, witness).rejection ?? null }
}
