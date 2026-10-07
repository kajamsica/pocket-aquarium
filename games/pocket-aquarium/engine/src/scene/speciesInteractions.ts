import * as THREE from 'three'

import { REEF_ROCKS, REEF_SAND_Y, seededUnit, type ReefRock } from './reefLayout'

const TANK_HALF_WIDTH = 2.76
const TANK_HALF_DEPTH = 1.2
const ROCK_PAD = 1.2

export interface InteractionAnimal {
  readonly id: number
  readonly speciesId: string
  readonly isFish: boolean
  readonly alive: boolean
  readonly parasiteLoad: number
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
  readonly rockId: number | null
  readonly position: THREE.Vector3
  readonly entranceDirection: THREE.Vector3
  readonly watchmanGuardOffset: THREE.Vector3
  readonly pistolMaintenanceOffset: THREE.Vector3
  readonly siftCycle: DiamondGobySiftCycle | null
}

export interface CleaningStation {
  readonly rockId: number
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
export const CLEANING_SERVICE_CONTACT_RADIUS = .2
const CLEANING_STATION_UNITS_PER_GAME_HOUR = 28 / 8

export interface CleaningVisitIntent {
  readonly cycleNumber: number
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

function outsidePaddedRocksAt(x: number, y: number, z: number,
  rocks: readonly ReefRock[], clearance = .16) {
  return rocks.every((rock) => {
    const nx = (x - rock.position.x) / (rock.scale.x * ROCK_PAD + clearance)
    const ny = (y - rock.position.y) / (rock.scale.y * ROCK_PAD + clearance)
    const nz = (z - rock.position.z) / (rock.scale.z * ROCK_PAD + clearance)
    return nx * nx + ny * ny + nz * nz >= 1
  })
}

function outsidePaddedRocks(position: THREE.Vector3, rocks: readonly ReefRock[], clearance = .16) {
  return outsidePaddedRocksAt(position.x, position.y, position.z, rocks, clearance)
}

function visibleBurrowPositions(rocks: readonly ReefRock[]) {
  return FRONT_BURROW_POSITIONS
    .map(([x, z]) => new THREE.Vector3(x, REEF_SAND_Y + .025, z))
    .filter((position) => outsidePaddedRocks(position, rocks))
}

/** One species-stable entrance is shared by every Watchman Goby and Pistol Shrimp. */
export function sharedBurrowSite(rocks: readonly ReefRock[] = REEF_ROCKS): BurrowSite {
  const candidates = visibleBurrowPositions(rocks)
  const position = candidates[Math.floor(seededUnit(0, 601) * candidates.length)]?.clone()
    ?? new THREE.Vector3(TANK_HALF_WIDTH - .48, REEF_SAND_Y + .025, TANK_HALF_DEPTH - .14)
  return {
    rockId: null,
    position,
    entranceDirection: new THREE.Vector3(0, 0, 1),
    watchmanGuardOffset: new THREE.Vector3(.2, .12, .04),
    pistolMaintenanceOffset: new THREE.Vector3(-.13, .045, .07),
    siftCycle: null,
  }
}

function frontRockIndices(rocks: readonly ReefRock[]) {
  return rocks.map((rock, index) => ({ index, z: rock.position.z }))
    .filter(({ index, z }) => z > .18 && Math.abs(rocks[index].position.x) < 2.15)
    .sort((a, b) => b.z - a.z)
    .map(({ index }) => index)
}

function sandPositionAtRockEdge(rockIndex: number, seed: number, rocks: readonly ReefRock[]) {
  const rock = rocks[rockIndex]
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
export function diamondGobyBurrowSite(seed = 0, rocks: readonly ReefRock[] = REEF_ROCKS): BurrowSite {
  const sharedPosition = sharedBurrowSite(rocks).position
  const candidates = frontRockIndices(rocks).map((index) => ({ index,
    position: sandPositionAtRockEdge(index, seed, rocks) }))
  const selected = candidates.find((candidate) => candidate.position.distanceTo(sharedPosition) >= .72 &&
    outsidePaddedRocks(candidate.position, rocks, .08))
  const position = selected?.position.clone() ?? visibleBurrowPositions(rocks)
    .find((candidate) => candidate.distanceTo(sharedPosition) >= .72)?.clone()
    ?? new THREE.Vector3(-TANK_HALF_WIDTH + .48, REEF_SAND_Y + .025, TANK_HALF_DEPTH - .14)
  const siftSeconds = 13 + seededUnit(seed, 612) * 5
  const restSeconds = 7 + seededUnit(seed, 613) * 4
  return {
    rockId: selected ? rocks[selected.index].id : null,
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

function outsidePaddedRockFootprints(x: number, z: number, rocks: readonly ReefRock[]) {
  return rocks.every((rock) => {
    const nx = (x - rock.position.x) / (rock.scale.x * ROCK_PAD + DIAMOND_GOBY_CLEARANCE)
    const nz = (z - rock.position.z) / (rock.scale.z * ROCK_PAD + DIAMOND_GOBY_CLEARANCE)
    return nx * nx + nz * nz >= 1
  })
}

function horizontalCorridorIsClear(ax: number, az: number, bx: number, bz: number,
  rocks: readonly ReefRock[]) {
  for (const rock of rocks) {
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

function safeDiamondGobyCircuit(circuit: DiamondGobySandCircuit, rocks: readonly ReefRock[]) {
  return circuit.every(([x, z]) => outsidePaddedRockFootprints(x, z, rocks)) &&
    horizontalCorridorIsClear(circuit[0][0], circuit[0][1], circuit[1][0], circuit[1][1], rocks) &&
    horizontalCorridorIsClear(circuit[1][0], circuit[1][1], circuit[2][0], circuit[2][1], rocks)
}

function corridorOutsidePaddedRocks(a: DiamondGobySandStation, b: readonly [number, number, number],
  rocks: readonly ReefRock[]) {
  for (const rock of rocks) {
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

function diamondGobyRockPerches(rocks: readonly ReefRock[], circuits: readonly DiamondGobySandCircuit[]) {
  const perches: Array<readonly [number, number, number]> = []
  for (const rock of rocks) {
    const angle = Math.atan2(.94 - rock.position.z, 1.75 - rock.position.x)
    const up = .68
    const horizontal = Math.sqrt(1 - up * up)
    const candidate = [
      rock.position.x + Math.cos(angle) * horizontal * (rock.scale.x * ROCK_PAD + .12) * 1.06,
      rock.position.y + up * (rock.scale.y * ROCK_PAD + .12) * 1.06,
      rock.position.z + Math.sin(angle) * horizontal * (rock.scale.z * ROCK_PAD + .12) * 1.06,
    ] as const
    if (Math.abs(candidate[0]) > TANK_HALF_WIDTH - .28 || Math.abs(candidate[2]) > TANK_HALF_DEPTH - .16 ||
      !outsidePaddedRocksAt(candidate[0], candidate[1], candidate[2], rocks, DIAMOND_GOBY_CLEARANCE) ||
      !circuits.every((circuit) => corridorOutsidePaddedRocks(circuit[0], candidate, rocks))) continue
    perches.push(candidate)
  }
  return perches
}

function setDiamondGobySiftTarget(station: DiamondGobySandStation, seed: number,
  progress: number, target: THREE.Vector3, rocks: readonly ReefRock[]) {
  const baseAngle = seededUnit(seed, 674) * Math.PI * 2
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const angle = baseAngle + attempt * Math.PI * .62
    const endX = station[0] + Math.cos(angle) * .055
    const endZ = station[1] + Math.sin(angle) * .055
    if (Math.abs(endX) <= TANK_HALF_WIDTH - .28 && Math.abs(endZ) <= TANK_HALF_DEPTH - .16 &&
      outsidePaddedRockFootprints(endX, endZ, rocks) &&
      horizontalCorridorIsClear(station[0], station[1], endX, endZ, rocks)) {
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
  target: THREE.Vector3, rocks: readonly ReefRock[] = REEF_ROCKS): DiamondGobyHabitatMode {
  const stableSeed = Number.isFinite(seed) ? Math.floor(seed) : 0
  const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0)
  const scheduled = elapsed + seededUnit(stableSeed, 671) * DIAMOND_GOBY_SCHEDULE_SECONDS
  const cycleNumber = Math.floor(scheduled / DIAMOND_GOBY_SCHEDULE_SECONDS)
  const cycleTime = scheduled % DIAMOND_GOBY_SCHEDULE_SECONDS
  const safeCircuits = DIAMOND_GOBY_SAND_CIRCUITS.filter((candidate) => safeDiamondGobyCircuit(candidate, rocks))
  const circuit = safeCircuits[Math.floor(seededUnit(stableSeed, 672) * safeCircuits.length)]
    ?? DIAMOND_GOBY_SAND_CIRCUITS.find((candidate) => safeDiamondGobyCircuit(candidate, rocks))

  if (!circuit) {
    for (const candidate of DIAMOND_GOBY_SAND_CIRCUITS) {
      if (outsidePaddedRockFootprints(candidate[0][0], candidate[0][1], rocks) &&
        horizontalCorridorIsClear(candidate[0][0], candidate[0][1], candidate[1][0], candidate[1][1], rocks)) {
        target.set(candidate[0][0], DIAMOND_GOBY_SAND_Y, candidate[0][1])
        return 'sand_hold'
      }
    }
    target.set(TANK_HALF_WIDTH - .28, DIAMOND_GOBY_SAND_Y, TANK_HALF_DEPTH - .16)
    return 'sand_hold'
  }

  const sandSeconds = DIAMOND_GOBY_SCHEDULE_SECONDS - DIAMOND_GOBY_EXCURSION_SECONDS
  if (cycleTime >= sandSeconds) {
    const perches = diamondGobyRockPerches(rocks, safeCircuits)
    const perch = perches[Math.floor(seededUnit(stableSeed + cycleNumber, 673) * perches.length)]
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
      (legTime - DIAMOND_GOBY_HOLD_SECONDS) / DIAMOND_GOBY_SIFT_SECONDS, target, rocks)
    return 'sand_sift'
  }
  const progress = smoothProgress((legTime - DIAMOND_GOBY_HOLD_SECONDS - DIAMOND_GOBY_SIFT_SECONDS) /
    (DIAMOND_GOBY_LEG_SECONDS - DIAMOND_GOBY_HOLD_SECONDS - DIAMOND_GOBY_SIFT_SECONDS))
  target.set(THREE.MathUtils.lerp(station[0], next[0], progress), DIAMOND_GOBY_SAND_Y,
    THREE.MathUtils.lerp(station[1], next[1], progress))
  return 'sand_transfer'
}

function frontRockSurface(rockIndex: number, rocks: readonly ReefRock[]) {
  const rock = rocks[rockIndex]
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
export function cleaningStation(seed = 0, rocks: readonly ReefRock[] = REEF_ROCKS): CleaningStation {
  const indices = frontRockIndices(rocks)
  const rockIndex = indices[Math.floor(seededUnit(seed, 621) * indices.length)] ?? 0
  const surface = frontRockSurface(rockIndex, rocks)
  const servicePosition = clampFishTarget(surface.position.clone().addScaledVector(surface.normal, .3))
  const side = seededUnit(seed, 622) < .5 ? -1 : 1
  return {
    rockId: rocks[rockIndex]?.id ?? rockIndex,
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

export function cleaningStationScheduleTime(elapsedHours: number, paused: boolean) {
  if (paused) return null
  const authoritative = Number.isFinite(elapsedHours) ? Math.max(0, elapsedHours) : 0
  return authoritative * CLEANING_STATION_UNITS_PER_GAME_HOUR
}

/** Pure attraction intent. The existing renderer remains responsible for capped travel and turns. */
export function cleaningVisitIntent(elapsedSeconds: number, station: CleaningStation,
  animals: readonly InteractionAnimal[]): CleaningVisitIntent {
  const clients = animals.filter((animal) => animal.alive && animal.isFish && animal.parasiteLoad > 0)
    .sort((a, b) => a.id - b.id)
  const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0) + station.phaseOffsetSeconds
  const cycleNumber = Math.floor(elapsed / 28)
  const cycleTime = elapsed % 28
  const client = clients[Math.floor(seededUnit(station.scheduleSeed + cycleNumber, 631) * clients.length)]
  if (!client || cycleTime < 9) return {
    cycleNumber, clientId: null, phase: 'idle', phaseProgress: Math.min(cycleTime / 9, 1),
    targetPosition: station.approachPosition.clone(), blend: 0, paceMultiplier: 1,
  }
  if (cycleTime < 15) {
    const progress = smoothProgress((cycleTime - 9) / 6)
    return { cycleNumber, clientId: client.id, phase: 'approach', phaseProgress: progress,
      targetPosition: station.approachPosition.clone().lerp(station.servicePosition, progress),
      blend: progress, paceMultiplier: THREE.MathUtils.lerp(1, .18, progress) }
  }
  if (cycleTime < 21) return {
    cycleNumber, clientId: client.id, phase: 'service', phaseProgress: (cycleTime - 15) / 6,
    targetPosition: station.servicePosition.clone(), blend: 1, paceMultiplier: .04,
  }
  const progress = smoothProgress((cycleTime - 21) / 7)
  return { cycleNumber, clientId: client.id, phase: 'depart', phaseProgress: progress,
    targetPosition: station.servicePosition.clone().lerp(station.departurePosition, progress),
    blend: 1 - progress, paceMultiplier: THREE.MathUtils.lerp(.18, 1, progress) }
}

export function shouldDispatchCleaningTreatment(intent: CleaningVisitIntent, treatedCycle: number,
  clientPosition: THREE.Vector3 | undefined, servicePosition: THREE.Vector3,
  contactRadius = CLEANING_SERVICE_CONTACT_RADIUS) {
  return intent.phase === 'service' && intent.clientId !== null && intent.cycleNumber > treatedCycle &&
    Boolean(clientPosition && clientPosition.distanceTo(servicePosition) <= contactRadius)
}

export function cleaningVisitPace(intent: CleaningVisitIntent, clientPosition: THREE.Vector3) {
  return clientPosition.distanceTo(intent.targetPosition) <= CLEANING_SERVICE_CONTACT_RADIUS
    ? intent.paceMultiplier : 1
}
