import { legacyTileAtGrid } from './generation'
import type { RouteProfile, RouteSite, Vec3, WorldTile } from './types'

// This selector is intentionally separate from the persisted GenerationProfile union.
// Only a later versioned world constructor may opt into it.
export const STARTER_CLIFF_PROFILE = 'greenway-starter-cliff-v1' as const
export const STARTER_CLIFF_SITE_ID = 'greenway_ladder:x:0' as const
export const STARTER_CLIFF_RISE = 1.56

export interface StarterCliffFace {
  siteId: typeof STARTER_CLIFF_SITE_ID
  from: Vec3
  to: Vec3
  width: number
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

function upliftWeight(x: number, z: number): number {
  const across = clamp01((32 - Math.max(16, Math.abs(x))) / 16)
  // The four-meter tiles form a real escarpment at z=-6, not a long ramp.
  const north = z >= -6 ? 0 : z >= -12 ? 1 : clamp01((z + 28) / 16)
  return across * north
}

/** Pure, opt-in height overlay. Legacy and unknown selectors return the original tile. */
export function starterCliffTile(seed: string, profile: string, tile: WorldTile): WorldTile {
  if (profile !== STARTER_CLIFF_PROFILE) return tile
  const weight = upliftWeight(tile.center.x, tile.center.z)
  if (weight === 0) return tile
  const sourceSeed = seed || 'wizard-realms'
  const lower = legacyTileAtGrid(sourceSeed, 3, 2).center.y
  const upper = legacyTileAtGrid(sourceSeed, 3, 1).center.y
  const uplift = (STARTER_CLIFF_RISE - (upper - lower)) * weight
  if (uplift === 0) return tile
  return { ...tile, center: { ...tile.center, y: tile.center.y + uplift } }
}

/** The new-world profile offers one real cliff crossing, never the legacy fan of low-step sites. */
export function starterCliffCanonicalSite(seed: string): RouteSite {
  const normalizedSeed = seed || 'wizard-realms'
  const from = starterCliffTile(normalizedSeed, STARTER_CLIFF_PROFILE,
    legacyTileAtGrid(normalizedSeed, 3, 2)).center
  const to = starterCliffTile(normalizedSeed, STARTER_CLIFF_PROFILE,
    legacyTileAtGrid(normalizedSeed, 3, 1)).center
  return { id: STARTER_CLIFF_SITE_ID, routeId: 'greenway_ladder', from, to }
}

/** The rail/rung face is short and steep; its four-meter approach is not the ladder. */
export function starterCliffCanonicalFace(seed: string): StarterCliffFace {
  const site = starterCliffCanonicalSite(seed)
  return { siteId: STARTER_CLIFF_SITE_ID,
    from: { x: 0, y: site.from.y, z: -5.35 },
    to: { x: 0, y: site.to.y, z: -6 }, width: 1.05 }
}

/** Geometry only. The authoritative caller must supply normalized seed and built state. */
export function starterCliffFace(normalizedSeed: string, route: RouteProfile, profile: string,
  built: boolean): StarterCliffFace | null {
  const site = normalizedSeed ? starterCliffCanonicalSite(normalizedSeed) : null
  if (!normalizedSeed || !built || profile !== STARTER_CLIFF_PROFILE || route.id !== 'greenway_ladder'
    || route.fromAreaId !== 'greenway' || route.toAreaId !== 'northern_ridge'
    || route.siteId !== STARTER_CLIFF_SITE_ID
    || !site || route.from.x !== site.from.x || route.from.y !== site.from.y
    || route.from.z !== site.from.z || route.to.x !== site.to.x
    || route.to.y !== site.to.y || route.to.z !== site.to.z) return null
  return starterCliffCanonicalFace(normalizedSeed)
}
