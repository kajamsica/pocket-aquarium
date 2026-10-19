import { describe, expect, it } from 'vitest'
import { decodeDiscoveredTileIds, discoveryMaskHasTileId, DISCOVERY_MASK_BYTES,
  encodeDiscoveredTileIds, isDiscoveryMaskSubset, isValidDiscoveryMask } from './discoveryMask'
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

describe('compact discovery mask primitives', () => {
  const empty = new Uint8Array(DISCOVERY_MASK_BYTES)
  const starter = encodeDiscoveredTileIds([tileId(0, 0), tileId(0, 1), tileId(1, 0)].sort())
  const sparse = encodeDiscoveredTileIds([
    tileId(-73, 99), tileId(0, 0), tileId(84, -112), tileId(180, 181),
  ].sort())
  const boundary = new Uint8Array(DISCOVERY_MASK_BYTES)
  boundary[0] = 0x01
  boundary[DISCOVERY_MASK_BYTES - 1] = 0x80
  const dense = new Uint8Array(DISCOVERY_MASK_BYTES)
  dense.fill(0xff, 0, 128) // 1,024 cells, not a full-world expansion.
  const masks = [empty, starter, sparse, boundary, dense]

  it('matches decoded membership and subset on empty, starter, sparse, edge and bounded dense masks', () => {
    const decoded = masks.map((mask) => decodeDiscoveredTileIds(mask))
    const candidates = new Set([
      tileId(WORLD_GRID_MIN, WORLD_GRID_MIN), tileId(WORLD_GRID_MAX, WORLD_GRID_MAX),
      tileId(0, 0), tileId(0, 1), tileId(1, 0), tileId(84, -112),
      ...decoded.flat(),
    ])
    for (const [index, mask] of masks.entries()) {
      expect(isValidDiscoveryMask(mask)).toBe(true)
      for (const id of candidates) {
        expect(discoveryMaskHasTileId(mask, id), `mask ${index}, ${id}`).toBe(decoded[index].includes(id))
      }
      for (const [otherIndex, other] of masks.entries()) {
        const otherIds = new Set(decoded[otherIndex])
        expect(isDiscoveryMaskSubset(mask, other), `subset ${index} of ${otherIndex}`)
          .toBe(decoded[index].every((id) => otherIds.has(id)))
      }
    }
  })

  it('rejects malformed IDs and wrong mask shapes without treating them as undiscovered tiles', () => {
    const full = new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff)
    for (const id of [
      '3-3', 'tile-03-3', 'tile--0-3', 'tile-3.0-3', 'tile-3-3-extra',
      'tile-999999999999999999999-3', tileId(WORLD_GRID_MIN - 1, 0),
      tileId(WORLD_GRID_MAX + 1, 0), tileId(0, WORLD_GRID_MIN - 1),
      tileId(0, WORLD_GRID_MAX + 1), 42, null,
    ]) expect(discoveryMaskHasTileId(full, id)).toBe(false)
    const short = new Uint8Array(DISCOVERY_MASK_BYTES - 1)
    const long = new Uint8Array(DISCOVERY_MASK_BYTES + 1)
    const spoofedLength = new Uint8Array(1)
    Object.defineProperty(spoofedLength, 'length', { value: DISCOVERY_MASK_BYTES })
    class DerivedMask extends Uint8Array {}
    for (const invalid of [short, long, new Uint8ClampedArray(DISCOVERY_MASK_BYTES),
      new DataView(new ArrayBuffer(DISCOVERY_MASK_BYTES)), new DerivedMask(DISCOVERY_MASK_BYTES),
      spoofedLength, new Proxy(full, {}), Array.from(empty), null]) {
      expect(isValidDiscoveryMask(invalid)).toBe(false)
      expect(discoveryMaskHasTileId(invalid, tileId(0, 0))).toBe(false)
      expect(isDiscoveryMaskSubset(invalid, empty)).toBe(false)
      expect(isDiscoveryMaskSubset(empty, invalid)).toBe(false)
    }
    expect(isDiscoveryMaskSubset(empty, full)).toBe(true)
    expect(isDiscoveryMaskSubset(full, empty)).toBe(false)
  })

  it.each(['BigUint64Array', 'Uint8ClampedArray'] as const)(
    'rejects a %s with a forged Uint8Array prototype', (kind) => {
      const forged = kind === 'BigUint64Array'
        ? new BigUint64Array(DISCOVERY_MASK_BYTES) : new Uint8ClampedArray(DISCOVERY_MASK_BYTES)
      Object.setPrototypeOf(forged, Uint8Array.prototype)
      expect(isValidDiscoveryMask(forged)).toBe(false)
      expect(discoveryMaskHasTileId(forged, tileId(0, 0))).toBe(false)
      expect(isDiscoveryMaskSubset(forged, empty)).toBe(false)
      expect(isDiscoveryMaskSubset(empty, forged)).toBe(false)
    })

  it('rejects a detached Uint8Array without reading its bytes', () => {
    const detached = new Uint8Array(DISCOVERY_MASK_BYTES)
    structuredClone(detached.buffer, { transfer: [detached.buffer] })
    expect(isValidDiscoveryMask(detached)).toBe(false)
    expect(discoveryMaskHasTileId(detached, tileId(0, 0))).toBe(false)
    expect(isDiscoveryMaskSubset(detached, empty)).toBe(false)
  })
})
