import { describe, expect, it } from 'vitest'
import { WORLD_GRID_MAX, WORLD_GRID_MIN } from './worldChunks'
import { PUBLIC_V25_RIVER_PROFILE, publicV25RiverCenterZ,
  publicV25RiverCellAtGrid } from './publicWorldV25River'

const seeds = ['greenway-alpha', 'wizard-realms', 'river-eastern-snow']
const key = (gx: number, gz: number) => `${gx},${gz}`

describe('V25 connected river profile', () => {
  it.each(seeds)('makes every wet cell one cardinal component for %s', (seed) => {
    const wet = new Set<string>()
    let priorCenter: number | null = null
    for (let gx = WORLD_GRID_MIN; gx <= WORLD_GRID_MAX; gx += 1) {
      const center = publicV25RiverCenterZ(seed, gx)
      expect(center).toBeGreaterThanOrEqual(WORLD_GRID_MIN)
      expect(center).toBeLessThanOrEqual(WORLD_GRID_MAX)
      if (priorCenter !== null) expect(Math.abs(center - priorCenter)).toBeLessThanOrEqual(1)
      for (let gz = WORLD_GRID_MIN; gz <= WORLD_GRID_MAX; gz += 1) {
        const expected = gz === center || (priorCenter !== null && gz === priorCenter)
        const actual = publicV25RiverCellAtGrid(seed, gx, gz)
        expect(actual).toBe(expected)
        if (actual) wet.add(key(gx, gz))
      }
      priorCenter = center
    }
    expect(wet.has(key(WORLD_GRID_MIN, publicV25RiverCenterZ(seed, WORLD_GRID_MIN)))).toBe(true)
    expect(wet.has(key(WORLD_GRID_MAX, publicV25RiverCenterZ(seed, WORLD_GRID_MAX)))).toBe(true)

    const visited = new Set<string>()
    const queue: [number, number][] = [[WORLD_GRID_MIN,
      publicV25RiverCenterZ(seed, WORLD_GRID_MIN)]]
    for (let next = 0; next < queue.length; next += 1) {
      const [gx, gz] = queue[next]
      const cell = key(gx, gz)
      if (visited.has(cell) || !wet.has(cell)) continue
      visited.add(cell)
      queue.push([gx - 1, gz], [gx + 1, gz], [gx, gz - 1], [gx, gz + 1])
    }
    expect(visited.size).toBe(wet.size)
  })

  it.each(seeds)('preserves exactly the five central crossing cells for %s', (seed) => {
    for (let gx = -2; gx <= 2; gx += 1) {
      expect(publicV25RiverCenterZ(seed, gx)).toBe(2)
      for (let gz = WORLD_GRID_MIN; gz <= WORLD_GRID_MAX; gz += 1) {
        expect(publicV25RiverCellAtGrid(seed, gx, gz)).toBe(gz === 2)
      }
    }
  })

  it('is deterministic, seed-dependent, and pins a named profile', () => {
    expect(PUBLIC_V25_RIVER_PROFILE).toBe('connected-river/v1')
    const signature = (seed: string) => Array.from({ length: 512 }, (_, index) =>
      publicV25RiverCenterZ(seed, index + WORLD_GRID_MIN)).join(',')
    expect(signature(seeds[0])).toBe(signature(seeds[0]))
    expect(new Set(seeds.map(signature)).size).toBeGreaterThan(1)
  })

  it('rejects malformed seeds and all non-grid coordinates', () => {
    for (const seed of ['', 'x'.repeat(129), null as never, 23 as never]) {
      expect(() => publicV25RiverCenterZ(seed, 0)).toThrow(RangeError)
      expect(() => publicV25RiverCellAtGrid(seed, 0, 2)).toThrow(RangeError)
    }
    for (const coordinate of [WORLD_GRID_MIN - 1, WORLD_GRID_MAX + 1,
      Number.NaN, Number.POSITIVE_INFINITY, 0.5, Number.MAX_SAFE_INTEGER + 1,
      undefined as never, null as never, '2' as never]) {
      expect(() => publicV25RiverCenterZ('seed', coordinate)).toThrow(RangeError)
      expect(() => publicV25RiverCellAtGrid('seed', coordinate, 2)).toThrow(RangeError)
      expect(() => publicV25RiverCellAtGrid('seed', 0, coordinate)).toThrow(RangeError)
    }
  })
})
