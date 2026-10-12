import { publicV25RiverCenterZ } from './publicWorldV25River'
import { starterCliffCanonicalFace } from './starterCliffProfile'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

export const PUBLIC_V26_VALLEY_RIM_PROFILE = 'physical-starter-valley/v1' as const

type Point = Readonly<{ x: number; z: number }>
export type PublicV26LadderSpan = Readonly<{ x: number; widthMeters: number }>
export type PublicV26ValleyRimSegment = Readonly<{
  id: string
  kind: 'cliff' | 'rock-return'
  from: Point
  to: Point
  ladderAperture?: true
}>

const NORTH_Z = -6
const WEST_X = -30
const EAST_X = 30
const gridAt = (coordinate: number) => Math.ceil(coordinate / WORLD_CELL_METERS - 0.5)

function aperturesFor(seed: string, spans: readonly PublicV26LadderSpan[]): [number, number][] | null {
  const maxWidth = starterCliffCanonicalFace(seed).width
  if (!Array.isArray(spans) || spans.length > 64) return null
  const intervals: [number, number][] = []
  for (const span of spans) {
    if (!span || !Number.isFinite(span.x) || !Number.isFinite(span.widthMeters)
      || span.widthMeters <= 0 || span.widthMeters > maxWidth) return null
    const low = Math.max(WEST_X, span.x - span.widthMeters / 2)
    const high = Math.min(EAST_X, span.x + span.widthMeters / 2)
    if (low < high) intervals.push([low, high])
  }
  intervals.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [low, high] of intervals) {
    const last = merged[merged.length - 1]
    if (last && low <= last[1]) last[1] = Math.max(last[1], high)
    else merged.push([low, high])
  }
  return merged
}

/** One physical boundary shared by a future wall mesh and the checked passage gate. */
export function publicV26ValleyRimSegments(seed: string,
  validatedLadders: readonly PublicV26LadderSpan[]): readonly PublicV26ValleyRimSegment[] {
  const westRiverZ = publicV25RiverCenterZ(seed, gridAt(WEST_X)) * WORLD_CELL_METERS
  const eastRiverZ = publicV25RiverCenterZ(seed, gridAt(EAST_X)) * WORLD_CELL_METERS
  // Bad presentation data never opens an unearned gap in the physical wall.
  const apertures = aperturesFor(seed, validatedLadders) ?? []
  const north: PublicV26ValleyRimSegment[] = []
  let cursor = WEST_X
  for (const [low, high] of apertures) {
    if (cursor < low) north.push({ id: `north-wall-${north.length}`, kind: 'cliff',
      from: { x: cursor, z: NORTH_Z }, to: { x: low, z: NORTH_Z } })
    north.push({ id: `north-aperture-${north.length}`, kind: 'cliff', ladderAperture: true,
      from: { x: low, z: NORTH_Z }, to: { x: high, z: NORTH_Z } })
    cursor = high
  }
  if (cursor < EAST_X) north.push({ id: `north-wall-${north.length}`, kind: 'cliff',
    from: { x: cursor, z: NORTH_Z }, to: { x: EAST_X, z: NORTH_Z } })
  return [
    ...north,
    { id: 'west-return', kind: 'rock-return', from: { x: WEST_X, z: NORTH_Z },
      to: { x: WEST_X, z: westRiverZ } },
    { id: 'east-return', kind: 'rock-return', from: { x: EAST_X, z: NORTH_Z },
      to: { x: EAST_X, z: eastRiverZ } },
  ]
}

/** Inclusive contact keeps the north/side joints sealed, including a fast diagonal step. */
function touchesSegment(from: Point, to: Point, wall: PublicV26ValleyRimSegment): boolean {
  if (wall.from.z === wall.to.z) {
    const z = wall.from.z, low = Math.min(wall.from.x, wall.to.x)
    const high = Math.max(wall.from.x, wall.to.x)
    if (from.z === to.z) return from.z === z
      && Math.max(Math.min(from.x, to.x), low) <= Math.min(Math.max(from.x, to.x), high)
    const t = (z - from.z) / (to.z - from.z)
    const x = from.x + t * (to.x - from.x)
    return t >= 0 && t <= 1 && x >= low && x <= high
  }
  const x = wall.from.x, low = Math.min(wall.from.z, wall.to.z)
  const high = Math.max(wall.from.z, wall.to.z)
  if (from.x === to.x) return from.x === x
    && Math.max(Math.min(from.z, to.z), low) <= Math.min(Math.max(from.z, to.z), high)
  const t = (x - from.x) / (to.x - from.x)
  const z = from.z + t * (to.z - from.z)
  return t >= 0 && t <= 1 && z >= low && z <= high
}

type Passage = { ok: true } | { ok: false; reason: 'cliff-needs-ladder' | 'rock-return-blocked' | 'invalid-segment' }

/** The writer derives these spans from validated saved ladders, never client input. */
export function publicV26ValleyRimPassage(seed: string, from: Point, to: Point,
  validatedLadders: readonly PublicV26LadderSpan[]): Passage {
  const valid = (point: Point) => point && Number.isFinite(point.x) && Number.isFinite(point.z)
    && [gridAt(point.x), gridAt(point.z)].every((grid) => grid >= WORLD_GRID_MIN && grid <= WORLD_GRID_MAX)
  if (!valid(from) || !valid(to)) {
    return { ok: false, reason: 'invalid-segment' }
  }
  try {
    if (!aperturesFor(seed, validatedLadders)) return { ok: false, reason: 'invalid-segment' }
    for (const wall of publicV26ValleyRimSegments(seed, validatedLadders)) {
      if (wall.ladderAperture) continue
      if (touchesSegment(from, to, wall)) return { ok: false,
        reason: wall.kind === 'cliff' ? 'cliff-needs-ladder' : 'rock-return-blocked' }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'invalid-segment' }
  }
}
