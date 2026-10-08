import { hashSeed } from './generation'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'
import { MIREGLASS_CONTENT_REVISION, MIREGLASS_CORE, MIREGLASS_ENVELOPES } from './mireglassTerrain'
import type { WorldTile } from './types'

export { MIREGLASS_CONTENT_REVISION, MIREGLASS_CORE } from './mireglassTerrain'

type AnchorSpec = { id: string; envelope: typeof MIREGLASS_ENVELOPES[keyof typeof MIREGLASS_ENVELOPES]; terrainRequired: WorldTile['terrain'] | null }

const ANCHORS = {
  fringeMarker: { id: 'mireglass_reach/landmark/fringe_marker', envelope: MIREGLASS_ENVELOPES.fringeMarker, terrainRequired: null },
  salvager: { id: 'mireglass_reach/vendor/salvager', envelope: MIREGLASS_ENVELOPES.salvager, terrainRequired: 'loam' },
  bellAlder: { id: 'mireglass_reach/landmark/bell_alder', envelope: MIREGLASS_ENVELOPES.bellAlder, terrainRequired: 'wetland' },
  fenChannel: { id: 'mireglass_reach/route/fen_bridge', envelope: MIREGLASS_ENVELOPES.fenChannel, terrainRequired: 'wetland' },
  slateBerm: { id: 'mireglass_reach/route/slate_ladder', envelope: MIREGLASS_ENVELOPES.slateBerm, terrainRequired: 'rocky' },
  sealCache: { id: 'mireglass_reach/dig/seal_cache', envelope: MIREGLASS_ENVELOPES.sealCache, terrainRequired: 'loam' },
} as const satisfies Record<string, AnchorSpec>

export type MireglassAnchorId = keyof typeof ANCHORS
export type MireglassAnchor = { id: string; tile: WorldTile }
export type MireglassResource = { id: string; tile: WorldTile; kind: 'tree'; logs: 4; phase: 'before_bridge' | 'after_bridge' }
export const MIREGLASS_RING_ID = 'ring-mireglass' as const

const RING_ENVELOPE = { minX: -316, maxX: -276, minZ: 260, maxZ: 300 } as const
const RING_CACHE_LIMIT = 8
const ringCache = new Map<string, { id: typeof MIREGLASS_RING_ID; tile: WorldTile }>()

const TREE_POCKETS = [
  { envelope: { minX: -144, maxX: -104, minZ: 112, maxZ: 152 }, count: 1, phase: 'before_bridge' },
  { envelope: { minX: -336, maxX: -304, minZ: 304, maxZ: 336 }, count: 2, phase: 'before_bridge' },
  { envelope: { minX: -408, maxX: -376, minZ: 384, maxZ: 416 }, count: 3, phase: 'after_bridge' },
] as const

function envelopeTiles(seed: string, envelope: { minX: number; maxX: number; minZ: number; maxZ: number }): WorldTile[] {
  const tiles: WorldTile[] = []
  for (let z = envelope.minZ; z < envelope.maxZ; z += WORLD_CELL_METERS) {
    for (let x = envelope.minX; x < envelope.maxX; x += WORLD_CELL_METERS) {
      tiles.push(worldTileAtGrid(seed, x / WORLD_CELL_METERS, z / WORLD_CELL_METERS))
    }
  }
  return tiles
}

const ranked = (seed: string, id: string, tiles: WorldTile[]) => tiles.sort((a, b) =>
  hashSeed(`${seed}:${MIREGLASS_CONTENT_REVISION}:${id}:${a.id}`)
  - hashSeed(`${seed}:${MIREGLASS_CONTENT_REVISION}:${id}:${b.id}`) || a.gridZ - b.gridZ || a.gridX - b.gridX)

/** Places authored anchors without depending on chunk load order or mutable simulation RNG. */
export function mireglassAnchors(seed: string): Record<MireglassAnchorId, MireglassAnchor> {
  const normalizedSeed = seed || 'wizard-realms'
  const entries = Object.entries(ANCHORS).map(([key, spec]) => {
    const tiles = ranked(normalizedSeed, spec.id, envelopeTiles(normalizedSeed, spec.envelope)
      .filter((tile) => spec.terrainRequired === null || tile.terrain === spec.terrainRequired))
    if (tiles.length === 0) throw new Error(`No eligible tile for ${spec.id} in ${MIREGLASS_CONTENT_REVISION}`)
    return [key, { id: spec.id, tile: tiles[0] }] as const
  })
  return Object.fromEntries(entries) as Record<MireglassAnchorId, MireglassAnchor>
}

/** Six reserved timber nodes yield 24 logs, with three reachable before the first crossing. */
export function mireglassResources(seed: string): MireglassResource[] {
  const normalizedSeed = seed || 'wizard-realms'
  const anchors = Object.values(mireglassAnchors(normalizedSeed)).map(({ tile }) => tile.center)
  const resources: MireglassResource[] = []
  for (const [pocketIndex, pocket] of TREE_POCKETS.entries()) {
    const candidates = ranked(normalizedSeed, `timber-pocket-${pocketIndex}`, envelopeTiles(normalizedSeed, pocket.envelope))
    let selected = 0
    for (const tile of candidates) {
      const clearOfAnchors = anchors.every((anchor) => Math.hypot(tile.center.x - anchor.x, tile.center.z - anchor.z) >= 4)
      const clearOfTrees = resources.every((resource) => Math.hypot(tile.center.x - resource.tile.center.x, tile.center.z - resource.tile.center.z) >= 4)
      if (!clearOfAnchors || !clearOfTrees) continue
      resources.push({ id: `mireglass_reach/resource/${tile.gridX - 3}/${tile.gridZ - 3}/0`,
        tile, kind: 'tree', logs: 4, phase: pocket.phase })
      selected += 1
      if (selected === pocket.count) break
    }
    if (selected !== pocket.count) {
      throw new Error(`Insufficient safe timber in pocket ${pocketIndex} for ${MIREGLASS_CONTENT_REVISION}`)
    }
  }
  return resources
}

/** A dry outpost-adjacent ring, stable across chunk load order and clear of authored content. */
export function mireglassFairyRing(seed: string): { id: typeof MIREGLASS_RING_ID; tile: WorldTile } {
  const normalizedSeed = seed || 'wizard-realms'
  const cached = ringCache.get(normalizedSeed)
  if (cached) return cached
  const anchors = mireglassAnchors(normalizedSeed)
  const occupied = [
    ...Object.values(anchors).map(({ tile }) => tile.center),
    ...mireglassResources(normalizedSeed).map(({ tile }) => tile.center),
  ]
  const outpost = anchors.salvager.tile.center
  const candidates = ranked(normalizedSeed, MIREGLASS_RING_ID, envelopeTiles(normalizedSeed, RING_ENVELOPE)
    .filter((tile) => tile.terrain === 'loam'
      && Math.hypot(tile.center.x - outpost.x, tile.center.z - outpost.z) <= 32
      && occupied.every((point) => Math.hypot(tile.center.x - point.x, tile.center.z - point.z) >= 12)))
  if (candidates.length === 0) throw new Error(`No safe fairy ring tile for ${normalizedSeed} in ${MIREGLASS_CONTENT_REVISION}`)
  const tile = candidates[0]
  const ring = Object.freeze({ id: MIREGLASS_RING_ID,
    tile: Object.freeze({ ...tile, center: Object.freeze({ ...tile.center }) }) })
  ringCache.set(normalizedSeed, ring)
  if (ringCache.size > RING_CACHE_LIMIT) ringCache.delete(ringCache.keys().next().value!)
  return ring
}
