import { PUBLIC_RUN_STEP_METERS } from './publicWorldGait'
import type { PublicV17GroundStepPolicy } from './publicWorldV17StarterMovement'
import { STARTER_CLIFF_PROFILE, starterCliffCanonicalFace, starterCliffFace } from './starterCliffProfile'
import { starterCliffGroundYAt } from './starterCliffWorld'
import type { RouteProfile, Vec3 } from './types'

export interface StarterCliffMovementContext {
  seed: string
  profile: string
  route: RouteProfile | null
  built: boolean
}

export interface StarterCliffSupport {
  kind: 'ground' | 'ladder'
  floorY: number
  progress: number | null
}

export type StarterCliffMoveResult =
  | { accepted: true; position: Vec3; support: StarterCliffSupport }
  | { accepted: false; reason: 'wrong_profile' | 'invalid_pose' | 'invalid_move'
    | 'world_edge' | 'cliff_blocked' | 'off_ladder' }

const EPSILON = 1e-6
const MAX_GROUND_STEP = 0.55
const finite = (...values: number[]) => values.every(Number.isFinite)

function faceFor(context: StarterCliffMovementContext) {
  return context.route && starterCliffFace(context.seed || 'wizard-realms', context.route,
    context.profile, context.built)
}

/** The exact support surface used by movement, rendering and saved-pose proof. */
export function starterCliffSupportAt(context: StarterCliffMovementContext,
  position: { x: number; z: number }): StarterCliffSupport | null {
  if (context.profile !== STARTER_CLIFF_PROFILE || !finite(position.x, position.z)) return null
  const groundY = starterCliffGroundYAt(context.seed, position.x, position.z)
  if (groundY === null) return null
  const face = faceFor(context)
  if (face && Math.abs(position.x - face.from.x) <= face.width / 2 + EPSILON
    && position.z <= face.from.z && position.z >= face.to.z) {
    const progress = (face.from.z - position.z) / (face.from.z - face.to.z)
    return { kind: 'ladder', floorY: face.from.y + (face.to.y - face.from.y) * progress,
      progress }
  }
  return { kind: 'ground', floorY: groundY, progress: null }
}

/** Supported poses, including a saved pose partway up the built ladder. */
export function starterCliffPoseValid(context: StarterCliffMovementContext,
  position: Vec3, verticalVelocity: number): boolean {
  const support = starterCliffSupportAt(context, position)
  return !!support && finite(position.y, verticalVelocity)
    && verticalVelocity === 0 && Math.abs(position.y - support.floorY) <= EPSILON
}

/** One ordinary fixed-frame move. The caller commits the returned pose only on acceptance. */
export function starterCliffAdvanceMove(context: StarterCliffMovementContext,
  from: Vec3, to: { x: number; z: number }, verticalVelocity: number,
  policy?: PublicV17GroundStepPolicy): StarterCliffMoveResult {
  if (context.profile !== STARTER_CLIFF_PROFILE) return { accepted: false, reason: 'wrong_profile' }
  if (!finite(from.x, from.y, from.z, to.x, to.z, verticalVelocity)) {
    return { accepted: false, reason: 'invalid_move' }
  }
  const dx = to.x - from.x
  const dz = to.z - from.z
  if (Math.hypot(dx, dz) > PUBLIC_RUN_STEP_METERS + EPSILON) {
    return { accepted: false, reason: 'invalid_move' }
  }
  const start = starterCliffSupportAt(context, from)
  const end = starterCliffSupportAt(context, to)
  if (!start) return { accepted: false, reason: 'invalid_pose' }
  if (!end) return { accepted: false, reason: 'world_edge' }
  if (from.y < start.floorY - EPSILON
    || verticalVelocity === 0 && Math.abs(from.y - start.floorY) > EPSILON) {
    return { accepted: false, reason: 'invalid_pose' }
  }

  const face = faceFor(context)
  const seamZ = starterCliffCanonicalFace(context.seed).to.z
  const crossesSeam = (from.z < seamZ && to.z >= seamZ)
    || (from.z > seamZ && to.z <= seamZ)
  const xAtSeam = crossesSeam ? from.x + dx * (seamZ - from.z) / dz : from.x
  const onFace = !!face && Math.abs(xAtSeam - face.from.x) <= face.width / 2 + EPSILON
  const seamRise = crossesSeam ? Math.abs(
    starterCliffGroundYAt(context.seed, xAtSeam, seamZ - EPSILON * 10)!
    - starterCliffGroundYAt(context.seed, xAtSeam, seamZ + EPSILON * 10)!) : 0
  if (crossesSeam && seamRise > MAX_GROUND_STEP && !onFace) {
    return { accepted: false, reason: 'cliff_blocked' }
  }
  // A move may enter/leave the short face only at its ends. This also catches
  // diagonal paths whose endpoints are centered but whose swept face is not.
  if (face && (start.kind === 'ladder' || end.kind === 'ladder' || crossesSeam && onFace)) {
    const overlapFrom = Math.max(Math.min(from.z, to.z), face.to.z)
    const overlapTo = Math.min(Math.max(from.z, to.z), face.from.z)
    if (overlapFrom <= overlapTo && dz !== 0) {
      for (const z of [overlapFrom, overlapTo]) {
        const x = from.x + dx * (z - from.z) / dz
        if (Math.abs(x - face.from.x) > face.width / 2 + EPSILON) {
          return { accepted: false, reason: 'off_ladder' }
        }
      }
    }
    if (start.kind === 'ladder' && end.kind === 'ground'
      && to.z >= face.to.z && to.z <= face.from.z
      || start.kind === 'ground' && end.kind === 'ladder'
      && from.z >= face.to.z && from.z <= face.from.z) {
      return { accepted: false, reason: 'off_ladder' }
    }
    if (verticalVelocity !== 0 || Math.abs(from.y - start.floorY) > EPSILON) {
      return { accepted: false, reason: 'invalid_pose' }
    }
  } else if (Math.abs(end.floorY - start.floorY) > (policy?.maxOrdinaryGroundStepMeters === 0.8
    && !crossesSeam && start.kind === 'ground' && end.kind === 'ground'
    ? 0.8 : MAX_GROUND_STEP)) {
    return { accepted: false, reason: 'cliff_blocked' }
  }
  return { accepted: true,
    position: { x: to.x, y: end.kind === 'ladder' || verticalVelocity === 0
      ? end.floorY : Math.max(from.y, end.floorY), z: to.z }, support: end }
}
