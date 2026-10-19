import { discoveryMaskHasTileId } from './discoveryMask'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV26ValleyRimPassage } from './publicWorldV26ValleyRim'
import { exactPublicV23 } from './publicWorldV23Snapshot'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { publicV43FamiliarTouchesForbiddenSupport,
  publicV43FamiliarTouchesUnrevealedCell } from './publicWorldV43FamiliarFollower'
import { projectPublicV43MountTraining } from './publicWorldV43MountTraining'
import { decodePublicV43CheckedSuccessor, decodePublicV43Root,
  decodePublicV43Witness, replayPublicV43Witness, PUBLIC_V43_SCHEMA }
  from './publicWorldV43Snapshot'
import type { PublicV43Progress, PublicV43Root, PublicV43Witness }
  from './publicWorldV43Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'
import type { Vec3 } from './types'

export type PublicV44GroundMountState = Readonly<{
  mode: 'parked' | 'riding'
  parkedPosition: Vec3 | null
}>
export type PublicV44GroundMountProgress = Readonly<{
  v43: PublicV43Root
  groundMount: PublicV44GroundMountState
}>
type PublicV44RideFrameWitness = Readonly<{
  kind: 'sedgehorn-ride-frame/v1' | 'sedgehorn-ride-frame/v2'
  intents: readonly PublicV43RideIntent[]
}>
export type PublicV44GroundMountWitness = Readonly<{
  kind: 'sedgehorn-mount/v1'
}> | Readonly<{
  kind: 'sedgehorn-dismount/v1'
}> | Readonly<{
  kind: 'sedgehorn-ride-batch/v1'
  frames: readonly PublicV44RideFrameWitness[]
}> | PublicV44RideFrameWitness
type PublicV43RideIntent = Extract<PublicV43Witness,
  { kind: 'frame-batch/v1' }>['frames'][number]['intents'][number]
export type PublicV44GroundMountRejection = 'invalid_progress' | 'invalid_witness'
  | 'not_mature' | 'already_riding' | 'not_riding' | 'not_grounded'
  | 'wrong_region' | 'too_far' | 'unsafe_mount' | 'ride_blocked'
export type PublicV44GroundMountResult = Readonly<{
  progress: PublicV44GroundMountProgress; rejection?: never
}> | Readonly<{ progress?: never; rejection: PublicV44GroundMountRejection }>

const EPSILON = 1e-6
const MAX_GRADE = 0.55
export const PUBLIC_V44_MAX_RIDE_BATCH = 32
const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** Versioned ride state wraps a checked V43 root. A future V44 writer must
 * durably replay each intent under its own lock and two-head save proof. */
export function createPublicV44GroundMountProgress(source: PublicV43Root):
  PublicV44GroundMountProgress | null {
  const v43 = decodePublicV43Root(source)
  return v43 ? { v43, groundMount: { mode: 'parked', parkedPosition: null } } : null
}

export function decodePublicV44GroundMountProgress(raw: unknown):
  PublicV44GroundMountProgress | null {
  try {
    if (!exactPublicV23(raw, ['v43', 'groundMount'])
      || !exactPublicV23(raw.groundMount, ['mode', 'parkedPosition'])) return null
    const v43 = decodePublicV43Root(raw.v43)
    const mount = raw.groundMount
    const parked = mount.parkedPosition
    if (!v43 || mount.mode !== 'parked' && mount.mode !== 'riding'
      || parked !== null && (!exactPublicV23(parked, ['x', 'y', 'z'])
        || ![parked.x, parked.y, parked.z].every((n) =>
          typeof n === 'number' && Number.isFinite(n)))) return null
    const mature = projectPublicV43MountTraining(v43.head)?.mature === true
    if ((mount.mode === 'riding' || parked !== null)
      && (!mature || v43.head.familiar.phase !== 'claimed')) return null
    if (mount.mode === 'riding' && !safePose(v43.head, v43.head.state.player.position))
      return null
    return { v43, groundMount: { mode: mount.mode,
      parkedPosition: parked === null ? null : { x: parked.x as number,
        y: parked.y as number, z: parked.z as number } } }
  } catch { return null }
}

function safePose(head: PublicV43Progress, point: Vec3): boolean {
  if (head.state.movementOwner !== 'streamed'
    || head.state.player.verticalVelocity !== 0) return false
  const pose = projectPublicV31Pose(head, point)
  const floor = resolvePublicV23Surface(head.state, point,
    head.regionalWorks.builtLadderIds)
  return !!pose && pose.support === 'terrain'
    && !!floor
    && Math.abs(point.y - pose.effective.floorY) <= EPSILON
    && discoveryMaskHasTileId(head.state.discoveryMask, floor.tileId)
    && !publicV43FamiliarTouchesForbiddenSupport(head.state.seed, point, point,
      head.terrain.columns, head.raisedSoilCells)
}

/** Shared terrain and movement admission for both transient UI preview and
 * checked V44 replay. Preview never mints or persists a V44 successor. */
function rideStepRejection(before: PublicV43Progress,
  after: PublicV43Progress, witness: PublicV44RideFrameWitness):
  PublicV44GroundMountRejection | null {
  const position = before.state.player.position
  const arrival = after.state.player.position
  if (!safePose(before, position)) return 'not_grounded'
  if (after.state.seed !== before.state.seed
    || after.state.tick !== before.state.tick + 1
    || !safePose(after, arrival)) return 'ride_blocked'
  const moved = witness.intents.find((intent) => intent.type === 'move')
  const delta = moved?.type === 'move' ? moved.delta : { x: 0, z: 0 }
  return Math.hypot(arrival.x - position.x - delta.x,
    arrival.z - position.z - delta.z) > EPSILON
    || Math.abs(arrival.y - position.y) > MAX_GRADE + EPSILON
    || publicV43FamiliarTouchesUnrevealedCell(before.state.discoveryMask,
      position, arrival)
    || publicV43FamiliarTouchesForbiddenSupport(before.state.seed, position,
      arrival, before.terrain.columns, before.raisedSoilCells)
    || mireglassMoveBarrier(before.state.seed, position, arrival) !== null
    || !publicV26ValleyRimPassage(before.state.seed, position, arrival, []).ok
    ? 'ride_blocked' : null
}

/** Fast, transient UI admission after the inherited V43 shell accepts a frame.
 * The durable writer still replays every frame through checked V43 successors. */
export function checkPublicV44RidePreviewStep(before: PublicV43Progress,
  after: PublicV43Progress, rawWitness: unknown):
  PublicV44GroundMountRejection | null {
  const witness = decodePublicV44GroundMountWitness(rawWitness)
  if (witness?.kind !== 'sedgehorn-ride-frame/v1'
    && witness?.kind !== 'sedgehorn-ride-frame/v2') return 'invalid_witness'
  try { return rideStepRejection(before, after, witness) }
  catch { return 'invalid_progress' }
}

function advanceV43(before: PublicV43Root, raw: unknown): PublicV43Root | null {
  const witness = decodePublicV43Witness(raw)
  if (!witness || !Number.isSafeInteger(before.head.saveRevision + 1)) return null
  const progress = replayPublicV43Witness(before.head, witness)
  const next: PublicV43Root | null = progress ? { lineage: before.lineage,
    previous: before.head, head: { ...progress, schemaVersion: PUBLIC_V43_SCHEMA,
      saveRevision: before.head.saveRevision + 1, witness } } : null
  return next && decodePublicV43CheckedSuccessor(before, next)
}

export function decodePublicV44GroundMountWitness(raw: unknown):
  PublicV44GroundMountWitness | null {
  try {
    if (exactPublicV23(raw, ['kind'])
      && (raw.kind === 'sedgehorn-mount/v1'
        || raw.kind === 'sedgehorn-dismount/v1')) return { kind: raw.kind }
    if (exactPublicV23(raw, ['kind', 'frames'])
      && raw.kind === 'sedgehorn-ride-batch/v1') {
      if (!Array.isArray(raw.frames) || Object.getPrototypeOf(raw.frames) !== Array.prototype
        || raw.frames.length < 1 || raw.frames.length > PUBLIC_V44_MAX_RIDE_BATCH) return null
      const keys = Reflect.ownKeys(raw.frames)
      if (keys.length !== raw.frames.length + 1
        || keys[raw.frames.length] !== 'length') return null
      const frames: PublicV44RideFrameWitness[] = []
      for (let index = 0; index < raw.frames.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(raw.frames, index)
        if (keys[index] !== String(index) || !descriptor?.enumerable
          || !Object.hasOwn(descriptor, 'value')) return null
        if (!exactPublicV23(raw.frames[index], ['kind', 'intents'])
          || raw.frames[index].kind !== 'sedgehorn-ride-frame/v1'
            && raw.frames[index].kind !== 'sedgehorn-ride-frame/v2') return null
        const frame = decodePublicV44GroundMountWitness(raw.frames[index])
        if (frame?.kind !== 'sedgehorn-ride-frame/v1'
          && frame?.kind !== 'sedgehorn-ride-frame/v2') return null
        frames.push(frame)
      }
      structuredClone(raw)
      return { kind: 'sedgehorn-ride-batch/v1', frames }
    }
    if (!exactPublicV23(raw, ['kind', 'intents'])
      || raw.kind !== 'sedgehorn-ride-frame/v1'
        && raw.kind !== 'sedgehorn-ride-frame/v2') return null
    const frame = decodePublicV14FrameWitness({ kind: 'frame-batch/v1',
      frames: [{ intents: raw.intents, walkRequested: true }] })?.frames[0]
    if (!frame || frame.intents.some((intent) => intent.type === 'jump')) return null
    structuredClone(raw)
    return { kind: raw.kind, intents: frame.intents }
  } catch { return null }
}

/** One intent either toggles a mature, nearby companion or reuses the V43
 * checked ordinary frame path. No client-selected position or speed is trusted. */
export function confirmPublicV44GroundMountAction(raw: PublicV44GroundMountProgress,
  rawWitness: unknown): PublicV44GroundMountResult {
  const before = decodePublicV44GroundMountProgress(raw)
  return before
    ? continuePublicV44GroundMountAction(before,
      decodePublicV44GroundMountWitness(rawWitness), rawWitness)
    : { rejection: 'invalid_progress' }
}

/** Batch frames reuse the checked intermediate root without re-decoding the
 * outer V44 progress. advanceV43 still checks each successor independently. */
function continuePublicV44GroundMountAction(before: PublicV44GroundMountProgress,
  witness: PublicV44GroundMountWitness | null, rawWitness: unknown):
  PublicV44GroundMountResult {
  const reject = (rejection: PublicV44GroundMountRejection):
    PublicV44GroundMountResult => ({ rejection })
  if (!witness) {
    // Parked V43 actions, including care, remain available before riding.
    const next = before.groundMount.mode === 'parked'
      ? advanceV43(before.v43, rawWitness) : null
    return next ? { progress: { v43: next, groundMount: before.groundMount } }
      : reject('invalid_witness')
  }
  if (witness.kind === 'sedgehorn-ride-batch/v1') {
    let current = before
    for (const frame of witness.frames) {
      const next = continuePublicV44GroundMountAction(current, frame, frame)
      if (!next.progress) return next
      current = next.progress
    }
    return { progress: current }
  }
  const { v43, groundMount } = before
  const { head } = v43
  const position = head.state.player.position
  if (witness.kind === 'sedgehorn-mount/v1') {
    if (groundMount.mode === 'riding') return reject('already_riding')
    if (head.familiar.phase !== 'claimed'
      || projectPublicV43MountTraining(head)?.mature !== true) return reject('not_mature')
    if (head.state.movementOwner !== 'streamed') return reject('wrong_region')
    const animal = groundMount.parkedPosition ?? head.familiar.position
    if (distance(position, animal) > 3) return reject('too_far')
    if (!safePose(head, position) || !safePose(head, animal)) return reject('unsafe_mount')
    return { progress: { v43, groundMount: { ...groundMount, mode: 'riding' } } }
  }
  if (groundMount.mode !== 'riding') return reject('not_riding')
  if (!safePose(head, position)) return reject('not_grounded')
  if (witness.kind === 'sedgehorn-dismount/v1')
    return { progress: { v43, groundMount: { mode: 'parked',
      parkedPosition: { ...position } } } }
  const frame = { kind: 'frame-batch/v1' as const,
    frames: [{ intents: witness.intents,
      walkRequested: witness.kind === 'sedgehorn-ride-frame/v1' }] }
  const next = advanceV43(v43, frame)
  if (!next) return reject('ride_blocked')
  const blocked = rideStepRejection(head, next.head, witness)
  if (blocked) return reject(blocked)
  return { progress: { v43: next, groundMount } }
}

type CheckedRideBatch = {
  before: PublicV44GroundMountProgress
  witness: PublicV44GroundMountWitness
  rawAfter: PublicV44GroundMountProgress
  checkedAfter: PublicV44GroundMountProgress
}
const RIDE_BATCH_CACHE_LIMIT = 3 << 20
let checkedRideBatch: CheckedRideBatch | null = null

/** The V44 writer can compare its proposed next record with this deterministic
 * replay before storage. This is not itself a durable writer. */
export function decodePublicV44GroundMountSuccessor(
  before: PublicV44GroundMountProgress, rawWitness: unknown, rawAfter: unknown):
  PublicV44GroundMountProgress | null {
  const cached = checkedRideBatch
  if (cached
    && sameStrictBoundedRaw(before, cached.before, RIDE_BATCH_CACHE_LIMIT)
    && sameStrictBoundedRaw(rawWitness, cached.witness, RIDE_BATCH_CACHE_LIMIT)
    && sameStrictBoundedRaw(rawAfter, cached.rawAfter, RIDE_BATCH_CACHE_LIMIT)) {
    try { return structuredClone(cached.checkedAfter) }
    catch { /* A failed clone cannot authorize a cached successor. */ }
  }
  const expected = confirmPublicV44GroundMountAction(before, rawWitness).progress
  const after = decodePublicV44GroundMountProgress(rawAfter)
  if (!expected || !after || !sameStrictBoundedRaw(expected, after, 3 << 20))
    return null
  if (decodePublicV44GroundMountWitness(rawWitness)?.kind === 'sedgehorn-ride-batch/v1') {
    try {
      const detached = { before: structuredClone(before),
        witness: structuredClone(rawWitness) as PublicV44GroundMountWitness,
        rawAfter: structuredClone(rawAfter) as PublicV44GroundMountProgress,
        checkedAfter: structuredClone(after) }
      // The strict comparison is both a complete-input equality proof and a
      // size/descriptor guard. Oversized or exotic values use ordinary replay.
      if (sameStrictBoundedRaw(before, detached.before, RIDE_BATCH_CACHE_LIMIT)
        && sameStrictBoundedRaw(rawWitness, detached.witness, RIDE_BATCH_CACHE_LIMIT)
        && sameStrictBoundedRaw(rawAfter, detached.rawAfter, RIDE_BATCH_CACHE_LIMIT)
        && sameStrictBoundedRaw(after, detached.checkedAfter, RIDE_BATCH_CACHE_LIMIT))
        checkedRideBatch = detached
    } catch { /* Cache admission is optional; the checked result remains valid. */ }
  }
  return after
}
