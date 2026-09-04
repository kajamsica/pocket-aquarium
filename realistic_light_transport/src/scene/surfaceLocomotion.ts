import * as THREE from 'three'

import {
  createLiveRockGeometry,
  createLiveRockSurfaceContour,
  LIVE_ROCK_SEED_OFFSET,
  type LiveRockSurfaceSample,
} from './liveRockGeometry'
import { REEF_ROCKS, REEF_SAND_Y, seededUnit, type ReefRock } from './reefLayout'

export type SurfaceMode = 'sand' | 'sand_glass' | 'sand_rock' | 'glass_rock' |
  'sand_burrow' | 'rock_station'

export const SURFACE_SPECIES_IDS = [
  'astrea_snail', 'blue_linckia', 'brittle_star', 'cerith_snail', 'cleaner_shrimp',
  'emerald_crab', 'fighting_conch', 'nassarius_snail', 'pistol_shrimp', 'scarlet_hermit',
  'trochus_snail', 'turbo_snail',
] as const

export type SurfaceSpeciesId = (typeof SURFACE_SPECIES_IDS)[number]

export interface SurfacePose {
  readonly position: THREE.Vector3
  readonly normal: THREE.Vector3
  readonly tangent: THREE.Vector3
}

export type ScapeSurfaceKind = 'sand' | 'rock'

export interface ScapeSupportSample {
  readonly position: THREE.Vector3
  readonly normal: THREE.Vector3
  readonly kind: ScapeSurfaceKind
  readonly distance: number
}

interface CachedRockSurface {
  readonly mesh: THREE.Mesh
  readonly normalMatrix: THREE.Matrix3
}

const SUPPORT_RAY_EPSILON = .002
const SUPPORT_NORMAL_PENALTY = .06
const SUPPORT_UP = new THREE.Vector3(0, 1, 0)
const supportRaycaster = new THREE.Raycaster()
const supportRayOrigin = new THREE.Vector3()
const supportRayDirection = new THREE.Vector3()
const supportRayOutward = new THREE.Vector3()
const supportPoint = new THREE.Vector3()
const supportNormal = new THREE.Vector3()
const supportHits: THREE.Intersection[] = []
const cachedRockSurfaces: CachedRockSurface[] = []
const cachedRockMeshes: THREE.Mesh[] = []
let cachedRockMaterial: THREE.MeshBasicMaterial | undefined
let rockPreparationScheduled = false

function prepareNextReefRockSurface() {
  const rockIndex = cachedRockSurfaces.length
  const rock = REEF_ROCKS[rockIndex]
  if (!rock) return
  cachedRockMaterial ??= new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(
    createLiveRockGeometry(rockIndex + LIVE_ROCK_SEED_OFFSET), cachedRockMaterial)
  mesh.position.copy(rock.position)
  mesh.rotation.copy(rock.rotation)
  mesh.scale.copy(rock.scale)
  mesh.updateMatrixWorld(true)
  cachedRockSurfaces.push({
    mesh,
    normalMatrix: new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld),
  })
  cachedRockMeshes.push(mesh)
}

function reefScapeSupportReady() {
  return cachedRockSurfaces.length === REEF_ROCKS.length
}

function scheduleNextReefRockSurface() {
  if (rockPreparationScheduled || reefScapeSupportReady()) return
  rockPreparationScheduled = true
  const prepareSlice = () => {
    rockPreparationScheduled = false
    prepareNextReefRockSurface()
    scheduleNextReefRockSurface()
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(prepareSlice, { timeout: 100 })
  } else window.setTimeout(prepareSlice, 0)
}

export function prepareReefScapeSupport(): void {
  if (typeof window !== 'undefined') {
    scheduleNextReefRockSurface()
    return
  }
  while (!reefScapeSupportReady()) prepareNextReefRockSurface()
}

/** Find the nearest exact rendered reef surface below a local starfish sample.
 * Sand remains analytic so an outer arm can settle onto it while the disc stays on rock. */
export function sampleReefScapeSupport(worldPoint: THREE.Vector3,
  preferredNormal: THREE.Vector3, maximumDistance: number,
  target: ScapeSupportSample = {
    position: new THREE.Vector3(), normal: new THREE.Vector3(), kind: 'sand', distance: 0,
  }): ScapeSupportSample {
  const output = target as {
    position: THREE.Vector3
    normal: THREE.Vector3
    kind: ScapeSurfaceKind
    distance: number
  }
  supportPoint.set(
    Number.isFinite(worldPoint.x) ? worldPoint.x : 0,
    Number.isFinite(worldPoint.y) ? worldPoint.y : REEF_SAND_Y,
    Number.isFinite(worldPoint.z) ? worldPoint.z : 0,
  )
  const limit = Number.isFinite(maximumDistance) ? Math.max(0, maximumDistance) : 0
  const sandDistance = Math.abs(supportPoint.y - REEF_SAND_Y)
  output.position.set(supportPoint.x, REEF_SAND_Y, supportPoint.z)
  output.normal.copy(SUPPORT_UP)
  output.kind = 'sand'
  output.distance = sandDistance

  supportNormal.copy(preferredNormal)
  if (!Number.isFinite(supportNormal.x) || !Number.isFinite(supportNormal.y)
    || !Number.isFinite(supportNormal.z) || supportNormal.lengthSq() < 1e-8) {
    supportNormal.copy(SUPPORT_UP)
  } else supportNormal.normalize()

  if (!reefScapeSupportReady()) {
    prepareReefScapeSupport()
    if (typeof window !== 'undefined') {
      output.position.copy(supportPoint)
      output.normal.copy(supportNormal)
      output.kind = 'sand'
      output.distance = Math.min(Number.MAX_VALUE,
        limit + Math.max(SUPPORT_RAY_EPSILON, limit * 1e-6))
      return target
    }
  }

  let bestScore = sandDistance <= limit
    ? sandDistance + limit * SUPPORT_NORMAL_PENALTY * (1 - Math.max(0, supportNormal.y))
    : Infinity
  if (limit <= 0) return target

  const rayCount = supportNormal.dot(SUPPORT_UP) < .985 ? 2 : 1
  for (let rayIndex = 0; rayIndex < rayCount; rayIndex += 1) {
    supportRayOutward.copy(rayIndex === 0 ? supportNormal : SUPPORT_UP)
    supportRayDirection.copy(supportRayOutward).negate()
    supportRayOrigin.copy(supportPoint).addScaledVector(supportRayOutward, SUPPORT_RAY_EPSILON)
    supportRaycaster.set(supportRayOrigin, supportRayDirection)
    supportRaycaster.near = 0
    supportRaycaster.far = limit + SUPPORT_RAY_EPSILON
    supportHits.length = 0
    supportRaycaster.intersectObjects(cachedRockMeshes, false, supportHits)
    for (const hit of supportHits) {
      const distance = hit.point.distanceTo(supportPoint)
      if (!Number.isFinite(distance) || distance > limit + 1e-6) continue
      const surface = cachedRockSurfaces.find(({ mesh }) => mesh === hit.object)
      if (!surface) continue
      const normal = hit.normal ?? hit.face?.normal
      if (normal) supportRayDirection.copy(normal).applyNormalMatrix(surface.normalMatrix).normalize()
      else supportRayDirection.copy(supportRayOutward)
      if (supportRayDirection.dot(supportRayOutward) < 0) supportRayDirection.negate()
      const alignment = Math.max(0, supportRayDirection.dot(supportNormal))
      const score = distance + limit * SUPPORT_NORMAL_PENALTY * (1 - alignment)
      if (score >= bestScore) continue
      bestScore = score
      output.position.copy(hit.point)
      output.normal.copy(supportRayDirection)
      output.kind = 'rock'
      output.distance = distance
    }
  }
  return target
}

interface LineSegment {
  readonly kind: 'sand' | 'glass'
  readonly start: THREE.Vector3
  readonly end: THREE.Vector3
  readonly normal: THREE.Vector3
  readonly length: number
}

interface RockSegment {
  readonly kind: 'rock'
  readonly rock: ReefRock
  readonly points: readonly THREE.Vector3[]
  readonly normals: readonly THREE.Vector3[]
  readonly distances: readonly number[]
  readonly length: number
}

type SurfaceSegment = LineSegment | RockSegment

export interface SurfaceCircuit {
  readonly speciesId: string
  readonly mode: SurfaceMode
  readonly seed: number
  readonly segments: readonly SurfaceSegment[]
  readonly totalLength: number
}

const SURFACE_MODES = {
  astrea_snail: 'glass_rock',
  blue_linckia: 'sand_rock',
  brittle_star: 'sand_rock',
  cerith_snail: 'sand_glass',
  cleaner_shrimp: 'rock_station',
  emerald_crab: 'sand_rock',
  fighting_conch: 'sand',
  nassarius_snail: 'sand',
  pistol_shrimp: 'sand_burrow',
  scarlet_hermit: 'sand_rock',
  trochus_snail: 'glass_rock',
  turbo_snail: 'glass_rock',
} as const satisfies Readonly<Record<SurfaceSpeciesId, SurfaceMode>>

export function surfaceModeForSpecies(speciesId: string): SurfaceMode {
  if (!isSurfaceSpeciesId(speciesId)) {
    throw new Error(`No surface locomotion mode for species: ${speciesId}`)
  }
  return SURFACE_MODES[speciesId]
}

export function isSurfaceSpeciesId(speciesId: string): speciesId is SurfaceSpeciesId {
  return Object.hasOwn(SURFACE_MODES, speciesId)
}

function line(kind: LineSegment['kind'], start: THREE.Vector3, end: THREE.Vector3,
  normal: THREE.Vector3): LineSegment {
  return { kind, start, end, normal, length: start.distanceTo(end) }
}

function rockPoint(segment: RockSegment, t: number, target: THREE.Vector3,
  normal?: THREE.Vector3, tangent?: THREE.Vector3) {
  const distance = THREE.MathUtils.clamp(t, 0, 1) * segment.length
  let index = 0
  while (index < segment.distances.length - 2 && segment.distances[index + 1] < distance) index += 1
  const span = segment.distances[index + 1] - segment.distances[index]
  const localT = span > 1e-8 ? (distance - segment.distances[index]) / span : 0
  target.lerpVectors(segment.points[index], segment.points[index + 1], localT)
  if (normal) normal.lerpVectors(segment.normals[index], segment.normals[index + 1], localT).normalize()
  if (tangent) tangent.copy(segment.points[index + 1]).sub(segment.points[index]).normalize()
  if (normal && tangent) normal.addScaledVector(tangent, -normal.dot(tangent)).normalize()
  return target
}

const rockContours = new WeakMap<object, Map<number, readonly LiveRockSurfaceSample[]>>()

function surfaceContourForRock(rock: ReefRock, rockIndex: number) {
  const seed = rockIndex + LIVE_ROCK_SEED_OFFSET
  let contours = rockContours.get(rock)
  if (!contours) {
    contours = new Map()
    rockContours.set(rock, contours)
  }
  let contour = contours.get(seed)
  if (!contour) {
    contour = createLiveRockSurfaceContour(seed, rock.position, rock.rotation, rock.scale)
    contours.set(seed, contour)
  }
  return contour
}

function crossingAtSand(a: LiveRockSurfaceSample, b: LiveRockSurfaceSample, sandY: number) {
  const span = b.position.y - a.position.y
  const t = Math.abs(span) > 1e-8
    ? THREE.MathUtils.clamp((sandY - a.position.y) / span, 0, 1)
    : 0
  const position = new THREE.Vector3().lerpVectors(a.position, b.position, t)
  position.y = sandY
  return { position, normal: new THREE.Vector3().lerpVectors(a.normal, b.normal, t).normalize() }
}

function clipRockContourToSand(contour: readonly LiveRockSurfaceSample[], sandY: number) {
  const topIndex = Math.floor((contour.length - 1) / 2)
  if (contour[topIndex].position.y < sandY) return undefined
  let start = topIndex
  let end = topIndex
  while (start > 0 && contour[start - 1].position.y >= sandY) start -= 1
  while (end < contour.length - 1 && contour[end + 1].position.y >= sandY) end += 1
  if (start === 0 || end === contour.length - 1) return undefined

  const clipped = [crossingAtSand(contour[start - 1], contour[start], sandY),
    ...contour.slice(start, end + 1), crossingAtSand(contour[end], contour[end + 1], sandY)]
  const points = clipped.map((sample) => sample.position)
  const normals = clipped.map((sample) => sample.normal)
  const distances = [0]
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + points[index].distanceTo(points[index - 1]))
  }
  return { points, normals, distances, length: distances[distances.length - 1] }
}

function createRockSegment(seed: number, sandY: number,
  rocks: readonly ReefRock[]): RockSegment | undefined {
  const radiusScale = 1.035
  const eligible = rocks.map((rock, index) => {
    const sharedIndex = REEF_ROCKS.indexOf(rock)
    return { rock, index: sharedIndex >= 0 ? sharedIndex : index }
  }).filter(({ rock }) => Math.abs(
    (sandY - rock.position.y) / (rock.scale.y * radiusScale)) < .96)
  const preferred = Math.floor(seededUnit(seed, 711) * eligible.length)
  for (let attempt = 0; attempt < eligible.length; attempt += 1) {
    const { rock, index } = eligible[(preferred + attempt) % eligible.length]
    const path = clipRockContourToSand(surfaceContourForRock(rock, index), sandY)
    if (path?.length) return { kind: 'rock', rock, ...path }
  }
  return undefined
}

function addSandLoop(segments: SurfaceSegment[], seed: number, halfWidth: number,
  halfDepth: number, sandY: number) {
  const xReach = halfWidth * (.58 + seededUnit(seed, 721) * .16)
  const back = halfDepth * (.5 + seededUnit(seed, 722) * .12)
  const front = halfDepth * (.78 + seededUnit(seed, 723) * .12)
  const points = [
    new THREE.Vector3(-xReach, sandY, back), new THREE.Vector3(xReach, sandY, back),
    new THREE.Vector3(xReach * .86, sandY, front), new THREE.Vector3(-xReach * .86, sandY, front),
  ]
  const wrap = points[3].clone().lerp(points[0], .5)
  const ordered = [wrap, ...points, wrap]
  for (let index = 0; index < ordered.length - 1; index += 1) {
    segments.push(line('sand', ordered[index], ordered[index + 1], new THREE.Vector3(0, 1, 0)))
  }
}

function createGlassExcursion(seed: number, halfWidth: number, halfDepth: number, sandY: number) {
  const wallZ = halfDepth
  const span = halfWidth * (.28 + seededUnit(seed, 731) * .12)
  const center = (seededUnit(seed, 732) - .5) * halfWidth * .55
  const left = THREE.MathUtils.clamp(center - span, -halfWidth * .86, halfWidth * .86)
  const right = THREE.MathUtils.clamp(center + span, -halfWidth * .86, halfWidth * .86)
  const height = sandY + .78 + seededUnit(seed, 733) * .58
  const baseA = new THREE.Vector3(left, sandY, wallZ)
  const topA = new THREE.Vector3(left, height, wallZ)
  const topB = new THREE.Vector3(right, height, wallZ)
  const baseB = new THREE.Vector3(right, sandY, wallZ)
  const inward = new THREE.Vector3(0, 0, -1)
  return { baseA, baseB, glass: [line('glass', baseA, topA, inward),
    line('glass', topA, topB, inward), line('glass', topB, baseB, inward)] }
}

export function createSurfaceCircuit(speciesId: string, seed: number, halfWidth = 2.76,
  halfDepth = 1.2, sandY = REEF_SAND_Y,
  rocks: readonly ReefRock[] = REEF_ROCKS): SurfaceCircuit {
  const mode = surfaceModeForSpecies(speciesId)
  const width = Math.max(.4, Math.abs(halfWidth))
  const depth = Math.max(.3, Math.abs(halfDepth))
  const segments: SurfaceSegment[] = []
  const rock = mode.includes('rock') ? createRockSegment(seed, sandY, rocks) : undefined

  if (mode === 'sand' || mode === 'sand_burrow') addSandLoop(segments, seed, width, depth, sandY)
  else if (mode === 'sand_glass') {
    const { baseA, baseB, glass } = createGlassExcursion(seed, width, depth, sandY)
    const inner = new THREE.Vector3(0, sandY, depth * .7)
    const wrap = baseB.clone().lerp(inner, .5)
    segments.push(line('sand', wrap, inner, new THREE.Vector3(0, 1, 0)),
      line('sand', inner, baseA, new THREE.Vector3(0, 1, 0)), ...glass,
      line('sand', baseB, wrap, new THREE.Vector3(0, 1, 0)))
  } else if (rock) {
    const start = rockPoint(rock, 0, new THREE.Vector3())
    const end = rockPoint(rock, 1, new THREE.Vector3())
    if (mode === 'glass_rock') {
      const { baseA, baseB, glass } = createGlassExcursion(seed, width, depth, sandY)
      const wrap = end.clone().lerp(baseA, .5)
      segments.push(line('sand', wrap, baseA, new THREE.Vector3(0, 1, 0)), ...glass,
        line('sand', baseB, start, new THREE.Vector3(0, 1, 0)), rock,
        line('sand', end, wrap, new THREE.Vector3(0, 1, 0)))
    } else {
      const front = new THREE.Vector3((seededUnit(seed, 741) - .5) * width, sandY, depth * .76)
      const wrap = end.clone().lerp(front, .5)
      segments.push(line('sand', wrap, front, new THREE.Vector3(0, 1, 0)),
        line('sand', front, start, new THREE.Vector3(0, 1, 0)), rock,
        line('sand', end, wrap, new THREE.Vector3(0, 1, 0)))
    }
  } else addSandLoop(segments, seed, width, depth, sandY)

  return { speciesId, mode, seed, segments, totalLength: segments.reduce((sum, segment) => sum + segment.length, 0) }
}

export function sampleSurfaceCircuit(circuit: SurfaceCircuit, progress: number,
  target: SurfacePose = {
    position: new THREE.Vector3(), normal: new THREE.Vector3(), tangent: new THREE.Vector3(),
  }): SurfacePose {
  const wrapped = THREE.MathUtils.euclideanModulo(Number.isFinite(progress) ? progress : 0, 1)
  let distance = wrapped * circuit.totalLength
  const segment = circuit.segments.find((candidate) => {
    if (distance <= candidate.length) return true
    distance -= candidate.length
    return false
  }) ?? circuit.segments[0]
  if (!segment) {
    target.position.set(0, REEF_SAND_Y, 0)
    target.normal.set(0, 1, 0)
    target.tangent.set(1, 0, 0)
    return target
  }
  const t = segment.length > 1e-8 ? THREE.MathUtils.clamp(distance / segment.length, 0, 1) : 0
  if (segment.kind !== 'rock') {
    target.position.lerpVectors(segment.start, segment.end, t)
    target.normal.copy(segment.normal).normalize()
    target.tangent.copy(segment.end).sub(segment.start).normalize()
  } else {
    rockPoint(segment, t, target.position, target.normal, target.tangent)
  }
  return target
}
