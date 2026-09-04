import * as THREE from 'three'

import { seededUnit } from './reefLayout'

export type FishHabitat = 'reef_cruise' | 'open_water' | 'structure_hover' | 'rock_shelter' |
  'sand_sift' | 'burrow_guard' | 'benthic_walk'

export interface FishHabitatPolicy {
  readonly habitat: FishHabitat
  /** Fractions of the caller-provided vertical bounds. */
  readonly verticalBand: readonly [minimum: number, maximum: number]
  readonly xCoverage: number
  readonly zCoverage: number
  readonly structureRadius: number
  readonly pace: {
    readonly cruiseMultiplier: number
    readonly surgeMultiplier: number
    readonly cycleSeconds: readonly [minimum: number, maximum: number]
  }
}

export interface FishRouteBounds {
  readonly x: readonly [minimum: number, maximum: number]
  readonly z: readonly [minimum: number, maximum: number]
}

const DEFAULT_POLICY: FishHabitatPolicy = {
  habitat: 'reef_cruise', verticalBand: [.08, .92], xCoverage: .72, zCoverage: .64,
  structureRadius: 0, pace: { cruiseMultiplier: 1, surgeMultiplier: 1, cycleSeconds: [18, 24] },
}

const TANG_POLICY: FishHabitatPolicy = {
  habitat: 'open_water', verticalBand: [.32, .68], xCoverage: .9, zCoverage: .82,
  structureRadius: 0, pace: { cruiseMultiplier: 1, surgeMultiplier: 1.38, cycleSeconds: [15, 23] },
}

const SPECIES_POLICIES = {
  banggai_cardinal: {
    habitat: 'structure_hover', verticalBand: [.3, .65], xCoverage: 0, zCoverage: 0,
    structureRadius: .44, pace: { cruiseMultiplier: .68, surgeMultiplier: .68, cycleSeconds: [18, 24] },
  },
  royal_gramma: {
    habitat: 'rock_shelter', verticalBand: [.25, .62], xCoverage: 0, zCoverage: 0,
    structureRadius: .52, pace: { cruiseMultiplier: .78, surgeMultiplier: .78, cycleSeconds: [18, 24] },
  },
  diamond_goby: {
    habitat: 'sand_sift', verticalBand: [0, .16], xCoverage: .64, zCoverage: .5,
    structureRadius: .38, pace: { cruiseMultiplier: .54, surgeMultiplier: .54, cycleSeconds: [18, 24] },
  },
  watchman_goby: {
    habitat: 'burrow_guard', verticalBand: [0, .14], xCoverage: 0, zCoverage: 0,
    structureRadius: .34, pace: { cruiseMultiplier: .46, surgeMultiplier: .46, cycleSeconds: [18, 24] },
  },
  epaulette_shark: {
    habitat: 'benthic_walk', verticalBand: [0, .18], xCoverage: .8, zCoverage: .68,
    structureRadius: 0, pace: { cruiseMultiplier: .4, surgeMultiplier: .4, cycleSeconds: [18, 24] },
  },
} satisfies Readonly<Record<string, FishHabitatPolicy>>

export function fishHabitatPolicyFor(speciesId: string): FishHabitatPolicy {
  if (speciesId.endsWith('_tang')) return TANG_POLICY
  return SPECIES_POLICIES[speciesId as keyof typeof SPECIES_POLICIES] ?? DEFAULT_POLICY
}

/** Smooth seeded pace pulse. Equal cruise and surge values produce a constant pace. */
export function fishPaceMultiplier(policy: FishHabitatPolicy, seed: number, elapsedSeconds: number): number {
  const period = THREE.MathUtils.lerp(policy.pace.cycleSeconds[0], policy.pace.cycleSeconds[1],
    seededUnit(seed, 201))
  const phase = THREE.MathUtils.euclideanModulo(elapsedSeconds / period + seededUnit(seed, 202), 1)
  const pulse = Math.max(0, Math.sin(phase * Math.PI * 2)) ** 2
  return THREE.MathUtils.lerp(policy.pace.cruiseMultiplier, policy.pace.surgeMultiplier, pulse)
}

function policyVerticalBounds(policy: FishHabitatPolicy,
  verticalBounds: readonly [minimum: number, maximum: number]) {
  const span = verticalBounds[1] - verticalBounds[0]
  return [verticalBounds[0] + span * policy.verticalBand[0],
    verticalBounds[0] + span * policy.verticalBand[1]] as const
}

function openWaterWaypoints(policy: FishHabitatPolicy, seed: number, bounds: FishRouteBounds,
  yBounds: readonly [number, number]) {
  const centerX = (bounds.x[0] + bounds.x[1]) * .5
  const centerZ = (bounds.z[0] + bounds.z[1]) * .5
  const xReach = (bounds.x[1] - bounds.x[0]) * policy.xCoverage * .5
  const zReach = (bounds.z[1] - bounds.z[0]) * policy.zCoverage * .5
  const y = (salt: number) => THREE.MathUtils.lerp(yBounds[0], yBounds[1], seededUnit(seed, salt))
  return [
    new THREE.Vector3(centerX - xReach, y(101), centerZ - zReach),
    new THREE.Vector3(centerX - xReach, y(102), centerZ + zReach),
    new THREE.Vector3(centerX, y(103), centerZ + zReach * .72),
    new THREE.Vector3(centerX + xReach, y(104), centerZ + zReach),
    new THREE.Vector3(centerX + xReach, y(105), centerZ - zReach),
    new THREE.Vector3(centerX, y(106), centerZ - zReach * .72),
  ]
}

function selectedRock(seed: number, rockCenters: readonly THREE.Vector3[], bounds: FishRouteBounds,
  yBounds: readonly [number, number]) {
  const center = rockCenters[Math.floor(seededUnit(seed, 301) * rockCenters.length)]
  return new THREE.Vector3(
    THREE.MathUtils.clamp(center?.x ?? (bounds.x[0] + bounds.x[1]) * .5, bounds.x[0], bounds.x[1]),
    THREE.MathUtils.clamp(center?.y ?? yBounds[0], yBounds[0], yBounds[1]),
    THREE.MathUtils.clamp(center?.z ?? (bounds.z[0] + bounds.z[1]) * .5, bounds.z[0], bounds.z[1]),
  )
}

function structureWaypoints(policy: FishHabitatPolicy, seed: number, bounds: FishRouteBounds,
  yBounds: readonly [number, number], rockCenters: readonly THREE.Vector3[]) {
  const center = selectedRock(seed, rockCenters, bounds, yBounds)
  const phase = seededUnit(seed, 302) * Math.PI * 2
  return Array.from({ length: 6 }, (_, index) => {
    const angle = phase + index / 6 * Math.PI * 2
    const radius = policy.structureRadius * (.54 + seededUnit(seed, 310 + index) * .34)
    return new THREE.Vector3(
      THREE.MathUtils.clamp(center.x + Math.cos(angle) * radius, bounds.x[0], bounds.x[1]),
      THREE.MathUtils.clamp(center.y + (seededUnit(seed, 320 + index) - .5) * policy.structureRadius * .16,
        yBounds[0], yBounds[1]),
      THREE.MathUtils.clamp(center.z + Math.sin(angle) * radius, bounds.z[0], bounds.z[1]),
    )
  })
}

/** Returns a fresh deterministic closed-route waypoint list without mutating its inputs. */
export function fishRouteWaypoints(policy: FishHabitatPolicy, seed: number, bounds: FishRouteBounds,
  verticalBounds: readonly [minimum: number, maximum: number],
  rockCenters: readonly THREE.Vector3[]): readonly THREE.Vector3[] {
  const yBounds = policyVerticalBounds(policy, verticalBounds)
  if (policy.habitat === 'structure_hover' || policy.habitat === 'rock_shelter' ||
    policy.habitat === 'burrow_guard') {
    return structureWaypoints(policy, seed, bounds, yBounds, rockCenters)
  }
  const waypoints = openWaterWaypoints(policy, seed, bounds, yBounds)
  if (policy.habitat !== 'sand_sift') return waypoints
  const home = selectedRock(seed, rockCenters, bounds, yBounds)
  home.y = yBounds[0]
  return [...waypoints.slice(0, 5), home]
}
