import { describe, expect, it } from 'vitest'
import { publicV25RiverCenterZ, publicV25RiverCellAtGrid } from './publicWorldV25River'
import { publicV25RiverTouchesSegment } from './publicWorldV25RiverSweep'
import { WORLD_CELL_METERS, WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'

const seed = 'greenway-alpha'
const touches = (from: { x: number; z: number }, to: { x: number; z: number }) =>
  publicV25RiverTouchesSegment(seed, from, to)

describe('V25 river swept contact', () => {
  it('detects wet endpoints and dry paths without a crossing', () => {
    expect(touches({ x: 0, z: 8 }, { x: 0, z: 0 })).toBe(true)
    expect(touches({ x: 0, z: 0 }, { x: 0, z: 8 })).toBe(true)
    expect(touches({ x: 0, z: -8 }, { x: 0, z: -4 })).toBe(false)
    expect(touches({ x: 0, z: -4 }, { x: 0, z: -4 })).toBe(false)
  })

  it('detects crossings in both directions, including several cells in one step', () => {
    const south = { x: 0, z: 0 }
    const north = { x: 0, z: 16 }
    expect(touches(south, north)).toBe(true)
    expect(touches(north, south)).toBe(true)
    expect(touches({ x: -16, z: -8 }, { x: 16, z: 24 })).toBe(true)
    expect(touches({ x: 16, z: 24 }, { x: -16, z: -8 })).toBe(true)
  })

  it('preserves half-open edge ownership instead of making all touching edges wet', () => {
    // z=6 is owned by dry row 1; z=10 is owned by wet row 2.
    expect(touches({ x: -1, z: 6 }, { x: 1, z: 6 })).toBe(false)
    expect(touches({ x: 1, z: 6 }, { x: -1, z: 6 })).toBe(false)
    expect(touches({ x: 0, z: 6 }, { x: 0, z: 5.9 })).toBe(false)
    expect(touches({ x: 0, z: 6 }, { x: 0, z: 6.1 })).toBe(true)
    expect(touches({ x: -1, z: 10 }, { x: 1, z: 10 })).toBe(true)
  })

  it('counts a threaded corner side cell, but not a nearby dry-only diagonal', () => {
    let rise: number | undefined
    for (let gx = WORLD_GRID_MIN + 1; gx <= WORLD_GRID_MAX; gx += 1) {
      if (publicV25RiverCenterZ(seed, gx) > publicV25RiverCenterZ(seed, gx - 1)) {
        rise = gx
        break
      }
    }
    expect(rise).toBeDefined()
    if (rise === undefined) return
    const x = (rise - 0.5) * WORLD_CELL_METERS
    const z = (publicV25RiverCenterZ(seed, rise) + 0.5) * WORLD_CELL_METERS
    const from = { x: x - 1, z: z - 1 }
    const corner = { x: x + 1, z: z + 1 }
    const near = { x: x + 1, z: z + 1.01 }
    expect(publicV25RiverCellAtGrid(seed, rise - 1, publicV25RiverCenterZ(seed, rise))).toBe(false)
    expect(publicV25RiverCellAtGrid(seed, rise, publicV25RiverCenterZ(seed, rise))).toBe(true)
    const wetRightZ = publicV25RiverCenterZ(seed, rise) * WORLD_CELL_METERS
    expect(touches({ x, z: wetRightZ - 0.1 }, { x, z: wetRightZ + 0.1 })).toBe(false)
    expect(touches({ x, z: wetRightZ }, { x: x + 0.01, z: wetRightZ })).toBe(true)
    expect(touches(from, corner)).toBe(true)
    expect(touches(corner, from)).toBe(true)
    expect(touches(from, near)).toBe(false)
    expect(touches(near, from)).toBe(false)
  })

  it('counts the other side of a corner on a falling river bend', () => {
    let fall: number | undefined
    for (let gx = WORLD_GRID_MIN + 1; gx <= WORLD_GRID_MAX; gx += 1) {
      if (publicV25RiverCenterZ(seed, gx) < publicV25RiverCenterZ(seed, gx - 1)) {
        fall = gx
        break
      }
    }
    expect(fall).toBeDefined()
    if (fall === undefined) return
    const x = (fall - 0.5) * WORLD_CELL_METERS
    const z = (publicV25RiverCenterZ(seed, fall) - 0.5) * WORLD_CELL_METERS
    const from = { x: x - 1, z: z + 1 }
    const corner = { x: x + 1, z: z - 1 }
    const near = { x: x + 1, z: z - 1.01 }
    expect(touches(from, corner)).toBe(true)
    expect(touches(corner, from)).toBe(true)
    expect(touches(from, near)).toBe(false)
  })

  it('has no dry bypass at either world-edge river column', () => {
    for (const gx of [WORLD_GRID_MIN, WORLD_GRID_MAX]) {
      const x = gx * WORLD_CELL_METERS
      const z = publicV25RiverCenterZ(seed, gx) * WORLD_CELL_METERS
      const a = { x, z: z - 8 }
      const b = { x, z: z + 8 }
      expect(touches(a, b)).toBe(true)
      expect(touches(b, a)).toBe(true)
    }
  })

  it('rejects malformed seeds, endpoints, and out-of-world canonical cells', () => {
    for (const badSeed of ['', 'x'.repeat(129), null as never, 13 as never]) {
      expect(() => publicV25RiverTouchesSegment(badSeed, { x: 0, z: 0 }, { x: 0, z: 16 }))
        .toThrow(RangeError)
    }
    for (const badPoint of [null, undefined, { x: Number.NaN, z: 0 },
      { x: Number.POSITIVE_INFINITY, z: 0 }, { x: '0', z: 0 },
      { x: (WORLD_GRID_MIN - 0.5) * WORLD_CELL_METERS, z: 0 },
      { x: (WORLD_GRID_MAX + 0.5) * WORLD_CELL_METERS + 0.01, z: 0 }] as never[]) {
      expect(() => touches(badPoint, { x: 0, z: 0 })).toThrow(RangeError)
      expect(() => touches({ x: 0, z: 0 }, badPoint)).toThrow(RangeError)
    }
  })
})
