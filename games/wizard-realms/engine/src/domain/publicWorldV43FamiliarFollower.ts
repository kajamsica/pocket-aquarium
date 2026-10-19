import { discoveryMaskHasTileId } from './discoveryMask'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { decodePublicV14FrameWitness } from './publicWorldV14Snapshot'
import { resolvePublicV23Surface } from './publicWorldV14Terrain'
import { publicV25RiverTouchesSegment } from './publicWorldV25RiverSweep'
import { publicV26ValleyRimPassage } from './publicWorldV26ValleyRim'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { decodePublicV42RewardProgress } from './publicWorldV42RewardAction'
import type { PublicV42RewardProgress } from './publicWorldV42RewardAction'
import { replayPublicV42Witness } from './publicWorldV42Snapshot'
import { decodePublicV43FamiliarProgress } from './publicWorldV43FamiliarAction'
import type { PublicV43FamiliarProgress, PublicV43FamiliarState } from './publicWorldV43FamiliarAction'
import { WORLD_CELL_METERS } from './worldChunks'

const STEP_METERS = 0.2
const LEASH_METERS = 16
const CLOSE_METERS = 1.25
const MAX_GRADE = 0.55
const EPSILON = 1e-6

type Point = Readonly<{ x: number; z: number }>
type Cell = Readonly<{ gx: number; gz: number }>

/** Conservative closed-cell sweep, including a diagonal that only touches a
 * modified cell's corner. The follower must not step over a pit or soil lift
 * whose centre is absent from its two endpoint cells. */
function touchesCell(from: Point, to: Point, cell: Cell): boolean {
  const half = WORLD_CELL_METERS / 2
  let entry = 0, exit = 1
  for (const axis of ['x', 'z'] as const) {
    const start = from[axis], change = to[axis] - start
    const center = (axis === 'x' ? cell.gx : cell.gz) * WORLD_CELL_METERS
    const low = center - half, high = center + half
    if (change === 0) {
      if (start < low || start > high) return false
      continue
    }
    const first = (low - start) / change, last = (high - start) / change
    entry = Math.max(entry, Math.min(first, last))
    exit = Math.min(exit, Math.max(first, last))
    if (entry > exit) return false
  }
  return true
}

/** The same swept XZ segment is checked against water and user-modified
 * support. This pure predicate is also the regression-test seam. */
export function publicV43FamiliarTouchesForbiddenSupport(seed: string,
  from: Point, to: Point,
  openColumns: readonly Readonly<{ gx: number; gz: number; openDepth: number }>[],
  raisedSoilCells: readonly Cell[]): boolean {
  return publicV25RiverTouchesSegment(seed, from, to)
    || openColumns.some((cell) => cell.openDepth > 0 && touchesCell(from, to, cell))
    || raisedSoilCells.some((cell) => touchesCell(from, to, cell))
}

/** Closed-cell supercover. Endpoint discovery alone can permit a diagonal
 * step through the corner of a still-hidden side cell. */
export function publicV43FamiliarTouchesUnrevealedCell(mask: unknown,
  from: Point, to: Point): boolean {
  if (![from.x, from.z, to.x, to.z].every(Number.isFinite)
    || Math.abs(to.x - from.x) > WORLD_CELL_METERS
    || Math.abs(to.z - from.z) > WORLD_CELL_METERS) return true
  const half = WORLD_CELL_METERS / 2
  const minGx = Math.ceil((Math.min(from.x, to.x) - half) / WORLD_CELL_METERS)
  const maxGx = Math.floor((Math.max(from.x, to.x) + half) / WORLD_CELL_METERS)
  const minGz = Math.ceil((Math.min(from.z, to.z) - half) / WORLD_CELL_METERS)
  const maxGz = Math.floor((Math.max(from.z, to.z) + half) / WORLD_CELL_METERS)
  for (let gx = minGx; gx <= maxGx; gx += 1) {
    for (let gz = minGz; gz <= maxGz; gz += 1) {
      if (touchesCell(from, to, { gx, gz })
        && !discoveryMaskHasTileId(mask, `tile-${gx + 3}-${gz + 3}`)) return true
    }
  }
  return false
}

function advanceChecked(before: PublicV43FamiliarProgress,
  parent: PublicV42RewardProgress): PublicV43FamiliarProgress | null {
  if (parent.state.seed !== before.state.seed
    || parent.state.tick <= before.state.tick) return null
  const playerPose = projectPublicV31Pose(parent)
  if (!playerPose || parent.state.player.verticalVelocity !== 0
    || Math.abs(playerPose.effective.position.y
      - playerPose.effective.floorY) > EPSILON) return null
  const unchanged = { ...parent, familiar: before.familiar }
  if (before.familiar.phase !== 'escort')
    return unchanged
  const player = playerPose.effective.position
  const animal = before.familiar.position
  const dx = player.x - animal.x, dz = player.z - animal.z
  const distance = Math.hypot(dx, dz)
  let familiar: PublicV43FamiliarState = before.familiar
  if (distance > LEASH_METERS) familiar = { ...familiar, waitReason: 'separated' }
  else if (distance <= CLOSE_METERS) familiar = { ...familiar, waitReason: 'none' }
  else {
    const amount = Math.min(STEP_METERS, distance - CLOSE_METERS)
    const candidateXZ = { x: animal.x + dx / distance * amount,
      z: animal.z + dz / distance * amount }
    const floor = resolvePublicV23Surface(parent.state, candidateXZ,
      parent.regionalWorks.builtLadderIds)
    const candidate = floor && { ...candidateXZ, y: floor.floorY }
    const projection = candidate && projectPublicV31Pose(parent, candidate)
    const unsafe = !candidate || !projection || projection.support !== 'terrain'
      || !floor || publicV43FamiliarTouchesUnrevealedCell(
        parent.state.discoveryMask, animal, candidateXZ)
      || Math.abs(projection.effective.floorY - animal.y) > MAX_GRADE + EPSILON
      || Math.abs(projection.effective.floorY - candidate.y) > EPSILON
      || publicV43FamiliarTouchesForbiddenSupport(parent.state.seed, animal,
        candidateXZ, parent.terrain.columns, parent.raisedSoilCells)
      || mireglassMoveBarrier(parent.state.seed, animal, candidateXZ) !== null
      || !publicV26ValleyRimPassage(parent.state.seed, animal, candidateXZ, []).ok
    familiar = unsafe ? { ...familiar, waitReason: 'unsafe_support' }
      : { ...familiar, position: candidate, waitReason: 'none' }
  }
  // The input overlay and returned V42 parent were checked. The only new fields
  // are a fixed wait enum or a terrain-supported, bounded position derived here.
  return { ...parent, familiar }
}

/** The V43 writer must prove V42 frame lineage and whole-batch jump validity
 * before passing one structurally checked, grounded prefix here. This function
 * cannot infer that history from two endpoints; it only derives the follower. */
export function advancePublicV43FamiliarFollower(beforeRaw: PublicV43FamiliarProgress,
  checkedGroundedV42AfterRaw: PublicV42RewardProgress): PublicV43FamiliarProgress | null {
  const before = decodePublicV43FamiliarProgress(beforeRaw)
  const after = decodePublicV42RewardProgress(checkedGroundedV42AfterRaw)
  return before && after ? advanceChecked(before, after) : null
}

/** Domain-only one-frame adapter for tests. A future V43 writer must retain
 * V42's whole-batch jump replay and pause following during flight. */
export function replayPublicV43FamiliarFrame(beforeRaw: PublicV43FamiliarProgress,
  rawFrame: unknown): PublicV43FamiliarProgress | null {
  const before = decodePublicV43FamiliarProgress(beforeRaw)
  const witness = decodePublicV14FrameWitness({ kind: 'frame-batch/v1', frames: [rawFrame] })
  if (!before || !witness) return null
  const parent = replayPublicV42Witness(before, witness)
  return parent ? advanceChecked(before, parent) : null
}
