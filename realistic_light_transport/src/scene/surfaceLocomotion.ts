import * as THREE from 'three'

import { REEF_ROCKS, REEF_SAND_Y, seededUnit } from './reefLayout'

export type SurfaceMode = 'sand' | 'sand_glass' | 'sand_rock' | 'glass_rock'

export interface SurfacePose {
  readonly position: THREE.Vector3
  readonly normal: THREE.Vector3
  readonly tangent: THREE.Vector3
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
  readonly rock: (typeof REEF_ROCKS)[number]
  readonly radiusScale: number
  readonly startAngle: number
  readonly endAngle: number
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

const GLASS_ROCK_SPECIES = new Set(['astrea_snail', 'turbo_snail', 'trochus_snail'])
const SAND_GLASS_SPECIES = new Set(['cerith_snail'])
const SAND_SPECIES = new Set(['nassarius_snail', 'fighting_conch'])

export function surfaceModeForSpecies(speciesId: string): SurfaceMode {
  if (GLASS_ROCK_SPECIES.has(speciesId)) return 'glass_rock'
  if (SAND_GLASS_SPECIES.has(speciesId)) return 'sand_glass'
  if (SAND_SPECIES.has(speciesId)) return 'sand'
  return 'sand_rock'
}

function line(kind: LineSegment['kind'], start: THREE.Vector3, end: THREE.Vector3,
  normal: THREE.Vector3): LineSegment {
  return { kind, start, end, normal, length: start.distanceTo(end) }
}

function rockPoint(segment: RockSegment, t: number, target: THREE.Vector3) {
  const angle = THREE.MathUtils.lerp(segment.startAngle, segment.endAngle, t)
  const { position, scale } = segment.rock
  return target.set(
    position.x + Math.cos(angle) * scale.x * segment.radiusScale,
    position.y + Math.sin(angle) * scale.y * segment.radiusScale,
    position.z,
  )
}

function rockArcLength(segment: Omit<RockSegment, 'length'>) {
  const previous = new THREE.Vector3()
  const current = new THREE.Vector3()
  rockPoint(segment as RockSegment, 0, previous)
  let length = 0
  for (let step = 1; step <= 24; step += 1) {
    rockPoint(segment as RockSegment, step / 24, current)
    length += current.distanceTo(previous)
    previous.copy(current)
  }
  return length
}

function createRockSegment(seed: number, sandY: number,
  rocks: readonly (typeof REEF_ROCKS)[number][]): RockSegment | undefined {
  const radiusScale = 1.035
  const eligible = rocks.filter((rock) =>
    Math.abs((sandY - rock.position.y) / (rock.scale.y * radiusScale)) < .96)
  const rock = eligible[Math.floor(seededUnit(seed, 711) * eligible.length)]
  if (!rock) return undefined
  const vertical = THREE.MathUtils.clamp(
    (sandY - rock.position.y) / (rock.scale.y * radiusScale), -.96, .96)
  const endAngle = Math.asin(vertical)
  const partial: Omit<RockSegment, 'length'> = {
    kind: 'rock', rock, radiusScale, startAngle: Math.PI - endAngle, endAngle,
  }
  return { ...partial, length: rockArcLength(partial) }
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
  rocks: readonly (typeof REEF_ROCKS)[number][] = REEF_ROCKS): SurfaceCircuit {
  const mode = surfaceModeForSpecies(speciesId)
  const width = Math.max(.4, Math.abs(halfWidth))
  const depth = Math.max(.3, Math.abs(halfDepth))
  const segments: SurfaceSegment[] = []
  const rock = mode.includes('rock') ? createRockSegment(seed, sandY, rocks) : undefined

  if (mode === 'sand') addSandLoop(segments, seed, width, depth, sandY)
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
    const angle = THREE.MathUtils.lerp(segment.startAngle, segment.endAngle, t)
    const angleDirection = Math.sign(segment.endAngle - segment.startAngle) || 1
    rockPoint(segment, t, target.position)
    target.normal.set(Math.cos(angle) / segment.rock.scale.x,
      Math.sin(angle) / segment.rock.scale.y, 0).normalize()
    target.tangent.set(-Math.sin(angle) * segment.rock.scale.x * angleDirection,
      Math.cos(angle) * segment.rock.scale.y * angleDirection, 0).normalize()
  }
  return target
}
