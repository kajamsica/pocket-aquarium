import { describe, expect, it } from 'vitest'
import { mireglassAnchors, mireglassResources } from './mireglassContent'
import { mireglassChunkContent } from './mireglassChunkContent'
import type { WorldTile } from './types'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS, worldChunk } from './worldChunks'

function chunkOf(tile: WorldTile) {
  return {
    chunkX: Math.floor(tile.center.x / (WORLD_CELL_METERS * WORLD_CHUNK_CELLS)),
    chunkZ: Math.floor(tile.center.z / (WORLD_CELL_METERS * WORLD_CHUNK_CELLS)),
  }
}

const keyOf = ({ chunkX, chunkZ }: { chunkX: number; chunkZ: number }) => `${chunkX},${chunkZ}`
const byId = <T extends { id: string }>(a: T, b: T) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0

describe('Mireglass Reach streamed chunk content', () => {
  it('places every authored anchor and timber node in exactly its canonical chunk across 100 seeds, regardless of query order', () => {
    for (let seedIndex = 0; seedIndex < 100; seedIndex += 1) {
      const seed = `mireglass-corpus-${seedIndex}`
      const anchors = Object.values(mireglassAnchors(seed))
      const resources = mireglassResources(seed)
      const coordinates = new Map<string, { chunkX: number; chunkZ: number }>()
      const add = (coordinate: { chunkX: number; chunkZ: number }) => coordinates.set(keyOf(coordinate), coordinate)
      for (const { tile } of [...anchors, ...resources]) {
        const coordinate = chunkOf(tile)
        add(coordinate)
        add({ chunkX: coordinate.chunkX + 1, chunkZ: coordinate.chunkZ })
      }
      add({ chunkX: 0, chunkZ: 0 })
      add({ chunkX: -16, chunkZ: -16 })
      add({ chunkX: 15, chunkZ: 15 })

      const firstPass = new Map<string, ReturnType<typeof mireglassChunkContent>>()
      const seenAnchors: string[] = []
      const seenResources: string[] = []
      for (const coordinate of coordinates.values()) {
        const content = mireglassChunkContent(seed, coordinate.chunkX, coordinate.chunkZ)
        firstPass.set(keyOf(coordinate), content)
        expect(content).toEqual({
          ...coordinate,
          anchors: anchors.filter(({ tile }) => keyOf(chunkOf(tile)) === keyOf(coordinate)).sort(byId),
          resources: resources.filter(({ tile }) => keyOf(chunkOf(tile)) === keyOf(coordinate)).sort(byId),
        })
        seenAnchors.push(...content.anchors.map(({ id }) => id))
        seenResources.push(...content.resources.map(({ id }) => id))
      }
      expect(seenAnchors.sort()).toEqual(anchors.map(({ id }) => id).sort())
      expect(seenResources.sort()).toEqual(resources.map(({ id }) => id).sort())

      const shuffled = [...coordinates.values()]
      let shuffleSeed = seedIndex + 1
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        shuffleSeed = (Math.imul(shuffleSeed, 1664525) + 1013904223) >>> 0
        const swapIndex = shuffleSeed % (index + 1)
        ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
      }
      for (const coordinate of shuffled) {
        expect(mireglassChunkContent(seed, coordinate.chunkX, coordinate.chunkZ))
          .toEqual(firstPass.get(keyOf(coordinate)))
      }
    }
  }, 30_000)

  it('returns fresh content after callers mutate a prior result', () => {
    const seed = 'mireglass-mutation'
    for (const tile of [Object.values(mireglassAnchors(seed))[0].tile, mireglassResources(seed)[0].tile]) {
      const { chunkX, chunkZ } = chunkOf(tile)
      const original = mireglassChunkContent(seed, chunkX, chunkZ)
      const expected = structuredClone(original)
      if (original.anchors[0]) original.anchors[0].tile.center.y = -99
      if (original.resources[0]) original.resources[0].tile.center.y = -99
      original.anchors.pop()
      original.resources.pop()
      expect(mireglassChunkContent(seed, chunkX, chunkZ)).toEqual(expected)
    }
  })

  it('rejects the same invalid chunk coordinates as worldChunk', () => {
    for (const [chunkX, chunkZ] of [
      [-17, 0], [16, 0], [0, -17], [0, 16], [0.5, 0], [0, NaN], [Infinity, 0], [0, 2 ** 53],
    ]) {
      expect(() => mireglassChunkContent('invalid', chunkX, chunkZ)).toThrow(new RangeError('World chunk coordinates must be integers from -16 through 15.'))
      expect(() => worldChunk('invalid', chunkX, chunkZ)).toThrow(new RangeError('World chunk coordinates must be integers from -16 through 15.'))
    }
  })
})
