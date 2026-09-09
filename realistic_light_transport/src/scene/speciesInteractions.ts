import * as THREE from 'three'

import { REEF_ROCKS, REEF_SAND_Y, seededUnit } from './reefLayout'

const TANK_HALF_WIDTH = 2.76
const TANK_HALF_DEPTH = 1.2
const ROCK_PAD = 1.2

export interface InteractionAnimal {
  readonly id: number
  readonly speciesId: string
  readonly isFish: boolean
  readonly position: THREE.Vector3
  readonly velocity: THREE.Vector3
}

export interface DiamondGobySiftCycle {
  readonly siftSeconds: number
  readonly restSeconds: number
  readonly phaseOffsetSeconds: number
  readonly siftRadius: number
}

export type DiamondGobyHabitatMode =
  'sand_hold' | 'sand_sift' | 'sand_transfer' | 'rock_excursion'

export interface BurrowSite {
  readonly position: THREE.Vector3
  readonly entranceDirection: THREE.Vector3
  readonly watchmanGuardOffset: THREE.Vector3
  readonly pistolMaintenanceOffset: THREE.Vector3
  readonly siftCycle: DiamondGobySiftCycle | null
}

export interface CleaningStation {
  readonly rockIndex: number
  readonly position: THREE.Vector3
  readonly normal: THREE.Vector3
  readonly approachPosition: THREE.Vector3
  readonly servicePosition: THREE.Vector3
  readonly departurePosition: THREE.Vector3
  readonly scheduleSeed: number
  readonly phaseOffsetSeconds: number
}

export type CleaningVisitPhase = 'idle' | 'approach' | 'service' | 'depart'

export interface CleaningVisitIntent {
  readonly clientId: number | null
  readonly phase: CleaningVisitPhase
  readonly phaseProgress: number
  readonly targetPosition: THREE.Vector3
  readonly blend: number
  readonly paceMultiplier: number
}

const FRONT_BURROW_POSITIONS = [
  [-2.28, 1.06],
  [.82, 1.08],
  [2.28, 1.06],
] as const

function outsidePaddedRocksAt(x: number, y: number, z: number, clearance = .16) {
  return REEF_ROCKS.every((rock) => {
    const nx = (x - rock.position.x) / (rock.scale.x * ROCK_PAD + clearance)
    const ny = (y - rock.position.y) / (rock.scale.y * ROCK_PAD + clearance)
    const nz = (z - rock.position.z) / (rock.scale.z * ROCK_PAD + clearance)
    return nx * nx + ny * ny + nz * nz >= 1
  })
}

function outsidePaddedRocks(position: THREE.Vector3, clearance = .16) {
  return outsidePaddedRocksAt(position.x, position.y, position.z, clearance)
}

function visibleBurrowPositions() {
  return FRONT_BURROW_POSITIONS
    .map(([x, z]) => new THREE.Vector3(x, REEF_SAND_Y + .025, z))
    .filter((position) => outsidePaddedRocks(position))
}

/** One species-stable entrance is shared by every Watchman Goby and Pistol Shrimp. */
export function sharedBurrowSite(): BurrowSite {
  const candidates = visibleBurrowPositions()
  const position = candidates[Math.floor(seededUnit(0, 601) * candidates.length)]?.clone()
    ?? new THREE.Vector3(TANK_HALF_WIDTH - .48, REEF_SAND_Y + .025, TANK_HALF_DEPTH - .14)
  return {
    position,
    entranceDirection: new THREE.Vector3(0, 0, 1),
    watchmanGuardOffset: new THREE.Vector3(.2, .12, .04),
    pistolMaintenanceOffset: new THREE.Vector3(-.13, .045, .07),
    siftCycle: null,
  }
}

function frontRockIndices() {
  return REEF_ROCKS.map((rock, index) => ({ index, z: rock.position.z }))
    .filter(({ index, z }) => z > .18 && Math.abs(REEF_ROCKS[index].position.x) < 2.15)
    .sort((a, b) => b.z - a.z)
    .map(({ index }) => index)
}

function sandPositionAtRockEdge(rockIndex: number, seed: number) {
  const rock = REEF_ROCKS[rockIndex]
  const angle = (seededUnit(seed + rockIndex, 611) - .5) * .8
  const position = new THREE.Vector3(
    rock.position.x + Math.sin(angle) * (rock.scale.x * ROCK_PAD + .2),
    REEF_SAND_Y + .025,
    rock.position.z + Math.cos(angle) * (rock.scale.z * ROCK_PAD + .2),
  )
  position.x = THREE.MathUtils.clamp(position.x, -TANK_HALF_WIDTH + .28, TANK_HALF_WIDTH - .28)
  position.z = THREE.MathUtils.clamp(position.z, .48, TANK_HALF_DEPTH - .12)
  return position
}

/** A separate rock-edge home plus deterministic forage/rest timing for the Diamond Goby. */
export function diamondGobyBurrowSite(seed = 0): BurrowSite {
  const sharedPosition = sharedBurrowSite().position
  const candidates = frontRockIndices().map((index) => sandPositionAtRockEdge(index, seed))
  const position = candidates.find((candidate) => candidate.distanceTo(sharedPosition) >= .72 &&
    outsidePaddedRocks(candidate, .08))?.clone() ?? visibleBurrowPositions()
    .find((candidate) => candidate.distanceTo(sharedPosition) >= .72)?.clone()
    ?? new THREE.Vector3(-TANK_HALF_WIDTH + .48, REEF_SAND_Y + .025, TANK_HALF_DEPTH - .14)
  const siftSeconds = 13 + seededUnit(seed, 612) * 5
  const restSeconds = 7 + seededUnit(seed, 613) * 4
  return {
    position,
    entranceDirection: new THREE.Vector3(0, 0, 1),
    watchmanGuardOffset: new THREE.Vector3(),
    pistolMaintenanceOffset: new THREE.Vector3(),
    siftCycle: {
      siftSeconds,
      restSeconds,
      phaseOffsetSeconds: seededUnit(seed, 614) * (siftSeconds + restSeconds),
      siftRadius: .48 + seededUnit(seed, 615) * .18,
    },
  }
}

type DiamondGobySandStation = readonly [x: number, z: number]
type DiamondGobySandCircuit = readonly [
  front: DiamondGobySandStation,
  middle: DiamondGobySandStation,
  back: DiamondGobySandStation,
]

const DIAMOND_GOBY_SAND_Y = REEF_SAND_Y + .08
const DIAMOND_GOBY_CLEARANCE = .08
const DIAMOND_GOBY_SCHEDULE_SECONDS = 120
const DIAMOND_GOBY_EXCURSION_SECONDS = 6
const DIAMOND_GOBY_LEG_SECONDS = 28.5
const DIAMOND_GOBY_HOLD_SECONDS = 20.5
const DIAMOND_GOBY_SIFT_SECONDS = 5.5
const DIAMOND_GOBY_ROUTE = [0, 1, 2, 1] as const
const DIAMOND_GOBY_SAND_CIRCUITS: readonly DiamondGobySandCircuit[] = [
  [[1.35, .94], [2.48, .05], [2.48, -.92]],
  [[1.75, .94], [2.46, .15], [2.48, -.96]],
  [[2.15, .94], [2.48, -.05], [2.48, -1]],
]

function outsidePaddedRockFootprints(x: number, z: number) {
  return REEF_ROCKS.every((rock) => {
    const nx = (x - rock.position.x) / (rock.scale.x * ROCK_PAD + DIAMOND_GOBY_CLEARANCE)
    const nz = (z - rock.position.z) / (rock.scale.z * ROCK_PAD + DIAMOND_GOBY_CLEARANCE)
    return nx * nx + nz * nz >= 1
  })
}

function horizontalCorridorIsClear(ax: number, az: number, bx: number, bz: number) {
  for (const rock of REEF_ROCKS) {
    const rx = rock.scale.x * ROCK_PAD + DIAMOND_GOBY_CLEARANCE
    const rz = rock.scale.z * ROCK_PAD + DIAMOND_GOBY_CLEARANCE
    const startX = (ax - rock.position.x) / rx
    const startZ = (az - rock.position.z) / rz
    const dx = (bx - ax) / rx
    const dz = (bz - az) / rz
    const span = dx * dx + dz * dz
    const closest = span > 1e-8
      ? THREE.MathUtils.clamp(-(startX * dx + startZ * dz) / span, 0, 1) : 0
    const x = startX + dx * closest
    const z = startZ + dz * closest
    if (x * x + z * z < 1) return false
  }
  return true
}

function safeDiamondGobyCircuit(circuit: DiamondGobySandCircuit) {
  return circuit.every(([x, z]) => outsidePaddedRockFootprints(x, z)) &&
    horizontalCorridorIsClear(circuit[0][0], circuit[0][1], circuit[1][0], circuit[1][1]) &&
    horizontalCorridorIsClear(circuit[1][0], circuit[1][1], circuit[2][0], circuit[2][1])
}

const SAFE_DIAMOND_GOBY_CIRCUITS = DIAMOND_GOBY_SAND_CIRCUITS.filter(safeDiamondGobyCircuit)

function corridorOutsidePaddedRocks(a: DiamondGobySandStation, b: readonly [number, number, number]) {
  for (const rock of REEF_ROCKS) {
    const rx = rock.scale.x * ROCK_PAD + DIAMOND_GOBY_CLEARANCE
    const ry = rock.scale.y * ROCK_PAD + DIAMOND_GOBY_CLEARANCE
    const rz = rock.scale.z * ROCK_PAD + DIAMOND_GOBY_CLEARANCE
    const startX = (a[0] - rock.position.x) / rx
    const startY = (DIAMOND_GOBY_SAND_Y - rock.position.y) / ry
    const startZ = (a[1] - rock.position.z) / rz
    const dx = (b[0] - a[0]) / rx
    const dy = (b[1] - DIAMOND_GOBY_SAND_Y) / ry
    const dz = (b[2] - a[1]) / rz
    const span = dx * dx + dy * dy + dz * dz
    const closest = span > 1e-8
      ? THREE.MathUtils.clamp(-(startX * dx + startY * dy + startZ * dz) / span, 0, 1) : 0
    const x = startX + dx * closest
    const y = startY + dy * closest
    const z = startZ + dz * closest
    if (x * x + y * y + z * z < 1) return false
  }
  return true
}

function diamondGobyRockPerches() {
  const perches: Array<readonly [number, number, number]> = []
  for (const rock of REEF_ROCKS) {
    const angle = Math.atan2(.94 - rock.position.z, 1.75 - rock.position.x)
    const up = .68
    const horizontal = Math.sqrt(1 - up * up)
    const candidate = [
      rock.position.x + Math.cos(angle) * horizontal * (rock.scale.x * ROCK_PAD + .12) * 1.06,
      rock.position.y + up * (rock.scale.y * ROCK_PAD + .12) * 1.06,
      rock.position.z + Math.sin(angle) * horizontal * (rock.scale.z * ROCK_PAD + .12) * 1.06,
    ] as const
    if (Math.abs(candidate[0]) > TANK_HALF_WIDTH - .28 || Math.abs(candidate[2]) > TANK_HALF_DEPTH - .16 ||
      !outsidePaddedRocksAt(candidate[0], candidate[1], candidate[2], DIAMOND_GOBY_CLEARANCE) ||
      !SAFE_DIAMOND_GOBY_CIRCUITS.every((circuit) => corridorOutsidePaddedRocks(circuit[0], candidate))) continue
    perches.push(candidate)
  }
  return perches
}

const DIAMOND_GOBY_ROCK_PERCHES = diamondGobyRockPerches()

function setDiamondGobySiftTarget(station: DiamondGobySandStation, seed: number,
  progress: number, target: THREE.Vector3) {
  const baseAngle = seededUnit(seed, 674) * Math.PI * 2
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const angle = baseAngle + attempt * Math.PI * .62
    const endX = station[0] + Math.cos(angle) * .055
    const endZ = station[1] + Math.sin(angle) * .055
    if (Math.abs(endX) <= TANK_HALF_WIDTH - .28 && Math.abs(endZ) <= TANK_HALF_DEPTH - .16 &&
      outsidePaddedRockFootprints(endX, endZ) &&
      horizontalCorridorIsClear(station[0], station[1], endX, endZ)) {
      const radius = Math.sin(progress * Math.PI) * .055
      target.set(station[0] + Math.cos(angle) * radius, DIAMOND_GOBY_SAND_Y,
        station[1] + Math.sin(angle) * radius)
      return
    }
  }
  target.set(station[0], DIAMOND_GOBY_SAND_Y, station[1])
}

/** Deterministic habitat target: 95% connected sand residency and 5% low rock excursions. */
export function sampleDiamondGobyHabitatTarget(seed: number, elapsedSeconds: number,
  target: THREE.Vector3): DiamondGobyHabitatMode {
  const stableSeed = Number.isFinite(seed) ? Math.floor(seed) : 0
  const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0)
  const scheduled = elapsed + seededUnit(stableSeed, 671) * DIAMOND_GOBY_SCHEDULE_SECONDS
  const cycleNumber = Math.floor(scheduled / DIAMOND_GOBY_SCHEDULE_SECONDS)
  const cycleTime = scheduled % DIAMOND_GOBY_SCHEDULE_SECONDS
  const circuit = SAFE_DIAMOND_GOBY_CIRCUITS[
    Math.floor(seededUnit(stableSeed, 672) * SAFE_DIAMOND_GOBY_CIRCUITS.length)]
    ?? DIAMOND_GOBY_SAND_CIRCUITS.find(safeDiamondGobyCircuit)

  if (!circuit) {
    for (const candidate of DIAMOND_GOBY_SAND_CIRCUITS) {
      if (outsidePaddedRockFootprints(candidate[0][0], candidate[0][1]) &&
        horizontalCorridorIsClear(candidate[0][0], candidate[0][1], candidate[1][0], candidate[1][1])) {
        target.set(candidate[0][0], DIAMOND_GOBY_SAND_Y, candidate[0][1])
        return 'sand_hold'
      }
    }
    target.set(TANK_HALF_WIDTH - .28, DIAMOND_GOBY_SAND_Y, TANK_HALF_DEPTH - .16)
    return 'sand_hold'
  }

  const sandSeconds = DIAMOND_GOBY_SCHEDULE_SECONDS - DIAMOND_GOBY_EXCURSION_SECONDS
  if (cycleTime >= sandSeconds) {
    const perch = DIAMOND_GOBY_ROCK_PERCHES[
      Math.floor(seededUnit(stableSeed + cycleNumber, 673) * DIAMOND_GOBY_ROCK_PERCHES.length)]
    if (!perch) {
      target.set(circuit[0][0], DIAMOND_GOBY_SAND_Y, circuit[0][1])
      return 'sand_hold'
    }
    const excursion = (cycleTime - sandSeconds) / DIAMOND_GOBY_EXCURSION_SECONDS
    const blend = excursion < .35 ? smoothProgress(excursion / .35)
      : excursion > .7 ? smoothProgress((1 - excursion) / .3) : 1
    target.set(THREE.MathUtils.lerp(circuit[0][0], perch[0], blend),
      THREE.MathUtils.lerp(DIAMOND_GOBY_SAND_Y, perch[1], blend),
      THREE.MathUtils.lerp(circuit[0][1], perch[2], blend))
    return 'rock_excursion'
  }

  const leg = Math.min(DIAMOND_GOBY_ROUTE.length - 1, Math.floor(cycleTime / DIAMOND_GOBY_LEG_SECONDS))
  const legTime = cycleTime - leg * DIAMOND_GOBY_LEG_SECONDS
  const station = circuit[DIAMOND_GOBY_ROUTE[leg]]
  const next = circuit[DIAMOND_GOBY_ROUTE[(leg + 1) % DIAMOND_GOBY_ROUTE.length]]
  if (legTime < DIAMOND_GOBY_HOLD_SECONDS) {
    target.set(station[0], DIAMOND_GOBY_SAND_Y, station[1])
    return 'sand_hold'
  }
  if (legTime < DIAMOND_GOBY_HOLD_SECONDS + DIAMOND_GOBY_SIFT_SECONDS) {
    setDiamondGobySiftTarget(station, stableSeed + cycleNumber * 4 + leg,
      (legTime - DIAMOND_GOBY_HOLD_SECONDS) / DIAMOND_GOBY_SIFT_SECONDS, target)
    return 'sand_sift'
  }
  const progress = smoothProgress((legTime - DIAMOND_GOBY_HOLD_SECONDS - DIAMOND_GOBY_SIFT_SECONDS) /
    (DIAMOND_GOBY_LEG_SECONDS - DIAMOND_GOBY_HOLD_SECONDS - DIAMOND_GOBY_SIFT_SECONDS))
  target.set(THREE.MathUtils.lerp(station[0], next[0], progress), DIAMOND_GOBY_SAND_Y,
    THREE.MathUtils.lerp(station[1], next[1], progress))
  return 'sand_transfer'
}

function frontRockSurface(rockIndex: number) {
  const rock = REEF_ROCKS[rockIndex]
  const radial = new THREE.Vector3(0, .42, .91).normalize()
  const position = rock.position.clone().add(new THREE.Vector3(
    radial.x * rock.scale.x, radial.y * rock.scale.y, radial.z * rock.scale.z,
  ))
  const normal = new THREE.Vector3(
    radial.x / rock.scale.x, radial.y / rock.scale.y, radial.z / rock.scale.z,
  ).normalize()
  return { position, normal }
}

function clampFishTarget(position: THREE.Vector3) {
  position.x = THREE.MathUtils.clamp(position.x, -TANK_HALF_WIDTH + .3, TANK_HALF_WIDTH - .3)
  position.z = THREE.MathUtils.clamp(position.z, -TANK_HALF_DEPTH + .24, TANK_HALF_DEPTH - .24)
  return position
}

/** Pick a seeded, camera-visible live-rock face for the cleaner's persistent station. */
export function cleaningStation(seed = 0): CleaningStation {
  const indices = frontRockIndices()
  const rockIndex = indices[Math.floor(seededUnit(seed, 621) * indices.length)] ?? 0
  const surface = frontRockSurface(rockIndex)
  const servicePosition = clampFishTarget(surface.position.clone().addScaledVector(surface.normal, .3))
  const side = seededUnit(seed, 622) < .5 ? -1 : 1
  return {
    rockIndex,
    position: surface.position,
    normal: surface.normal,
    approachPosition: clampFishTarget(servicePosition.clone().add(new THREE.Vector3(-side * .62, .1, -.26))),
    servicePosition,
    departurePosition: clampFishTarget(servicePosition.clone().add(new THREE.Vector3(side * .72, .12, -.18))),
    scheduleSeed: seed,
    phaseOffsetSeconds: seededUnit(seed, 623) * 28,
  }
}

function smoothProgress(value: number) {
  const bounded = THREE.MathUtils.clamp(value, 0, 1)
  return bounded * bounded * (3 - 2 * bounded)
}

/** Pure attraction intent. The existing renderer remains responsible for capped travel and turns. */
export function cleaningVisitIntent(elapsedSeconds: number, station: CleaningStation,
  animals: readonly InteractionAnimal[]): CleaningVisitIntent {
  const clients = animals.filter((animal) => animal.isFish).sort((a, b) => a.id - b.id)
  const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0) + station.phaseOffsetSeconds
  const cycleNumber = Math.floor(elapsed / 28)
  const cycleTime = elapsed % 28
  const client = clients[Math.floor(seededUnit(station.scheduleSeed + cycleNumber, 631) * clients.length)]
  if (!client || cycleTime < 9) return {
    clientId: null, phase: 'idle', phaseProgress: cycleTime / 9,
    targetPosition: station.approachPosition.clone(), blend: 0, paceMultiplier: 1,
  }
  if (cycleTime < 15) {
    const progress = smoothProgress((cycleTime - 9) / 6)
    return { clientId: client.id, phase: 'approach', phaseProgress: progress,
      targetPosition: station.approachPosition.clone().lerp(station.servicePosition, progress),
      blend: progress, paceMultiplier: THREE.MathUtils.lerp(1, .18, progress) }
  }
  if (cycleTime < 21) return {
    clientId: client.id, phase: 'service', phaseProgress: (cycleTime - 15) / 6,
    targetPosition: station.servicePosition.clone(), blend: 1, paceMultiplier: .18,
  }
  const progress = smoothProgress((cycleTime - 21) / 7)
  return { clientId: client.id, phase: 'depart', phaseProgress: progress,
    targetPosition: station.servicePosition.clone().lerp(station.departurePosition, progress),
    blend: 1 - progress, paceMultiplier: THREE.MathUtils.lerp(.18, 1, progress) }
}
