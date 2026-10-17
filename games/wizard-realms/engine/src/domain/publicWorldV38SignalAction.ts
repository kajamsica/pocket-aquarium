import { discoveryMaskHasTileId } from './discoveryMask'
import { highlandLandmark } from './highlandContent'
import { highlandSignalVane } from './highlandSignalContent'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { projectPublicV31Pose } from './publicWorldV31Support'
import type { PublicV36MarkerProgress } from './publicWorldV36MarkerAction'
import { decodePublicV37WindwardProgress, PUBLIC_V37_PROGRESS_KEYS } from './publicWorldV37WindwardAction'

export type PublicV38SignalProgress = PublicV36MarkerProgress & Readonly<{
  signalVantageInspected: boolean
  signalClaimed: boolean
}>
export type PublicV38SignalWitness = Readonly<{
  kind: 'signal-vantage/v1' | 'signal-claim/v1'
}>
export type PublicV38SignalRejection = 'invalid_value' | 'invalid_progress'
  | 'unavailable_here' | 'not_grounded' | 'undiscovered' | 'unrevealed'
  | 'too_far' | 'not_learned' | 'not_active' | 'not_practiced'
  | 'already_inspected' | 'requires_vantage' | 'already_claimed'
export type PublicV38SignalResult = Readonly<{
  progress: PublicV38SignalProgress; rejection?: never
}> | Readonly<{ progress?: never; rejection: PublicV38SignalRejection }>

export const PUBLIC_V38_PROGRESS_KEYS = [...PUBLIC_V37_PROGRESS_KEYS,
  'signalVantageInspected', 'signalClaimed'] as const

/** The witness is only a kind. Coordinates, flags, and payout remain writer-owned. */
export function decodePublicV38SignalWitness(raw: unknown): PublicV38SignalWitness | null {
  try {
    if (!exactPublicV23(raw, ['kind'])
      || raw.kind !== 'signal-vantage/v1' && raw.kind !== 'signal-claim/v1') return null
    structuredClone(raw)
    return { kind: raw.kind }
  } catch { return null }
}

function checkedProgress(raw: PublicV38SignalProgress): PublicV38SignalProgress | null {
  try {
    if (typeof raw.signalVantageInspected !== 'boolean'
      || typeof raw.signalClaimed !== 'boolean'
      || raw.signalClaimed && !raw.signalVantageInspected) return null
    const base = decodePublicV37WindwardProgress(Object.fromEntries(
      PUBLIC_V37_PROGRESS_KEYS.map((key) => [key, raw[key]])))
    return base ? { ...base, signalVantageInspected: raw.signalVantageInspected,
      signalClaimed: raw.signalClaimed } : null
  } catch { return null }
}

/** Pure transition. The locked V38 writer must replay it against its checked head. */
export function confirmPublicV38SignalAction(raw: PublicV38SignalProgress,
  rawWitness: unknown): PublicV38SignalResult {
  const witness = decodePublicV38SignalWitness(rawWitness)
  if (!witness) return { rejection: 'invalid_value' }
  const progress = checkedProgress(raw)
  if (!progress) return { rejection: 'invalid_progress' }
  return confirmCheckedSignalAction(progress, witness)
}

function confirmCheckedSignalAction(progress: PublicV38SignalProgress,
  witness: PublicV38SignalWitness): PublicV38SignalResult {
  const reject = (rejection: PublicV38SignalRejection): PublicV38SignalResult => ({ rejection })
  try {
    const { state } = progress, { player, windstep } = state
    if (state.movementOwner !== 'streamed') return reject('unavailable_here')
    const pose = projectPublicV31Pose(progress)
    if (!pose || player.verticalVelocity !== 0 || pose.support !== 'terrain'
      || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6)
      return reject('not_grounded')
    if (!Number.isSafeInteger(state.eventSequence + 1)) return reject('invalid_value')
    if (witness.kind === 'signal-vantage/v1') {
      if (progress.signalVantageInspected) return reject('already_inspected')
      if (!state.highland.landmarkDiscovered) return reject('undiscovered')
      const vane = highlandSignalVane(state.seed)
      if (!discoveryMaskHasTileId(state.discoveryMask, vane.tile.id)) return reject('unrevealed')
      if (Math.hypot(pose.effective.position.x - vane.tile.center.x,
        pose.effective.position.y - vane.tile.center.y,
        pose.effective.position.z - vane.tile.center.z) > 3) return reject('too_far')
      if (vane.tile.terrain === 'wetland' || publicV26TerrainCellIsWet(state.seed,
        pose.cell.gx, pose.cell.gz, state.movementOwner)) return reject('unavailable_here')
      if (!windstep.learned) return reject('not_learned')
      if (state.tick >= windstep.activeUntilTick) return reject('not_active')
      // Westbound credited crossings in the final dry approach, not client-reported motion.
      if (!windstep.practicedRouteIndices.some((index) =>
        index >= vane.routeIndex - 3 && index <= vane.routeIndex + 1)) return reject('not_practiced')
      const next: PublicV38SignalProgress = { ...progress, signalVantageInspected: true,
        state: { ...state, eventSequence: state.eventSequence + 1 } }
      return checkedProgress(next) ? { progress: next } : reject('invalid_value')
    }
    if (progress.signalClaimed) return reject('already_claimed')
    if (!progress.signalVantageInspected) return reject('requires_vantage')
    const crown = highlandLandmark(state.seed)
    if (!discoveryMaskHasTileId(state.discoveryMask, crown.tile.id)) return reject('unrevealed')
    if (Math.hypot(pose.effective.position.x - crown.tile.center.x,
      pose.effective.position.y - crown.tile.center.y,
      pose.effective.position.z - crown.tile.center.z) > 3) return reject('too_far')
    const xp = player.xp + 35, spellcraft = player.skillXp.spellcraft + 35
    const coins = player.coins + 30
    if (![xp, spellcraft, coins].every(Number.isSafeInteger)) return reject('invalid_value')
    const next: PublicV38SignalProgress = { ...progress, signalClaimed: true,
      state: { ...state, eventSequence: state.eventSequence + 1,
        player: { ...player, xp, level: 1 + Math.floor(xp / 100), coins,
          skillXp: { ...player.skillXp, spellcraft } } } }
    return checkedProgress(next) ? { progress: next } : reject('invalid_value')
  } catch { return reject('invalid_progress') }
}

/** Advisory only. The locked save action confirms again against its own head. */
export function previewPublicV38SignalAction(progress: PublicV38SignalProgress,
  witness: unknown): Readonly<{ rejection: PublicV38SignalRejection | null }> {
  return { rejection: confirmPublicV38SignalAction(progress, witness).rejection ?? null }
}

/** The V38 view checks its two fixed action previews against one decoded snapshot. */
export function previewPublicV38SignalPair(raw: PublicV38SignalProgress): Readonly<{
  inspect: PublicV38SignalRejection | null
  claim: PublicV38SignalRejection | null
}> {
  const progress = checkedProgress(raw)
  if (!progress) return { inspect: 'invalid_progress', claim: 'invalid_progress' }
  return {
    inspect: confirmCheckedSignalAction(progress, { kind: 'signal-vantage/v1' }).rejection ?? null,
    claim: confirmCheckedSignalAction(progress, { kind: 'signal-claim/v1' }).rejection ?? null,
  }
}
