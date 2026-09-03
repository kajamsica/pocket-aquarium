import type { PocketFoodPellet } from '../integration/pocketAquariumBridge'

export const FOOD_ACKNOWLEDGEMENT_MS = 600
export const FOOD_CONTACT_RADIUS = 0.075

const TANK_FOOD_HALF_WIDTH = 2.44
const SAND_CONTACT_Y = -1.36
const FOOD_BOTTOM_NORMALIZED = 0.82

export interface ScenePoint {
  readonly x: number
  readonly y: number
  readonly z: number
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, Number.isFinite(value) ? value : low))
}

function seededUnit(id: number) {
  const value = Math.sin((id + 1) * 12.9898 + 71 * 78.233) * 43758.5453
  return value - Math.floor(value)
}

export function foodPelletScenePosition(pellet: PocketFoodPellet, waterSurfaceY: number): ScenePoint {
  const x = clamp(pellet.x, 0, 1)
  const y = clamp(pellet.y, 0, FOOD_BOTTOM_NORMALIZED)
  const surfaceY = (Number.isFinite(waterSurfaceY) ? waterSurfaceY : 1.4) - 0.1
  return {
    x: -TANK_FOOD_HALF_WIDTH + x * TANK_FOOD_HALF_WIDTH * 2,
    y: pellet.sunk ? SAND_CONTACT_Y : surfaceY + (SAND_CONTACT_Y - surfaceY) * (y / FOOD_BOTTOM_NORMALIZED),
    z: -0.62 + seededUnit(pellet.id) * 1.24,
  }
}

export function visibleFoodContact(
  mouth: ScenePoint,
  pellet: ScenePoint,
  firstSeenAtMs: number,
  nowMs: number,
) {
  if (![mouth.x, mouth.y, mouth.z, pellet.x, pellet.y, pellet.z, firstSeenAtMs, nowMs].every(Number.isFinite)) return false
  if (nowMs - firstSeenAtMs < FOOD_ACKNOWLEDGEMENT_MS) return false
  const dx = mouth.x - pellet.x
  const dy = mouth.y - pellet.y
  const dz = mouth.z - pellet.z
  return dx * dx + dy * dy + dz * dz <= FOOD_CONTACT_RADIUS * FOOD_CONTACT_RADIUS
}
