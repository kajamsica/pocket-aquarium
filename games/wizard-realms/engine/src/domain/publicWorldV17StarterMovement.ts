import { PUBLIC_RUN_STEP_METERS } from './publicWorldGait'
import { PUBLIC_V15_STARTER_CREEK_BOUNDS } from './publicWorldV15StarterSites'
import { publicWorldV16TileAtGrid } from './publicWorldV16GreenwaySites'
import { resolvePublicV17GreenwaySite } from './publicWorldV17GreenwaySites'
import type { PublicV16GreenwaySite } from './publicWorldV16GreenwaySites'
import type { PublicV16GreenwayWorks } from './publicWorldV16Migration'
import { starterCliffSupportAt } from './starterCliffMovement'
import type { StarterCliffMovementContext, StarterCliffSupport } from './starterCliffMovement'
import { STARTER_CLIFF_PROFILE, starterCliffCanonicalFace, starterCliffFace } from './starterCliffProfile'
import { starterCliffGroundYAt } from './starterCliffWorld'
import type { Vec3 } from './types'
import { WORLD_CELL_METERS } from './worldChunks'

export interface PublicV17StarterMovementContext extends StarterCliffMovementContext {
  greenwayWorks: PublicV16GreenwayWorks
}

export type PublicV17GroundStepPolicy = Readonly<{
  maxOrdinaryGroundStepMeters: 0.55 | 0.8
}>

type Bridge = Extract<PublicV16GreenwaySite, { kind: 'bridge' }>
type Ladder = Extract<PublicV16GreenwaySite, { kind: 'ladder' }>
type Dig = Extract<PublicV16GreenwaySite, { kind: 'dig' }>
type BuiltSites = { bridges: Bridge[]; ladders: Ladder[]; digs: Dig[] }
type Face = Readonly<{ from: Readonly<Vec3>; to: Readonly<Vec3>; width: number }>

export type PublicV17StarterSupport = StarterCliffSupport
  | Readonly<{ kind: 'bridge'; floorY: number; progress: number; siteId: string }>

export type PublicV17StarterMoveResult =
  | Readonly<{ accepted: true; position: Vec3; support: PublicV17StarterSupport }>
  | Readonly<{ accepted: false; reason: 'wrong_profile' | 'invalid_pose' | 'invalid_move'
    | 'world_edge' | 'cliff_blocked' | 'off_ladder' | 'creek_blocked' | 'off_bridge' }>

const EPSILON = 1e-6
const MAX_GROUND_STEP = 0.55
const BRIDGE_ENTRY_REACH = 1.5
const BRIDGE_ENTRY_DRY_MARGIN = 0.01
const finite = (...values: number[]) => values.every(Number.isFinite)

/** A forged or unresolved ID invalidates the entire movement ledger. */
function builtSites(context: PublicV17StarterMovementContext): BuiltSites | null {
  try {
    const works = context.greenwayWorks
    if (!works || typeof context.seed !== 'string') return null
    const groups = [works.builtBridgeIds, works.builtLadderIds, works.dugTileIds]
    const limits = [32, 32, 64]
    const kinds = ['bridge', 'ladder', 'dig'] as const
    const sites: BuiltSites = { bridges: [], ladders: [], digs: [] }
    for (let group = 0; group < groups.length; group++) {
      const ids = groups[group]
      if (!Array.isArray(ids) || ids.length > limits[group]) return null
      for (let index = 0; index < ids.length; index++) {
        const id = ids[index]
        if (typeof id !== 'string' || index > 0 && ids[index - 1] >= id) return null
        const site = resolvePublicV17GreenwaySite(context.seed, id)
        if (!site || site.kind !== kinds[group]) return null
        if (site.kind === 'bridge') sites.bridges.push(site)
        else if (site.kind === 'ladder') sites.ladders.push(site)
        else sites.digs.push(site)
      }
    }
    return sites
  } catch { return null }
}

function faces(context: PublicV17StarterMovementContext, sites: BuiltSites): Face[] {
  const authored = context.route && starterCliffFace(context.seed || 'wizard-realms',
    context.route, context.profile, context.built)
  return [...(authored ? [authored] : []), ...sites.ladders.map((site) => ({
    from: site.supportPath[1], to: site.supportPath[2], width: site.widthMeters,
  }))]
}

function wetAt(x: number, z: number): boolean {
  const { minX, maxX, nearZ, farZ } = PUBLIC_V15_STARTER_CREEK_BOUNDS
  return x > minX && x <= maxX && z > nearZ && z <= farZ
}

function digAt(sites: BuiltSites, position: { x: number; z: number }): Dig | undefined {
  return sites.digs.find((dig) => position.x > dig.center.x - 2
    && position.x <= dig.center.x + 2 && position.z > dig.center.z - 2
    && position.z <= dig.center.z + 2)
}

/** Parameter interval where the move intersects wet creek cells. */
function wetSweep(from: { x: number; z: number }, to: { x: number; z: number }): [number, number] | null {
  const { minX, maxX, nearZ, farZ } = PUBLIC_V15_STARTER_CREEK_BOUNDS
  let lo = 0, hi = 1
  for (const [start, delta, min, max] of [
    [from.x, to.x - from.x, minX, maxX], [from.z, to.z - from.z, nearZ, farZ],
  ]) {
    if (delta === 0) {
      if (start < min || start > max) return null
    } else {
      const a = (min - start) / delta, b = (max - start) / delta
      lo = Math.max(lo, Math.min(a, b))
      hi = Math.min(hi, Math.max(a, b))
      if (lo > hi) return null
    }
  }
  const middle = (lo + hi) / 2
  return wetAt(from.x + (to.x - from.x) * middle,
    from.z + (to.z - from.z) * middle) ? [lo, hi] : null
}

/** Guide near-axial steps into a built lane on dry banks and along its deck rails. */
function bridgeGuidedStep(sites: BuiltSites, from: Vec3, to: { x: number; z: number },
  start: PublicV17StarterSupport, verticalVelocity: number): { x: number; z: number } {
  const dx = to.x - from.x, dz = to.z - from.z
  const length = Math.hypot(dx, dz)
  if (verticalVelocity !== 0 || length < EPSILON
    || Math.abs(dz) < 0.08 || Math.abs(dx) > Math.abs(dz) * 0.35) return to
  if (start.kind === 'bridge') {
    const bridge = sites.bridges.find((site) => site.id === start.siteId)!
    const halfWidth = bridge.widthMeters / 2
    const x = Math.max(bridge.from.x - halfWidth, Math.min(bridge.from.x + halfWidth, to.x))
    if (x === to.x) return to
    // Keep the requested stride continuous: only turn the outward part along the rail.
    return { x, z: from.z + Math.sign(dz)
      * Math.sqrt(Math.max(0, length * length - (x - from.x) ** 2)) }
  }
  if (start.kind !== 'ground') return to
  const { nearZ, farZ } = PUBLIC_V15_STARTER_CREEK_BOUNDS
  const candidates = sites.bridges.filter((bridge) => {
    const offset = Math.abs(from.x - bridge.from.x)
    if (offset <= bridge.widthMeters / 2 + EPSILON || offset > BRIDGE_ENTRY_REACH) return false
    return dz > 0
      ? from.z >= bridge.from.z - 0.8 && from.z <= nearZ
      : from.z > farZ && from.z <= bridge.to.z + 0.8
  })
  const bridge = candidates.sort((a, b) =>
    Math.abs(from.x - a.from.x) - Math.abs(from.x - b.from.x))[0]
  if (!bridge) return to
  const dryLimit = dz > 0 ? nearZ - BRIDGE_ENTRY_DRY_MARGIN
    : farZ + BRIDGE_ENTRY_DRY_MARGIN
  const availableForward = dz > 0 ? Math.max(0, dryLimit - from.z)
    : Math.max(0, from.z - dryLimit)
  const forward = Math.min(Math.abs(dz), length * 0.3, availableForward)
  const inward = Math.min(Math.abs(from.x - bridge.from.x)
      - (bridge.widthMeters / 2 - 0.08),
    Math.sqrt(Math.max(0, length * length - forward * forward)))
  return { x: from.x + Math.sign(bridge.from.x - from.x) * inward,
    z: from.z + Math.sign(dz) * forward }
}

function supportAt(context: PublicV17StarterMovementContext, sites: BuiltSites,
  position: { x: number; z: number }): PublicV17StarterSupport | null {
  const base = starterCliffSupportAt(context, position)
  if (!base) return null
  for (const bridge of sites.bridges) {
    if (Math.abs(position.x - bridge.from.x) > bridge.widthMeters / 2 + EPSILON
      || position.z < bridge.from.z || position.z > bridge.to.z) continue
    const [near, center, far] = bridge.supportPath
    const start = position.z <= center.z ? near : center
    const end = position.z <= center.z ? center : far
    const t = (position.z - start.z) / (end.z - start.z)
    return { kind: 'bridge', siteId: bridge.id,
      floorY: start.y + (end.y - start.y) * t,
      progress: (position.z - near.z) / (far.z - near.z) }
  }
  if (wetAt(position.x, position.z)) return null
  for (const face of faces(context, sites)) {
    if (Math.abs(position.x - face.from.x) <= face.width / 2 + EPSILON
      && position.z <= face.from.z && position.z >= face.to.z) {
      const progress = (face.from.z - position.z) / (face.from.z - face.to.z)
      return { kind: 'ladder', floorY: face.from.y + (face.to.y - face.from.y) * progress,
        progress }
    }
  }
  const gx = Math.ceil(position.x / WORLD_CELL_METERS - 0.5)
  const gz = Math.ceil(position.z / WORLD_CELL_METERS - 0.5)
  const groundY = publicWorldV16TileAtGrid(context.seed, gx, gz).center.y
  const dig = digAt(sites, position)
  if (dig) return { kind: 'ground', floorY: groundY - dig.depthMeters, progress: null }
  return { kind: 'ground', floorY: groundY, progress: null }
}

/** Exact support for saved works3/works4 and the authored center ladder. */
export function publicV17StarterSupportAt(context: PublicV17StarterMovementContext,
  position: { x: number; z: number }): PublicV17StarterSupport | null {
  if (context.profile !== STARTER_CLIFF_PROFILE) return null
  const sites = builtSites(context)
  return sites ? supportAt(context, sites, position) : null
}

/** Restored poses must stand on the current, built-only support surface. */
export function publicV17StarterPoseValid(context: PublicV17StarterMovementContext,
  position: Vec3, verticalVelocity: number): boolean {
  const support = publicV17StarterSupportAt(context, position)
  return !!support && finite(position.y, verticalVelocity) && verticalVelocity === 0
    && Math.abs(position.y - support.floorY) <= EPSILON
}

/** One fixed-frame move, including swept creek and cliff-seam collision. */
export function publicV17StarterAdvanceMove(context: PublicV17StarterMovementContext,
  from: Vec3, to: { x: number; z: number }, verticalVelocity: number,
  policy?: PublicV17GroundStepPolicy): PublicV17StarterMoveResult {
  if (context.profile !== STARTER_CLIFF_PROFILE) return { accepted: false, reason: 'wrong_profile' }
  if (!finite(from.x, from.y, from.z, to.x, to.z, verticalVelocity)
    || Math.hypot(to.x - from.x, to.z - from.z) > PUBLIC_RUN_STEP_METERS + EPSILON) {
    return { accepted: false, reason: 'invalid_move' }
  }
  const sites = builtSites(context)
  if (!sites) return { accepted: false, reason: 'invalid_pose' }
  const start = supportAt(context, sites, from)
  if (!start || from.y < start.floorY - EPSILON
    || verticalVelocity === 0 && Math.abs(from.y - start.floorY) > EPSILON) {
    return { accepted: false, reason: 'invalid_pose' }
  }

  to = bridgeGuidedStep(sites, from, to, start, verticalVelocity)
  const end = supportAt(context, sites, to)

  const wet = wetSweep(from, to)
  if (wet) {
    const crossing = sites.bridges.some((bridge) => [wet[0], wet[1]].every((t) =>
      Math.abs(from.x + (to.x - from.x) * t - bridge.from.x)
        <= bridge.widthMeters / 2 + EPSILON))
    if (!crossing) return { accepted: false,
      reason: sites.bridges.length ? 'off_bridge' : 'creek_blocked' }
  }
  if (!end) return { accepted: false, reason: wetAt(to.x, to.z)
    ? sites.bridges.length ? 'off_bridge' : 'creek_blocked' : 'world_edge' }
  const startBridge = start.kind === 'bridge' ? start.siteId : null
  const endBridge = end.kind === 'bridge' ? end.siteId : null
  if (startBridge !== endBridge) {
    const bridge = sites.bridges.find((site) => site.id === (startBridge ?? endBridge))
    // Decks extend onto dry banks, where a lateral step needs no end-only gate.
    if (!bridge || wet && ![bridge.from.z, bridge.to.z].some((z) =>
      Math.min(from.z, to.z) <= z && z <= Math.max(from.z, to.z))) {
      return { accepted: false, reason: 'off_bridge' }
    }
  }

  const availableFaces = faces(context, sites)
  const seamZ = starterCliffCanonicalFace(context.seed).to.z
  const dz = to.z - from.z, dx = to.x - from.x
  const crossesSeam = from.z < seamZ && to.z >= seamZ
    || from.z > seamZ && to.z <= seamZ
  const xAtSeam = crossesSeam ? from.x + dx * (seamZ - from.z) / dz : from.x
  const faceAtSeam = availableFaces.find((face) =>
    Math.abs(xAtSeam - face.from.x) <= face.width / 2 + EPSILON)
  const seamRise = crossesSeam ? Math.abs(
    starterCliffGroundYAt(context.seed, xAtSeam, seamZ - EPSILON * 10)!
      - starterCliffGroundYAt(context.seed, xAtSeam, seamZ + EPSILON * 10)!) : 0
  if (crossesSeam && seamRise > MAX_GROUND_STEP && !faceAtSeam) {
    return { accepted: false, reason: 'cliff_blocked' }
  }
  const activeFace = availableFaces.find((face) => {
    const within = (point: { x: number; z: number }) => point.z >= face.to.z
      && point.z <= face.from.z && Math.abs(point.x - face.from.x) <= face.width / 2 + EPSILON
    return within(from) || within(to) || face === faceAtSeam && crossesSeam
  })
  if (activeFace) {
    const overlapFrom = Math.max(Math.min(from.z, to.z), activeFace.to.z)
    const overlapTo = Math.min(Math.max(from.z, to.z), activeFace.from.z)
    if (overlapFrom <= overlapTo && dz !== 0) {
      for (const z of [overlapFrom, overlapTo]) {
        const x = from.x + dx * (z - from.z) / dz
        if (Math.abs(x - activeFace.from.x) > activeFace.width / 2 + EPSILON) {
          return { accepted: false, reason: 'off_ladder' }
        }
      }
    }
    if (start.kind === 'ladder' && end.kind === 'ground'
      && to.z >= activeFace.to.z && to.z <= activeFace.from.z
      || start.kind === 'ground' && end.kind === 'ladder'
      && from.z >= activeFace.to.z && from.z <= activeFace.from.z) {
      return { accepted: false, reason: 'off_ladder' }
    }
    if (verticalVelocity !== 0 || Math.abs(from.y - start.floorY) > EPSILON) {
      return { accepted: false, reason: 'invalid_pose' }
    }
  } else if (Math.abs(end.floorY - start.floorY) > (policy?.maxOrdinaryGroundStepMeters === 0.8
    && start.kind === 'ground' && end.kind === 'ground'
    && !digAt(sites, from) && !digAt(sites, to) ? 0.8 : MAX_GROUND_STEP)) {
    return { accepted: false, reason: 'cliff_blocked' }
  }
  return { accepted: true, position: { x: to.x,
    y: end.kind === 'ladder' || verticalVelocity === 0
      ? end.floorY : Math.max(from.y, end.floorY), z: to.z }, support: end }
}
