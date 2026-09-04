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

function outsidePaddedRocks(position: THREE.Vector3, clearance = .16) {
  return REEF_ROCKS.every((rock) => {
    const nx = (position.x - rock.position.x) / (rock.scale.x * ROCK_PAD + clearance)
    const ny = (position.y - rock.position.y) / (rock.scale.y * ROCK_PAD + clearance)
    const nz = (position.z - rock.position.z) / (rock.scale.z * ROCK_PAD + clearance)
    return nx * nx + ny * ny + nz * nz >= 1
  })
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
