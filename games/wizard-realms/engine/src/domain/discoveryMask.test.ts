import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, DISCOVERY_MASK_BYTES, encodeDiscoveredTileIds } from './discoveryMask'
import { WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

const tileId = (gx: number, gz: number) => `tile-${gx + 3}-${gz + 3}`
const width = WORLD_GRID_MAX - WORLD_GRID_MIN + 1

describe('discovery mask', () => {
  it('encodes and decodes an empty discovery', () => {
    expect(DISCOVERY_MASK_BYTES).toBe(32_768)
    const mask = encodeDiscoveredTileIds([])
    expect(mask).toEqual(new Uint8Array(DISCOVERY_MASK_BYTES))
    expect(decodeDiscoveredTileIds(mask)).toEqual([])
  })

  it('decodes a full mask and encodes it without losing any tile', () => {
    const fullMask = new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff)
    const ids = decodeDiscoveredTileIds(fullMask)
    expect(ids).toHaveLength(width ** 2)
    expect(ids).toContain(tileId(WORLD_GRID_MIN, WORLD_GRID_MIN))
    expect(ids).toContain(tileId(WORLD_GRID_MAX, WORLD_GRID_MAX))
    expect(encodeDiscoveredTileIds(ids)).toEqual(fullMask)
  })

  it('uses row-major indexes and low bits first at byte, row, and world edges', () => {
    const ids = [
      tileId(WORLD_GRID_MIN, WORLD_GRID_MIN),
      tileId(WORLD_GRID_MIN + 7, WORLD_GRID_MIN),
      tileId(WORLD_GRID_MIN + 8, WORLD_GRID_MIN),
      tileId(WORLD_GRID_MAX, WORLD_GRID_MIN),
      tileId(WORLD_GRID_MIN, WORLD_GRID_MIN + 1),
      tileId(WORLD_GRID_MAX, WORLD_GRID_MAX),
    ].sort()
    const mask = encodeDiscoveredTileIds(ids)
    expect(mask[0]).toBe(0x81)
    expect(mask[1]).toBe(0x01)
    expect(mask[width / 8 - 1]).toBe(0x80)
    expect(mask[width / 8]).toBe(0x01)
    expect(mask[DISCOVERY_MASK_BYTES - 1]).toBe(0x80)
    expect(decodeDiscoveredTileIds(mask)).toEqual(ids)
  })

  it('returns canonical IDs in lexical order even when bit indexes differ', () => {
    const ids = ['tile-10-3', 'tile-2-3']
    expect(decodeDiscoveredTileIds(encodeDiscoveredTileIds(ids))).toEqual(ids)
  })

  it.each([
    ['missing tile prefix', '3-3'],
    ['leading zero', 'tile-03-3'],
    ['negative zero', 'tile--0-3'],
    ['decimal', 'tile-3.0-3'],
    ['extra suffix', 'tile-3-3-extra'],
    ['unsafe integer', 'tile-999999999999999999999-3'],
    ['x below grid', tileId(WORLD_GRID_MIN - 1, 0)],
    ['x above grid', tileId(WORLD_GRID_MAX + 1, 0)],
    ['z below grid', tileId(0, WORLD_GRID_MIN - 1)],
    ['z above grid', tileId(0, WORLD_GRID_MAX + 1)],
  ])('rejects %s ID', (_label, id) => {
    expect(() => encodeDiscoveredTileIds([id])).toThrow(RangeError)
  })

  it('rejects non-string, duplicate, and lexically unsorted IDs', () => {
    expect(() => encodeDiscoveredTileIds([42 as unknown as string])).toThrow(RangeError)
    expect(() => encodeDiscoveredTileIds(['tile-3-3', 'tile-3-3'])).toThrow(RangeError)
    expect(() => encodeDiscoveredTileIds(['tile-2-3', 'tile-10-3'])).toThrow(RangeError)
  })

  it('rejects masks with any other length', () => {
    expect(() => decodeDiscoveredTileIds(new Uint8Array(DISCOVERY_MASK_BYTES - 1))).toThrow(RangeError)
    expect(() => decodeDiscoveredTileIds(new Uint8Array(DISCOVERY_MASK_BYTES + 1))).toThrow(RangeError)
  })
})
