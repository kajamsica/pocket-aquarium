import { describe, expect, it } from 'vitest'
import { DISCOVERY_MASK_BYTES, decodeDiscoveredTileIds,
  encodeDiscoveredTileIds } from './discoveryMask'
import { discoveredTileIdsInActiveWindow } from './publicV13DiscoveryWindow'
import { createPublicV14ContinuousSession } from './publicWorldV14ContinuousSession'
import { createFreshPublicV14Head } from './publicWorldV14Snapshot'
import { activeChunkCoordinates, WORLD_CHUNK_CELLS } from './worldChunks'
import { publicWorldV14ViewProjection } from '../PublicV14WorldView'

const tile = (gx: number, gz: number) => `tile-${gx + 3}-${gz + 3}`
const sparseMask = (...ids: string[]) => encodeDiscoveredTileIds(ids.sort())
const oracle = (ids: readonly string[], position: { x: number; z: number }) => {
  const chunks = new Set(activeChunkCoordinates(position)
    .map(({ chunkX, chunkZ }) => `${chunkX}:${chunkZ}`))
  return ids.filter((id) => {
    const [, x, z] = /^tile-(-?\d+)-(-?\d+)$/.exec(id)!
    return chunks.has(`${Math.floor((Number(x) - 3) / WORLD_CHUNK_CELLS)}:${
      Math.floor((Number(z) - 3) / WORLD_CHUNK_CELLS)}`)
  })
}

describe('v13 active discovery window', () => {
  it('returns only known IDs in the active 3 by 3 chunks, in canonical lexical order', () => {
    const mask = sparseMask(tile(7, 0), tile(-1, 0), tile(0, 0), tile(32, 0), tile(-17, 0))
    const ids = discoveredTileIdsInActiveWindow(mask, { x: 0, z: 0 })
    expect(ids).toEqual([tile(7, 0), tile(-1, 0), tile(0, 0)].sort())
    expect(ids).toContain(tile(0, 0))
    expect(Object.isFrozen(ids)).toBe(true)
  })

  it('does not expand a full mask beyond nine 16 by 16 chunks', () => {
    const ids = discoveredTileIdsInActiveWindow(new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff),
      { x: 0, z: 0 })
    expect(ids).toHaveLength(2_304)
    expect(ids).toContain(tile(-16, -16))
    expect(ids).toContain(tile(31, 31))
    expect(ids).not.toContain(tile(-17, 0))
    expect(ids).not.toContain(tile(32, 0))
    expect(ids).toEqual([...ids].sort())
  })

  it('clips the active chunks at both world corners', () => {
    const full = new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff)
    const low = discoveredTileIdsInActiveWindow(full, { x: -1_024, z: -1_024 })
    expect(low).toHaveLength(1_024)
    expect(low).toContain(tile(-256, -256))
    expect(low).toContain(tile(-225, -225))
    expect(low).not.toContain(tile(-224, -225))
    const high = discoveredTileIdsInActiveWindow(full, { x: 1_020, z: 1_020 })
    expect(high).toHaveLength(1_024)
    expect(high).toContain(tile(224, 224))
    expect(high).toContain(tile(255, 255))
    expect(high).not.toContain(tile(223, 224))
  })

  it('returns a frozen empty window for an empty mask or invalid inputs', () => {
    const empty = new Uint8Array(DISCOVERY_MASK_BYTES)
    for (const [mask, position] of [
      [empty, { x: 0, z: 0 }],
      [new Uint8Array(DISCOVERY_MASK_BYTES - 1), { x: 0, z: 0 }],
      [new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff), { x: NaN, z: 0 }],
      [new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff), { x: 0, z: Infinity }],
      [new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff), null],
    ] as const) {
      const ids = discoveredTileIdsInActiveWindow(mask, position as { x: number; z: number })
      expect(ids).toEqual([])
      expect(Object.isFrozen(ids)).toBe(true)
    }
  })

  it.each(['greenway-alpha', 'wizard-realms'])(
    'matches full-mask decode/filter across mask density, chunk seams, and corners for %s', (seed) => {
      const masks = [new Uint8Array(DISCOVERY_MASK_BYTES),
        sparseMask(tile(-256, -256), tile(-32, -1), tile(-16, -16), tile(-1, 0),
          tile(0, 0), tile(15, 15), tile(16, 16), tile(31, 31), tile(255, 255)),
        createFreshPublicV14Head(seed).head.state.discoveryMask,
        new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff)]
      const positions = [
        { x: 0, z: 0 }, { x: -64.01, z: -64.01 }, { x: -64, z: -64 },
        { x: -63.99, z: -63.99 }, { x: 63.99, z: 63.99 }, { x: 64, z: 64 },
        { x: 64.01, z: 64.01 }, { x: -1_024, z: -1_024 },
        { x: 1_020, z: 1_020 }, { x: -1_024, z: 1_020 },
        { x: 1_020, z: -1_024 },
      ]
      for (const mask of masks) {
        const allIds = decodeDiscoveredTileIds(mask)
        for (const position of positions) {
          const actual = discoveredTileIdsInActiveWindow(mask, position)
          expect(actual).toEqual(oracle(allIds, position))
          expect(Object.isFrozen(actual)).toBe(true)
        }
      }
    }, 30_000)

  it('reads a mutated mask again without revealing undiscovered neighbors', () => {
    const mask = new Uint8Array(DISCOVERY_MASK_BYTES), position = { x: 0, z: 0 }
    const known = tile(0, 0), hidden = tile(1, 0)
    mask.set(sparseMask(known))
    expect(discoveredTileIdsInActiveWindow(mask, position)).toEqual([known])
    expect(discoveredTileIdsInActiveWindow(mask, position)).not.toContain(hidden)
    mask.set(sparseMask(known, hidden))
    expect(discoveredTileIdsInActiveWindow(mask, position)).toEqual([hidden, known].sort())
    mask.fill(0)
    expect(discoveredTileIdsInActiveWindow(mask, position)).toEqual([])
  })

  it('still rejects a stale active view when saved discovery changes', () => {
    const { head, lineage } = createFreshPublicV14Head('greenway-alpha')
    const session = createPublicV14ContinuousSession({ state: head.state,
      bootstrap: null, saveRevision: 0, lineage })
    const state = session.previewSnapshot(), active = session.view()
    const newlyKnown = tile(15, 15)
    expect(active.activeKnownTileIds).not.toContain(newlyKnown)
    const discoveryMask = sparseMask(...decodeDiscoveredTileIds(state.discoveryMask), newlyKnown)
    expect(() => publicWorldV14ViewProjection({ ...state, discoveryMask }, active,
      [], null)).toThrow('The v14 view has stale discovery facts.')
  })
})
