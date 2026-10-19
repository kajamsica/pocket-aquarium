import { starterCliffWorldTileAtGrid } from './starterCliffWorld'
import type { ResourceNode, Vec3, WorldTile } from './types'

/** Fixed first works, intentionally outside the v14 works1 and save namespaces. */
export const PUBLIC_V15_STARTER_BRIDGE_ID = 'works2:bridge:greenway-creek' as const
export const PUBLIC_V15_STARTER_DIG_ID = 'works2:dig:bank-cache' as const
export const PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS = 1.6 as const
/** World-space edges of the five-cell wet row, not its rounded display footprint. */
export const PUBLIC_V15_STARTER_CREEK_BOUNDS = {
  minX: -10, maxX: 10, nearZ: 6, farZ: 10,
} as const
export const PUBLIC_V15_STARTER_RESOURCE_CLEARANCE_METERS = 1.75

const GAP_Z = 8
const GAP_ROW_GZ = GAP_Z / 4
const GAP_MIN_GX = -2
const GAP_MAX_GX = 2
const BRIDGE_GX = 0
const DIG_GX = 1
const APPROACH_GZ = 0
const NEAR_BANK_GZ = 1
const FAR_BANK_GZ = 3
const EXIT_GZ = 4
const GAP_DEPTH_METERS = 0.28
const DECK_CLEARANCE_METERS = 0.16
const DIG_DEPTH_METERS = 0.24

export type PublicV15StarterBridgeSite = Readonly<{
  id: typeof PUBLIC_V15_STARTER_BRIDGE_ID
  kind: 'bridge'
  obstacle: 'greenway_creek'
  from: Readonly<Vec3>
  to: Readonly<Vec3>
  approach: Readonly<Vec3>
  exit: Readonly<Vec3>
  gapCenter: Readonly<Vec3>
  /** Includes only the crossing lane; the wider creek row remains an obstacle. */
  footprintTileIds: readonly string[]
  /** The five wet cells form one continuous 20 m-wide creek at z=6..10. */
  wetGapTileIds: readonly string[]
  gapBounds: typeof PUBLIC_V15_STARTER_CREEK_BOUNDS
  supportPath: readonly Readonly<Vec3>[]
  widthMeters: typeof PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS
  logCost: 8
  xpReward: 80
  rewardClass: 'construction'
}>

export type PublicV15StarterDigSite = Readonly<{
  id: typeof PUBLIC_V15_STARTER_DIG_ID
  kind: 'dig'
  obstacle: 'suitable_ground'
  center: Readonly<Vec3>
  loweredCenter: Readonly<Vec3>
  /** A reachable dry stance on the far bank, not inside the patch being lowered. */
  adjacentStance: Readonly<Vec3>
  footprintTileIds: readonly string[]
  depthMeters: typeof DIG_DEPTH_METERS
  rewardClass: 'stone'
  reward: Readonly<{ itemId: 'stone'; quantity: 1; xp: 30 }>
}>

export type PublicV15StarterSite = PublicV15StarterBridgeSite | PublicV15StarterDigSite

const normalizedSeed = (seed: string) => {
  if (typeof seed !== 'string') throw new TypeError('V15 starter-site seed must be a string.')
  return seed || 'wizard-realms'
}

const dryBankCell = (gx: number, gz: number) =>
  (gx === BRIDGE_GX && (gz === APPROACH_GZ || gz === NEAR_BANK_GZ
    || gz === FAR_BANK_GZ || gz === EXIT_GZ))
  || (gx === DIG_GX && gz === FAR_BANK_GZ)

/**
 * The v15-only tile overlay used by genesis, active chunks, and pose proof.
 * It leaves every other tile's geometry and the complete v14 world untouched.
 */
export function publicWorldV15StarterTileAtGrid(seed: string, gx: number, gz: number): WorldTile {
  const sourceSeed = normalizedSeed(seed)
  const base = starterCliffWorldTileAtGrid(sourceSeed, gx, gz)
  if (gz === GAP_ROW_GZ && gx >= GAP_MIN_GX && gx <= GAP_MAX_GX) {
    const near = starterCliffWorldTileAtGrid(sourceSeed, gx, NEAR_BANK_GZ)
    const far = starterCliffWorldTileAtGrid(sourceSeed, gx, FAR_BANK_GZ)
    const y = Math.min(near.center.y, far.center.y) - GAP_DEPTH_METERS
    return { ...base, biome: 'marsh', terrain: 'wetland', elevation: y / 3,
      center: { ...base.center, y } }
  }
  if (dryBankCell(gx, gz)) return { ...base, biome: 'temperate_forest', terrain: 'loam' }
  return base
}

/** Canonical 4 m-cell facts. No player state, mutable occupancy, or discovery is consulted. */
export function publicWorldV15StarterSites(seed: string): readonly PublicV15StarterSite[] {
  const sourceSeed = normalizedSeed(seed)
  const tile = (gx: number, gz: number) => publicWorldV15StarterTileAtGrid(sourceSeed, gx, gz)
  const approach = tile(BRIDGE_GX, APPROACH_GZ)
  const from = tile(BRIDGE_GX, NEAR_BANK_GZ)
  const gap = tile(BRIDGE_GX, GAP_ROW_GZ)
  const to = tile(BRIDGE_GX, FAR_BANK_GZ)
  const exit = tile(BRIDGE_GX, EXIT_GZ)
  const dig = tile(DIG_GX, FAR_BANK_GZ)
  const bridge: PublicV15StarterBridgeSite = {
    id: PUBLIC_V15_STARTER_BRIDGE_ID, kind: 'bridge', obstacle: 'greenway_creek',
    approach: { ...approach.center }, from: { ...from.center },
    gapCenter: { ...gap.center }, to: { ...to.center }, exit: { ...exit.center },
    footprintTileIds: [approach.id, from.id, gap.id, to.id, exit.id],
    wetGapTileIds: Array.from({ length: GAP_MAX_GX - GAP_MIN_GX + 1 }, (_, index) =>
      tile(GAP_MIN_GX + index, GAP_ROW_GZ).id),
    gapBounds: PUBLIC_V15_STARTER_CREEK_BOUNDS,
    supportPath: [{ ...from.center }, { ...gap.center,
      y: Math.max(from.center.y, to.center.y) + DECK_CLEARANCE_METERS }, { ...to.center }],
    widthMeters: PUBLIC_V15_STARTER_BRIDGE_WIDTH_METERS,
    logCost: 8, xpReward: 80, rewardClass: 'construction',
  }
  const center = { ...dig.center }
  const digSite: PublicV15StarterDigSite = {
    id: PUBLIC_V15_STARTER_DIG_ID, kind: 'dig', obstacle: 'suitable_ground',
    center, loweredCenter: { ...center, y: center.y - DIG_DEPTH_METERS },
    adjacentStance: { x: 1.7, y: to.center.y, z: 12 },
    footprintTileIds: [dig.id, to.id], depthMeters: DIG_DEPTH_METERS,
    rewardClass: 'stone', reward: { itemId: 'stone', quantity: 1, xp: 30 },
  }
  return [bridge, digSite]
}

/** Exact-ID lookup. Forged coordinates or legacy works IDs never resolve. */
export function resolvePublicWorldV15StarterSite(seed: string, id: unknown): PublicV15StarterSite | null {
  if (id !== PUBLIC_V15_STARTER_BRIDGE_ID && id !== PUBLIC_V15_STARTER_DIG_ID) return null
  return publicWorldV15StarterSites(seed).find((site) => site.id === id) ?? null
}

/**
 * V15 display/action overlay only: omit inherited resource nodes that would
 * occupy the creek, bridge lane, banks, or first dig patch. Do not replace the
 * v14-shaped replay core's resource list with this result. The input array and
 * nodes are unchanged, and unrelated resource positions remain as generated.
 */
export function publicWorldV15ClearStarterResources(seed: string,
  resources: readonly ResourceNode[]): ResourceNode[] {
  const [bridge, dig] = publicWorldV15StarterSites(seed)
  if (bridge.kind !== 'bridge' || dig.kind !== 'dig') throw new Error('Invalid starter-site facts.')
  const reservedTileIds = new Set([...bridge.footprintTileIds,
    ...bridge.wetGapTileIds, ...dig.footprintTileIds])
  const bridgeNearZ = bridge.approach.z - 2
  const bridgeFarZ = bridge.exit.z + 2
  return resources.filter(({ tileId, position }) => {
    if (reservedTileIds.has(tileId)) return false
    const zOnBridge = Math.max(bridgeNearZ, Math.min(bridgeFarZ, position.z))
    if (Math.hypot(position.x - bridge.from.x, position.z - zOnBridge)
      < PUBLIC_V15_STARTER_RESOURCE_CLEARANCE_METERS) return false
    return Math.hypot(position.x - dig.center.x, position.z - dig.center.z)
      >= PUBLIC_V15_STARTER_RESOURCE_CLEARANCE_METERS
  }).map((resource) => ({ ...resource, position: { ...resource.position } }))
}

/** Canonical suppression list for v15 scene and interaction gating, not a core-state mutation. */
export function publicWorldV15SuppressedStarterResourceIds(seed: string,
  resources: readonly ResourceNode[]): readonly string[] {
  const visible = new Set(publicWorldV15ClearStarterResources(seed, resources)
    .map((resource) => resource.id))
  return resources.filter((resource) => !visible.has(resource.id))
    .map((resource) => resource.id).sort()
}
