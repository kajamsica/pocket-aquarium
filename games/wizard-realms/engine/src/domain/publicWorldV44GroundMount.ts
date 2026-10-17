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
import type { PublicV43Root, PublicV43Witness } from './publicWorldV43Snapshot'
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
export type PublicV44GroundMountWitness = Readonly<{
  kind: 'sedgehorn-mount/v1'
}> | Readonly<{
  kind: 'sedgehorn-dismount/v1'
}> | Readonly<{
  kind: 'sedgehorn-ride-frame/v1'
  intents: readonly PublicV43RideIntent[]
}>
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
    if (mount.mode === 'riding' && !safePose(v43, v43.head.state.player.position))
      return null
    return { v43, groundMount: { mode: mount.mode,
      parkedPosition: parked === null ? null : { x: parked.x as number,
        y: parked.y as number, z: parked.z as number } } }
  } catch { return null }
}

function safePose(root: PublicV43Root, point: Vec3): boolean {
  const { head } = root
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

function advanceV43(before: PublicV43Root, raw: unknown): PublicV43Root | null {
  const witness = decodePublicV43Witness(raw)
  // V43 return-home timestamps are writer-minted, never accepted from a client.
  if (!witness || witness.kind === 'return-home/v1'
    || !Number.isSafeInteger(before.head.saveRevision + 1)) return null
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
    if (!exactPublicV23(raw, ['kind', 'intents'])
      || raw.kind !== 'sedgehorn-ride-frame/v1') return null
    const frame = decodePublicV14FrameWitness({ kind: 'frame-batch/v1',
      frames: [{ intents: raw.intents, walkRequested: true }] })?.frames[0]
    if (!frame || frame.intents.some((intent) => intent.type === 'jump')) return null
    structuredClone(raw)
    return { kind: 'sedgehorn-ride-frame/v1', intents: frame.intents }
  } catch { return null }
}

/** One intent either toggles a mature, nearby companion or reuses the V43
 * checked ordinary frame path. No client-selected position or speed is trusted. */
export function confirmPublicV44GroundMountAction(raw: PublicV44GroundMountProgress,
  rawWitness: unknown): PublicV44GroundMountResult {
  const reject = (rejection: PublicV44GroundMountRejection):
    PublicV44GroundMountResult => ({ rejection })
  const before = decodePublicV44GroundMountProgress(raw)
  const witness = decodePublicV44GroundMountWitness(rawWitness)
  if (!before) return reject('invalid_progress')
  if (!witness) {
    // Parked V43 actions, including care, remain available before riding.
    const next = before.groundMount.mode === 'parked'
      ? advanceV43(before.v43, rawWitness) : null
    return next ? { progress: { v43: next, groundMount: before.groundMount } }
      : reject('invalid_witness')
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
    if (!safePose(v43, position) || !safePose(v43, animal)) return reject('unsafe_mount')
    return { progress: { v43, groundMount: { ...groundMount, mode: 'riding' } } }
  }
  if (groundMount.mode !== 'riding') return reject('not_riding')
  if (!safePose(v43, position)) return reject('not_grounded')
  if (witness.kind === 'sedgehorn-dismount/v1')
    return { progress: { v43, groundMount: { mode: 'parked',
      parkedPosition: { ...position } } } }
  const frame = { kind: 'frame-batch/v1' as const,
    frames: [{ intents: witness.intents, walkRequested: true }] }
  const next = advanceV43(v43, frame)
  if (!next || !safePose(next, next.head.state.player.position))
    return reject('ride_blocked')
  const arrival = next.head.state.player.position
  const moved = witness.intents.find((intent) => intent.type === 'move')
  const delta = moved?.type === 'move' ? moved.delta : { x: 0, z: 0 }
  if (Math.hypot(arrival.x - position.x - delta.x,
    arrival.z - position.z - delta.z) > EPSILON
    || Math.abs(arrival.y - position.y) > MAX_GRADE + EPSILON
    || publicV43FamiliarTouchesUnrevealedCell(head.state.discoveryMask,
      position, arrival)
    || publicV43FamiliarTouchesForbiddenSupport(head.state.seed, position,
      arrival, head.terrain.columns, head.raisedSoilCells)
    || mireglassMoveBarrier(head.state.seed, position, arrival) !== null
    || !publicV26ValleyRimPassage(head.state.seed, position, arrival, []).ok)
    return reject('ride_blocked')
  return { progress: { v43: next, groundMount } }
}

/** The V44 writer can compare its proposed next record with this deterministic
 * replay before storage. This is not itself a durable writer. */
export function decodePublicV44GroundMountSuccessor(
  before: PublicV44GroundMountProgress, rawWitness: unknown, rawAfter: unknown):
  PublicV44GroundMountProgress | null {
  const expected = confirmPublicV44GroundMountAction(before, rawWitness).progress
  const after = decodePublicV44GroundMountProgress(rawAfter)
  return expected && after && sameStrictBoundedRaw(expected, after, 3 << 20)
    ? after : null
}
