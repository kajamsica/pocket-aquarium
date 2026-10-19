import { mireglassAnchors, mireglassResources } from './mireglassContent'
import type { MireglassAnchor, MireglassResource } from './mireglassContent'
import { WORLD_CHUNK_CELLS, WORLD_CHUNK_MAX, WORLD_CHUNK_MIN } from './worldChunks'
import type { WorldTile } from './types'

export interface MireglassChunkContent {
  chunkX: number
  chunkZ: number
  anchors: MireglassAnchor[]
  resources: MireglassResource[]
}

/** Returns existing authored content in the chunk containing each global tile. */
export function mireglassChunkContent(seed: string, chunkX: number, chunkZ: number): MireglassChunkContent {
  if (!Number.isSafeInteger(chunkX) || !Number.isSafeInteger(chunkZ)
    || chunkX < WORLD_CHUNK_MIN || chunkX > WORLD_CHUNK_MAX
    || chunkZ < WORLD_CHUNK_MIN || chunkZ > WORLD_CHUNK_MAX) throw new RangeError('World chunk coordinates must be integers from -16 through 15.')

  const inChunk = ({ tile }: { tile: WorldTile }) =>
    Math.floor((tile.gridX - 3) / WORLD_CHUNK_CELLS) === chunkX
    && Math.floor((tile.gridZ - 3) / WORLD_CHUNK_CELLS) === chunkZ

  return {
    chunkX,
    chunkZ,
    anchors: Object.values(mireglassAnchors(seed)).filter(inChunk).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    resources: mireglassResources(seed).filter(inChunk).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  }
}
