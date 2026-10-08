import { HIGHLAND_LANDMARK, highlandCorridorCells } from './highlandContent'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

type Point = Readonly<{ x: number; z: number }>

export const HIGHLAND_WIND_CONTENT_REVISION = 'highland-windward-step-v1' as const

/** 50 ms public-world ticks: 60 s active, 90 s cast-to-cast. Authority owns all commits. */
export const HIGHLAND_WINDWARD_STEP = Object.freeze({
  id: 'windward_step' as const,
  name: 'Windward Step',
  learnedAtLandmarkId: HIGHLAND_LANDMARK.id,
  durationTicks: 1200,
  cooldownTicks: 1800,
  speedMultiplier: 1.25,
  maxAssistedStepMeters: 0.2,
  trailHalfWidthMeters: 0.75,
})

export const HIGHLAND_WIND_SPELL_CATALOG = Object.freeze({
  [HIGHLAND_WINDWARD_STEP.id]: HIGHLAND_WINDWARD_STEP,
})

const route = highlandCorridorCells()
const trailStartIndex = route.findIndex(({ x, z }) => x === 96 && z === 0)
if (trailStartIndex < 0) throw new Error('Pinned Highland wind trail start is missing.')

export function isHighlandWindTrailSegmentIndex(index: unknown): index is number {
  return Number.isSafeInteger(index) && (index as number) >= trailStartIndex
    && (index as number) < route.length - 1
}

export type HighlandWindTrailLocation = Readonly<{
  segmentIndex: number
  routeMeters: number
  deviationMeters: number
}>

/** Nearest point on the authored dry trail, excluding the Greenway world connector. */
export function highlandWindTrailLocation(position: Point): HighlandWindTrailLocation | null {
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.z)) return null
  let nearest: HighlandWindTrailLocation | null = null
  for (let index = trailStartIndex; index < route.length - 1; index += 1) {
    const from = route[index]
    const to = route[index + 1]
    const dx = to.x - from.x
    const dz = to.z - from.z
    const fraction = ((position.x - from.x) * dx + (position.z - from.z) * dz)
      / (WORLD_CELL_METERS * WORLD_CELL_METERS)
    // Do not extend the first or last segment into a connector or un-authored terrain.
    if (fraction < 0 || fraction > 1) continue
    const deviationMeters = Math.hypot(position.x - from.x - fraction * dx,
      position.z - from.z - fraction * dz)
    if (deviationMeters > HIGHLAND_WINDWARD_STEP.trailHalfWidthMeters) continue
    if (!nearest || deviationMeters < nearest.deviationMeters
      || (deviationMeters === nearest.deviationMeters && index < nearest.segmentIndex)) {
      nearest = Object.freeze({ segmentIndex: index,
        routeMeters: (index + fraction) * WORLD_CELL_METERS, deviationMeters })
    }
  }
  return nearest
}

/** A bounded window that the authority may commit after its own learned/range/cooldown checks. */
export function highlandWindCastWindow(castTick: number): Readonly<{
  activeUntilTick: number; readyAtTick: number
}> | null {
  if (!Number.isSafeInteger(castTick) || castTick < 0
    || castTick > Number.MAX_SAFE_INTEGER - HIGHLAND_WINDWARD_STEP.cooldownTicks) return null
  return Object.freeze({ activeUntilTick: castTick + HIGHLAND_WINDWARD_STEP.durationTicks,
    readyAtTick: castTick + HIGHLAND_WINDWARD_STEP.cooldownTicks })
}

const gridAtWorld = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)
const dryAt = (seed: string, position: Point) => worldTileAtGrid(seed,
  gridAtWorld(position.x), gridAtWorld(position.z)).terrain !== 'wetland'

/** Geometry and terrain gate only. It cannot authorize or commit a move. */
export function isHighlandWindWestboundTrailStep(seed: string, from: Point, to: Point): boolean {
  if (typeof seed !== 'string' || !Number.isFinite(from?.x) || !Number.isFinite(from?.z)
    || !Number.isFinite(to?.x) || !Number.isFinite(to?.z)) return false
  const distance = Math.hypot(to.x - from.x, to.z - from.z)
  if (distance <= 0 || distance > HIGHLAND_WINDWARD_STEP.maxAssistedStepMeters + 1e-9) return false
  const middle = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 }
  const start = highlandWindTrailLocation(from)
  const midpoint = highlandWindTrailLocation(middle)
  const end = highlandWindTrailLocation(to)
  if (!start || !midpoint || !end || start.routeMeters <= end.routeMeters
    || start.routeMeters < midpoint.routeMeters || midpoint.routeMeters < end.routeMeters) return false
  if (mireglassMoveBarrier(seed, from, to) !== null) return false
  return dryAt(seed, from) && dryAt(seed, middle) && dryAt(seed, to)
}

/** The caller must pass the committed movement result, never a client claim. */
export function highlandWindAssistMultiplier(input: Readonly<{
  seed: string
  from: Point
  to: Point
  spellActive: boolean
  onFoot: boolean
  movementAccepted: boolean
}>): number {
  return input.spellActive === true && input.onFoot === true && input.movementAccepted === true
    && isHighlandWindWestboundTrailStep(input.seed, input.from, input.to)
    ? HIGHLAND_WINDWARD_STEP.speedMultiplier : 1
}
