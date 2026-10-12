import { PUBLIC_RUN_STEP_METERS } from './publicWorldGait'
import { PUBLIC_V15_STARTER_CREEK_BOUNDS, publicWorldV15StarterSites } from './publicWorldV15StarterSites'
import type { PublicV15StarterWorks } from './publicWorldV15Snapshot'
import { starterCliffAdvanceMove, starterCliffSupportAt } from './starterCliffMovement'
import type { StarterCliffMovementContext, StarterCliffSupport } from './starterCliffMovement'
import { STARTER_CLIFF_PROFILE } from './starterCliffProfile'
import type { Vec3 } from './types'

export interface PublicV15StarterMovementContext extends StarterCliffMovementContext {
  starterWorks: PublicV15StarterWorks
}

export type PublicV15StarterSupport = StarterCliffSupport
  | Readonly<{ kind: 'bridge'; floorY: number; progress: number }>

export type PublicV15StarterMoveResult =
  | Readonly<{ accepted: true; position: Vec3; support: PublicV15StarterSupport }>
  | Readonly<{ accepted: false; reason: 'wrong_profile' | 'invalid_pose' | 'invalid_move'
    | 'world_edge' | 'cliff_blocked' | 'off_ladder' | 'creek_blocked' | 'off_bridge' }>

const EPSILON = 1e-6
const MAX_GROUND_STEP = 0.55
const finite = (...values: number[]) => values.every(Number.isFinite)

function bridgeFacts(seed: string) {
  const [bridge, dig] = publicWorldV15StarterSites(seed)
  if (bridge.kind !== 'bridge' || dig.kind !== 'dig') throw new RangeError('Invalid v15 starter works.')
  return { bridge, dig }
}

function wetAt(x: number, z: number): boolean {
  const { minX, maxX, nearZ, farZ } = PUBLIC_V15_STARTER_CREEK_BOUNDS
  // The source grid selects cells using ceil(position / 4 - 0.5).
  return x > minX && x <= maxX && z > nearZ && z <= farZ
}

/** Closed segment's intersection interval with the wet rectangle, or null. */
function wetSweep(from: { x: number; z: number }, to: { x: number; z: number }): [number, number] | null {
  const { minX, maxX, nearZ, farZ } = PUBLIC_V15_STARTER_CREEK_BOUNDS
  let lo = 0
  let hi = 1
  for (const [start, delta, min, max] of [
    [from.x, to.x - from.x, minX, maxX],
    [from.z, to.z - from.z, nearZ, farZ],
  ]) {
    if (delta === 0) {
      if (start < min || start > max) return null
    } else {
      const a = (min - start) / delta
      const b = (max - start) / delta
      lo = Math.max(lo, Math.min(a, b))
      hi = Math.min(hi, Math.max(a, b))
      if (lo > hi) return null
    }
  }
  const mid = (lo + hi) / 2
  return wetAt(from.x + (to.x - from.x) * mid,
    from.z + (to.z - from.z) * mid) ? [lo, hi] : null
}

/** Exact support used by movement, jumping and replayed grounded-pose proof. */
export function publicV15StarterSupportAt(context: PublicV15StarterMovementContext,
  position: { x: number; z: number }): PublicV15StarterSupport | null {
  const base = starterCliffSupportAt(context, position)
  if (!base) return null
  const { bridge, dig } = bridgeFacts(context.seed)
  const halfWidth = bridge.widthMeters / 2
  if (context.starterWorks.bridgeBuilt && Math.abs(position.x - bridge.from.x) <= halfWidth
    && position.z >= bridge.from.z && position.z <= bridge.to.z) {
    const [near, center, far] = bridge.supportPath
    const firstHalf = position.z <= center.z
    const start = firstHalf ? near : center
    const end = firstHalf ? center : far
    const t = (position.z - start.z) / (end.z - start.z)
    return { kind: 'bridge', floorY: start.y + (end.y - start.y) * t,
      progress: (position.z - near.z) / (far.z - near.z) }
  }
  if (wetAt(position.x, position.z)) return null
  if (context.starterWorks.bankCacheDug && position.x > dig.center.x - 2
    && position.x <= dig.center.x + 2 && position.z > dig.center.z - 2
    && position.z <= dig.center.z + 2) {
    return { ...base, floorY: base.floorY - dig.depthMeters }
  }
  return base
}

/** A saved pose cannot retain pre-work height or stand in unsupported water. */
export function publicV15StarterPoseValid(context: PublicV15StarterMovementContext,
  position: Vec3, verticalVelocity: number): boolean {
  const support = publicV15StarterSupportAt(context, position)
  return !!support && finite(position.y, verticalVelocity) && verticalVelocity === 0
    && Math.abs(position.y - support.floorY) <= EPSILON
}

/** One 50 ms horizontal move. The caller commits only an accepted result. */
export function publicV15StarterAdvanceMove(context: PublicV15StarterMovementContext,
  from: Vec3, to: { x: number; z: number }, verticalVelocity: number): PublicV15StarterMoveResult {
  if (context.profile !== STARTER_CLIFF_PROFILE) return { accepted: false, reason: 'wrong_profile' }
  if (!finite(from.x, from.y, from.z, to.x, to.z, verticalVelocity)
    || Math.hypot(to.x - from.x, to.z - from.z) > PUBLIC_RUN_STEP_METERS + EPSILON) {
    return { accepted: false, reason: 'invalid_move' }
  }
  // Keep the existing cliff and every non-starter move on the v14 collision path.
  if (Math.min(from.z, to.z) > 14 || Math.max(from.z, to.z) < 4
    || Math.min(from.x, to.x) > 10 || Math.max(from.x, to.x) < -10) {
    return starterCliffAdvanceMove(context, from, to, verticalVelocity)
  }
  const start = publicV15StarterSupportAt(context, from)
  const end = publicV15StarterSupportAt(context, to)
  if (!start) return { accepted: false, reason: 'invalid_pose' }
  if (from.y < start.floorY - EPSILON
    || verticalVelocity === 0 && Math.abs(from.y - start.floorY) > EPSILON) {
    return { accepted: false, reason: 'invalid_pose' }
  }
  const wet = wetSweep(from, to)
  if (wet) {
    if (!context.starterWorks.bridgeBuilt) return { accepted: false, reason: 'creek_blocked' }
    const halfWidth = bridgeFacts(context.seed).bridge.widthMeters / 2
    if ([wet[0], wet[1]].some((t) => Math.abs(from.x + (to.x - from.x) * t) > halfWidth + EPSILON)) {
      return { accepted: false, reason: 'off_bridge' }
    }
  }
  if (!end) return { accepted: false, reason: wetAt(to.x, to.z)
    ? context.starterWorks.bridgeBuilt ? 'off_bridge' : 'creek_blocked' : 'world_edge' }
  if (context.starterWorks.bridgeBuilt && (start.kind === 'bridge') !== (end.kind === 'bridge')) {
    const { bridge } = bridgeFacts(context.seed)
    const crossesEnd = [bridge.from.z, bridge.to.z].some((z) =>
      Math.min(from.z, to.z) <= z && z <= Math.max(from.z, to.z))
    if (!crossesEnd) return { accepted: false, reason: 'off_bridge' }
  }
  if (Math.abs(end.floorY - start.floorY) > MAX_GROUND_STEP) {
    return { accepted: false, reason: 'cliff_blocked' }
  }
  return { accepted: true, position: { x: to.x,
    y: verticalVelocity === 0 ? end.floorY : Math.max(from.y, end.floorY),
    z: to.z }, support: end }
}
