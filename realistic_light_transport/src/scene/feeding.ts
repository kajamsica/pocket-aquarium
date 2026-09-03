import { createContext, useContext } from 'react'

import type { FoodPellet } from '../integration/pocketAquariumBridge'

/** Scene half-width of the tank interior, matching the fish/tank frame in SpecimenFish. */
export const FEED_HALF_WIDTH = 2.76
/** Normalized depth of the substrate; must match FOOD_BOTTOM in js/sim.js. */
export const FOOD_BOTTOM = 0.82

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/**
 * Convert a world-space horizontal hit on the rendered water into the normalized tank x
 * that `FEED` expects. `normalizedXToSurfaceX` is its exact inverse, so a pellet renders at
 * the tapped horizontal position.
 */
export function surfaceXToNormalizedX(worldX: number, halfWidth = FEED_HALF_WIDTH): number {
  return clamp((worldX / halfWidth + 1) / 2, 0, 1)
}

export function normalizedXToSurfaceX(normalizedX: number, halfWidth = FEED_HALF_WIDTH): number {
  return (clamp(normalizedX, 0, 1) * 2 - 1) * halfWidth
}

/** Map a pellet's normalized depth (0 waterline -> FOOD_BOTTOM substrate) to a scene y. */
export function pelletDepthY(foodY: number, surfaceY: number, floorY: number): number {
  const t = clamp(foodY / FOOD_BOTTOM, 0, 1)
  return surfaceY + (floorY - surfaceY) * t
}

/** Deterministic per-pellet lateral offset so pellets sit within the fish swim band. */
export function pelletLateralZ(id: number): number {
  const value = Math.sin(id * 51.13 + 0.7) * 43758.5453
  return (value - Math.floor(value)) * 0.9 - 0.1
}

/** A pellet resolved into tank scene coordinates for rendering, targeting, and contact. */
export interface ScenePellet {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly sunk: boolean
  readonly ageDays: number
}

export interface FeedingApi {
  readonly food: readonly FoodPellet[]
  /** Drop one authoritative pellet at the tapped normalized surface x. */
  feed(normalizedX: number): void
  /** Report a renderer-observed mouth/pellet contact for exactly-once consumption. */
  consume(foodId: number, eaterId: number): void
}

const NO_FEEDING: FeedingApi = { food: [], feed: () => {}, consume: () => {} }

const FeedingContext = createContext<FeedingApi>(NO_FEEDING)

export const FeedingProvider = FeedingContext.Provider

export function useFeeding(): FeedingApi {
  return useContext(FeedingContext)
}
