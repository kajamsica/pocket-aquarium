import { discoveryMaskHasTileId } from './discoveryMask'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { publicV11Gait } from './publicWorldGait'
import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV26ValleyRimPassage } from './publicWorldV26ValleyRim'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { replayPublicV31FramesWithEvents } from './publicWorldV31Movement'
import type { PublicV31Progress } from './publicWorldV31Migration'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { publicV32Monotonic, publicV32Preserves } from './publicWorldV32Snapshot'
import { PUBLIC_V43_PROGRESS_KEYS } from './publicWorldV43FamiliarAction'
import { publicV43FamiliarTouchesForbiddenSupport,
  publicV43FamiliarTouchesUnrevealedCell } from './publicWorldV43FamiliarFollower'
import { projectPublicV43MountTraining } from './publicWorldV43MountTraining'
import { decodePublicV43Progress, decodePublicV43Witness,
  replayPublicV43Witness } from './publicWorldV43Snapshot'
import type { PublicV43Progress } from './publicWorldV43Snapshot'
import type { PublicV44GroundMountState } from './publicWorldV44GroundMount'
import { publicV45AssistedPathSupported } from './publicWorldV45AssistedPath'
import { createPublicV45DryRideAdmission } from './publicWorldV45DryRideAdmission'
import { confirmPublicV45HerbSale, type PublicV45HerbSaleRejection }
  from './publicWorldV45HerbSale'
import { confirmPublicV45MountTransition, type PublicV45MountRejection }
  from './publicWorldV45MountTransition'
import { confirmPublicV45TackPurchase, type PublicV45TackPurchaseRejection }
  from './publicWorldV45TackPurchase'
import type { PublicV23Progress } from './publicWorldV23Snapshot'
import type { PublicWorldEvent } from './publicWorldRuntime'
import type { Vec3 } from './types'

export type PublicV45Progress = PublicV43Progress & Readonly<{
  groundMount: PublicV44GroundMountState
  tack: 'not_owned' | 'legacy' | 'purchased'
}>
export type PublicV45RideWitness = Readonly<{
  kind: 'sedgehorn-assisted-ride-frame/v1'
  intents: readonly [{ type: 'move'; delta: Readonly<{ x: number; z: number }> }]
    | readonly [{ type: 'look'; yawDelta: number; pitchDelta: number },
      { type: 'move'; delta: Readonly<{ x: number; z: number }> }]
}>
export type PublicV45RideRejection = 'invalid_progress' | 'invalid_witness'
  | 'not_eligible' | 'competing_mode' | 'unsafe_mount' | 'ride_blocked'
export type PublicV45RideResult = Readonly<{
  progress: PublicV45Progress; events: readonly PublicWorldEvent[]; rejection?: never
}> | Readonly<{ progress?: never; events?: never; rejection: PublicV45RideRejection }>
export type PublicV45ActionResult = PublicV45RideResult | Readonly<{
  progress?: never; events?: never; rejection: PublicV45MountRejection
    | PublicV45TackPurchaseRejection | PublicV45HerbSaleRejection }>

const EPSILON = 1e-6
const MAX_GRADE = 0.55
const V31_KEYS = ['state', 'greenwayWorks', 'regionalWorks', 'terrain',
  'nextHomeAtMs', 'riverBridgeIds', 'miningTools', 'claimedBridgeheadId',
  'raisedSoilCells'] as const

function decodeProgress(raw: unknown): PublicV45Progress | null {
  try {
    if (!raw || typeof raw !== 'object') return null
    const optional = ['mountTraining', 'greenwayOrder', 'greenwayBagUpgrade']
      .filter((key) => Object.hasOwn(raw, key))
    if (!exactPublicV23(raw, [...PUBLIC_V43_PROGRESS_KEYS, ...optional,
      'groundMount', 'tack'])) return null
    const progress = decodePublicV43Progress(Object.fromEntries(
      [...PUBLIC_V43_PROGRESS_KEYS, ...optional].map((key) => [key, raw[key]])))
    const mount = raw.groundMount
    if (!progress || !exactPublicV23(mount, ['mode', 'parkedPosition'])
      || mount.mode !== 'parked' && mount.mode !== 'riding'
      || mount.parkedPosition !== null && (!exactPublicV23(mount.parkedPosition,
        ['x', 'y', 'z']) || ![mount.parkedPosition.x, mount.parkedPosition.y,
        mount.parkedPosition.z].every(Number.isFinite))
      || raw.tack !== 'legacy' && raw.tack !== 'not_owned'
        && raw.tack !== 'purchased') return null
    return { ...progress, groundMount: structuredClone(mount) as PublicV44GroundMountState,
      tack: raw.tack as PublicV45Progress['tack'] }
  } catch { return null }
}

function safePose(progress: PublicV31Progress, point: Vec3): boolean {
  if (progress.state.movementOwner !== 'streamed'
    || progress.state.player.verticalVelocity !== 0) return false
  const pose = projectPublicV31Pose(progress, point)
  const floor = resolvePublicV23Surface(progress.state, point,
    progress.regionalWorks.builtLadderIds)
  return !!pose && pose.support === 'terrain' && !!floor
    && Math.abs(point.y - pose.effective.floorY) <= EPSILON
    && discoveryMaskHasTileId(progress.state.discoveryMask, floor.tileId)
    && !publicV43FamiliarTouchesForbiddenSupport(progress.state.seed, point, point,
      progress.terrain.columns, progress.raisedSoilCells)
}
export { safePose as publicV45SafePose }

function dryLeg(progress: PublicV31Progress, from: Vec3, to: Vec3): boolean {
  return !publicV43FamiliarTouchesUnrevealedCell(progress.state.discoveryMask, from, to)
    && !publicV43FamiliarTouchesForbiddenSupport(progress.state.seed, from, to,
      progress.terrain.columns, progress.raisedSoilCells)
    && mireglassMoveBarrier(progress.state.seed, from, to) === null
    && publicV26ValleyRimPassage(progress.state.seed, from, to, []).ok
}

/** One checked V45 action. Neither the witness nor a UI preview can supply an admission. */
export function confirmPublicV45RideFrame(rawBefore: PublicV45Progress,
  rawWitness: unknown): PublicV45RideResult {
  const reject = (rejection: PublicV45RideRejection): PublicV45RideResult => ({ rejection })
  try {
    const before = decodeProgress(rawBefore)
    if (!before) return reject('invalid_progress')
    if (!exactPublicV23(rawWitness, ['kind', 'intents'])
      || rawWitness.kind !== 'sedgehorn-assisted-ride-frame/v1') return reject('invalid_witness')
    structuredClone(rawWitness)
    const frame = decodePublicV14FrameWitness({ kind: 'frame-batch/v1',
      frames: [{ intents: rawWitness.intents, walkRequested: false }] })?.frames[0]
    const move = frame?.intents.at(-1)
    if (!frame || move?.type !== 'move' || frame.intents.length < 1
      || frame.intents.some((intent) => intent.type === 'jump')) return reject('invalid_witness')
    const length = Math.hypot(move.delta.x, move.delta.z)
    if (!(length > 0)) return reject('invalid_witness')
    if (before.familiar.phase !== 'claimed'
      || projectPublicV43MountTraining(before)?.mature !== true
      || before.tack === 'not_owned' || before.groundMount.mode !== 'riding')
      return reject('not_eligible')
    if (before.ironHall.engaged || before.ironHallReward.spar.active
      || before.state.tick < before.state.windstep.activeUntilTick)
      return reject('competing_mode')
    if (length > publicV11Gait(before.state.player.equipment.feet, false).metersPerStep + 1e-9)
      return reject('invalid_witness')
    const start = before.state.player.position
    if (!safePose(before, start)) return reject('unsafe_mount')
    const first = { x: move.delta.x * 5 / 6, z: move.delta.z * 5 / 6 }
    const assisted = { substeps: [first, first] as const,
      settle: (after: PublicV23Progress) => after }
    const middle = { x: start.x + first.x, y: start.y, z: start.z + first.z }
    const target = { x: middle.x + first.x, y: start.y, z: middle.z + first.z }
    if (!dryLeg(before, start, middle) || !dryLeg(before, middle, target))
      return reject('ride_blocked')
    const admission = createPublicV45DryRideAdmission(start, middle, target)
    if (!admission) return reject('ride_blocked')
    const checked = replayPublicV31FramesWithEvents(before, [frame], false,
      () => assisted, admission)
    if (!checked || !publicV45AssistedPathSupported(before, checked, assisted))
      return reject('ride_blocked')
    const moves = checked.events.filter((event) => event.type === 'player_moved')
    const arrival = checked.progress.state.player.position
    if (!safePose(checked.progress, arrival)
      || Math.abs(arrival.y - start.y) > MAX_GRADE + EPSILON
      || !dryLeg(before, start, moves[0].position)
      || !dryLeg(before, moves[0].position, arrival)
      || !dryLeg(before, start, arrival)) return reject('ride_blocked')
    const nextBase = Object.fromEntries(V31_KEYS.map((key) =>
      [key, checked.progress[key]])) as Pick<PublicV43Progress, typeof V31_KEYS[number]>
    const next = decodeProgress({ ...before, ...nextBase })
    if (!next || !publicV32Preserves(before, next, before.state.seed)
      || !publicV32Monotonic(before, next)) return reject('ride_blocked')
    return { progress: next, events: checked.events }
  } catch { return reject('ride_blocked') }
}

/** Ordinary V43 replay remains available only while the imported mount is parked. */
export function confirmPublicV45Action(rawBefore: PublicV45Progress,
  rawWitness: unknown): PublicV45ActionResult {
  try {
    const kind = rawWitness && typeof rawWitness === 'object'
      && 'kind' in rawWitness ? rawWitness.kind : null
    if (kind === 'sedgehorn-assisted-ride-frame/v1')
      return confirmPublicV45RideFrame(rawBefore, rawWitness)
    const before = decodeProgress(rawBefore)
    if (!before) return { rejection: 'invalid_progress' }
    if (kind === 'sedgehorn-mount/v1' || kind === 'sedgehorn-dismount/v1') {
      if (!exactPublicV23(rawWitness, ['kind'])) return { rejection: 'invalid_witness' }
      const result = confirmPublicV45MountTransition(before, rawWitness)
      return result.progress ? { progress: result.progress, events: [] }
        : { rejection: result.rejection }
    }
    if (kind === 'buy-sedgehorn-tack/v1') {
      if (!exactPublicV23(rawWitness, ['kind'])) return { rejection: 'invalid_witness' }
      const result = confirmPublicV45TackPurchase(before)
      return result.progress ? { progress: result.progress, events: [] }
        : { rejection: result.rejection }
    }
    if (kind === 'sell-marsh-herb/v1') {
      if (!exactPublicV23(rawWitness, ['kind', 'quantity']))
        return { rejection: 'invalid_witness' }
      if (typeof rawWitness.quantity !== 'number')
        return { rejection: 'invalid_quantity' }
      const result = confirmPublicV45HerbSale(before, rawWitness.quantity)
      return result.progress ? { progress: result.progress, events: [] }
        : { rejection: result.rejection }
    }
    const witness = decodePublicV43Witness(rawWitness)
    if (!witness) return { rejection: 'invalid_witness' }
    if (before.groundMount.mode !== 'parked') return { rejection: 'not_eligible' }
    const after = replayPublicV43Witness(before, witness)
    const progress = after && decodeProgress({ ...after,
      groundMount: before.groundMount, tack: before.tack })
    return progress ? { progress, events: [] } : { rejection: 'ride_blocked' }
  } catch { return { rejection: 'ride_blocked' } }
}
