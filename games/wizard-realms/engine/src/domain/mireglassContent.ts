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

/** Places authored anchors without depending on chunk load order or mutable simulation RNG. */
export function mireglassAnchors(seed: string): Record<MireglassAnchorId, MireglassAnchor> {
  const normalizedSeed = seed || 'wizard-realms'
  const entries = Object.entries(ANCHORS).map(([key, spec]) => {
    const tiles: WorldTile[] = []
    for (let z = spec.envelope.minZ; z < spec.envelope.maxZ; z += WORLD_CELL_METERS) {
      for (let x = spec.envelope.minX; x < spec.envelope.maxX; x += WORLD_CELL_METERS) {
        const tile = worldTileAtGrid(normalizedSeed, x / WORLD_CELL_METERS, z / WORLD_CELL_METERS)
        if (spec.terrainRequired === null || tile.terrain === spec.terrainRequired) tiles.push(tile)
      }
    }
    tiles.sort((a, b) => hashSeed(`${normalizedSeed}:${MIREGLASS_CONTENT_REVISION}:${spec.id}:${a.id}`)
      - hashSeed(`${normalizedSeed}:${MIREGLASS_CONTENT_REVISION}:${spec.id}:${b.id}`) || a.gridZ - b.gridZ || a.gridX - b.gridX)
    if (tiles.length === 0) throw new Error(`No eligible tile for ${spec.id} in ${MIREGLASS_CONTENT_REVISION}`)
    return [key, { id: spec.id, tile: tiles[0] }] as const
  })
  return Object.fromEntries(entries) as Record<MireglassAnchorId, MireglassAnchor>
}
