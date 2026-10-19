import { discoveryMaskHasTileId } from './discoveryMask'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { publicV26TerrainCellIsWet } from './publicWorldV26TerrainSurface'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { decodePublicV43FamiliarProgress, PUBLIC_V43_PROGRESS_KEYS } from './publicWorldV43FamiliarAction'
import type { PublicV43FamiliarProgress, PublicV43FamiliarRejection } from './publicWorldV43FamiliarAction'
import { publicV43FamiliarTouchesForbiddenSupport } from './publicWorldV43FamiliarFollower'
import { resolveSedgehornFamiliarSite } from './sedgehornFamiliarContent'

export type PublicV43MountCareEvent = Readonly<{
  kind: 'sedgehorn-care/v1'
  tick: number
  eventSequence: number
}>
export type PublicV43MountTraining = Readonly<{
  careWitnesses: readonly PublicV43MountCareEvent[]
}>
export type PublicV43MountTrainingView = Readonly<{
  careCount: number
  careXp: number
  lastCareTick: number | null
  mature: boolean
}>
export type PublicV43MountTrainingProgress = PublicV43FamiliarProgress & Readonly<{
  mountTraining: PublicV43MountTraining
}>
export type PublicV43MountTrainingWitness = Readonly<{ kind: 'sedgehorn-care/v1' }>
export type PublicV43MountTrainingRejection = PublicV43FamiliarRejection
  | 'not_claimed' | 'too_soon' | 'already_mature'
export type PublicV43MountTrainingResult = Readonly<{
  progress: PublicV43MountTrainingProgress; rejection?: never }>
  | Readonly<{ progress?: never; rejection: PublicV43MountTrainingRejection }>

export const SEDGEHORN_CARES_TO_MATURE = 3
export const SEDGEHORN_CARE_INTERVAL_TICKS = 600
const CARE_XP = 5
const TRAINING_KEYS = ['careWitnesses'] as const
const CARE_EVENT_KEYS = ['kind', 'tick', 'eventSequence'] as const
const safeCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const familiarOnly = (raw: Record<string, unknown>) =>
  Object.fromEntries(PUBLIC_V43_PROGRESS_KEYS.map((key) => [key, raw[key]]))
const viewOf = (careWitnesses: readonly PublicV43MountCareEvent[]):
  PublicV43MountTrainingView => ({
  careCount: careWitnesses.length,
  careXp: careWitnesses.length * CARE_XP,
  lastCareTick: careWitnesses.at(-1)?.tick ?? null,
  mature: careWitnesses.length === SEDGEHORN_CARES_TO_MATURE,
})

/** A distinct overlay; V43 familiar trust, V42 skills and player XP are untouched. */
export function createPublicV43MountTraining(source: PublicV43FamiliarProgress):
  PublicV43MountTrainingProgress | null {
  const parent = decodePublicV43FamiliarProgress(familiarOnly(source))
  return parent ? { ...parent, mountTraining: { careWitnesses: [] } } : null
}

/** Structural proof. The V43 checked writer replays every new care edge. */
export function decodePublicV43MountTrainingProgress(raw: unknown):
  PublicV43MountTrainingProgress | null {
  try {
    if (!exactPublicV23(raw, [...PUBLIC_V43_PROGRESS_KEYS, 'mountTraining'])
      || !exactPublicV23(raw.mountTraining, TRAINING_KEYS)) return null
    const parent = decodePublicV43FamiliarProgress(familiarOnly(raw))
    const careWitnesses = raw.mountTraining.careWitnesses
    if (!parent || !Array.isArray(careWitnesses)
      || careWitnesses.length > SEDGEHORN_CARES_TO_MATURE
      || careWitnesses.length > 0 && parent.familiar.phase !== 'claimed') return null
    let lastTick = -1, lastSequence = -1
    const checked: PublicV43MountCareEvent[] = []
    for (const rawEvent of careWitnesses) {
      if (!exactPublicV23(rawEvent, CARE_EVENT_KEYS)
        || rawEvent.kind !== 'sedgehorn-care/v1'
        || !safeCount(rawEvent.tick) || rawEvent.tick > parent.state.tick
        || !safeCount(rawEvent.eventSequence) || rawEvent.eventSequence === 0
        || rawEvent.eventSequence > parent.state.eventSequence
        || rawEvent.eventSequence <= lastSequence
        || lastTick >= 0 && rawEvent.tick - lastTick < SEDGEHORN_CARE_INTERVAL_TICKS)
        return null
      checked.push({ kind: 'sedgehorn-care/v1', tick: rawEvent.tick,
        eventSequence: rawEvent.eventSequence })
      lastTick = rawEvent.tick
      lastSequence = rawEvent.eventSequence
    }
    return { ...parent, mountTraining: { careWitnesses: checked } }
  } catch { return null }
}

/** Derived display values. No aggregate is accepted from a saved overlay. */
export function projectPublicV43MountTraining(raw: unknown):
  PublicV43MountTrainingView | null {
  try {
    if (raw === null || typeof raw !== 'object') return null
    const source = raw as Record<string, unknown>
    const progress = decodePublicV43MountTrainingProgress({
      ...familiarOnly(source), mountTraining: source.mountTraining })
    return progress ? viewOf(progress.mountTraining.careWitnesses) : null
  } catch { return null }
}

export function decodePublicV43MountTrainingWitness(raw: unknown):
  PublicV43MountTrainingWitness | null {
  try {
    if (!exactPublicV23(raw, ['kind'])
      || raw.kind !== 'sedgehorn-care/v1') return null
    structuredClone(raw)
    return { kind: 'sedgehorn-care/v1' }
  } catch { return null }
}

/** A pure request transition. The client supplies only intent; the adult-ready
 * sedgehorn stays unrideable until UI integration exists. */
export function confirmPublicV43MountTraining(raw: PublicV43MountTrainingProgress,
  rawWitness: unknown): PublicV43MountTrainingResult {
  const reject = (rejection: PublicV43MountTrainingRejection):
    PublicV43MountTrainingResult => ({ rejection })
  if (!decodePublicV43MountTrainingWitness(rawWitness)) return reject('invalid_value')
  const progress = decodePublicV43MountTrainingProgress(raw)
  if (!progress) return reject('invalid_progress')
  const { state, familiar, mountTraining: training } = progress
  const site = resolveSedgehornFamiliarSite(progress)
  if (!site || !safeCount(state.eventSequence + 1)) return reject('invalid_progress')
  if (familiar.phase !== 'claimed') return reject('not_claimed')
  if (training.careWitnesses.length === SEDGEHORN_CARES_TO_MATURE)
    return reject('already_mature')
  if (!progress.southbankReached) return reject('requires_crossing')
  if (state.movementOwner !== 'streamed') return reject('wrong_region')
  const pose = projectPublicV31Pose(progress)
  if (!pose || state.player.verticalVelocity !== 0 || pose.support !== 'terrain'
    || Math.abs(pose.effective.position.y - pose.effective.floorY) > 1e-6)
    return reject('not_grounded')
  const at = pose.effective.position
  if (publicV26TerrainCellIsWet(state.seed, pose.cell.gx, pose.cell.gz, 'streamed')
    || publicV43FamiliarTouchesForbiddenSupport(state.seed, at, at,
      progress.terrain.columns, progress.raisedSoilCells)) return reject('unsafe_source')
  if (!discoveryMaskHasTileId(state.discoveryMask, site.careStation.id))
    return reject('unrevealed')
  if (Math.hypot(at.x - site.careStation.center.x, at.y - site.careStation.center.y,
    at.z - site.careStation.center.z) > 3) return reject('too_far')
  const lastCareTick = training.careWitnesses.at(-1)?.tick
  if (lastCareTick !== undefined
    && state.tick - lastCareTick < SEDGEHORN_CARE_INTERVAL_TICKS)
    return reject('too_soon')
  const herb = state.player.inventory.findIndex(({ itemId, quantity }) =>
    itemId === 'marsh_herb' && quantity > 0)
  if (herb < 0) return reject('not_owned')
  const inventory = state.player.inventory.flatMap((stack, index) =>
    index !== herb ? [stack] : stack.quantity === 1 ? []
      : [{ ...stack, quantity: stack.quantity - 1 }])
  const careEvent: PublicV43MountCareEvent = { kind: 'sedgehorn-care/v1',
    tick: state.tick, eventSequence: state.eventSequence + 1 }
  const next: PublicV43MountTrainingProgress = { ...progress,
    mountTraining: { careWitnesses: [...training.careWitnesses, careEvent] },
    state: { ...state, eventSequence: state.eventSequence + 1,
      player: { ...state.player, inventory } } }
  return decodePublicV43MountTrainingProgress(next) ? { progress: next }
    : reject('invalid_value')
}
