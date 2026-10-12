import { describe, expect, it } from 'vitest'
import { hashSeed } from './generation'
import { PUBLIC_V25_BEDROCK_LAYER, publicV25StratumAt } from './publicWorldV25Strata'
import { WORLD_GRID_MAX, WORLD_GRID_MIN, worldTileAtGrid } from './worldChunks'

describe('V25 saved ground strata', () => {
  it('uses the existing terrain for both shallow layers, with the correct tool gates', () => {
    const fixtures = [
      [0, 160, 'loam', 'soil', 'spade', 1],
      [-160, 160, 'wetland', 'soil', 'spade', 1],
      [160, -160, 'rocky', 'stone', 'pick', 2],
      [0, -7, 'snow', 'stone', 'pick', 2],
    ] as const
    for (const [gx, gz, terrain, material, toolTier, minimumExcavationLevel] of fixtures) {
      expect(worldTileAtGrid('strata-terrain', gx, gz).terrain).toBe(terrain)
      for (const layer of [0, 1]) {
        expect(publicV25StratumAt('strata-terrain', gx, gz, layer)).toEqual({ material, toolTier, minimumExcavationLevel })
      }
    }
  })

  it('keeps bedrock solid at layer 12, including world-edge columns', () => {
    expect(PUBLIC_V25_BEDROCK_LAYER).toBe(12)
    for (const [gx, gz] of [[0, 0], [WORLD_GRID_MIN, WORLD_GRID_MIN], [WORLD_GRID_MAX, WORLD_GRID_MAX]]) {
      expect(publicV25StratumAt('strata-bedrock', gx, gz, 12)).toEqual({
        material: 'bedrock', toolTier: 'none', minimumExcavationLevel: 0,
      })
    }
  })

  it('applies ordered 4096-point mineral thresholds only at their allowed depths', () => {
    const observed = new Set<string>()
    for (let layer = 2; layer <= 11; layer += 1) {
      for (let gx = -16; gx <= 16; gx += 1) for (let gz = -16; gz <= 16; gz += 1) {
        const roll = hashSeed(`strata-gates:v25:stratum:${gx}:${gz}:${layer}`) % 4096
        const expected = layer >= 8 && roll < 8 ? ['diamond', 'enchanted_pick', 25]
          : layer >= 5 && roll < 64 ? ['gold_ore', 'pick', 12]
            : layer >= 3 && roll < 512 ? ['iron_ore', 'pick', 5]
              : ['stone', 'pick', 2]
        const result = publicV25StratumAt('strata-gates', gx, gz, layer)
        expect([result.material, result.toolTier, result.minimumExcavationLevel]).toEqual(expected)
        observed.add(`${layer}:${result.material}`)
      }
    }
    expect(observed.has('2:stone')).toBe(true)
    expect(observed.has('3:iron_ore')).toBe(true)
    expect(observed.has('5:gold_ore')).toBe(true)
    expect(observed.has('8:diamond')).toBe(true)
    expect([...observed].every((entry) => !entry.startsWith('2:iron_ore')
      && !entry.startsWith('3:gold_ore') && !entry.startsWith('5:diamond'))).toBe(true)
  })

  it('can yield gold and diamond in a bounded grid sample, but not shallow ores', () => {
    const minerals = new Set<string>()
    for (let gx = -32; gx <= 32; gx += 1) for (let gz = -32; gz <= 32; gz += 1) {
      minerals.add(publicV25StratumAt('strata-sample', gx, gz, 8).material)
      for (const layer of [0, 1, 2]) {
        expect(['soil', 'stone']).toContain(publicV25StratumAt('strata-sample', gx, gz, layer).material)
      }
    }
    expect(minerals.has('gold_ore')).toBe(true)
    expect(minerals.has('diamond')).toBe(true)
  })

  it('is stable across call order, seed changes, and caller mutation', () => {
    const coordinates = [[-31, 5, 3], [17, -13, 7], [5, 29, 9]] as const
    const initial = coordinates.map(([gx, gz, layer]) => publicV25StratumAt('strata-order', gx, gz, layer))
    publicV25StratumAt('strata-order', 255, -256, 11)
    expect(coordinates.map(([gx, gz, layer]) => publicV25StratumAt('strata-order', gx, gz, layer))).toEqual(initial)
    let seedChange = false
    for (let gx = -16; gx <= 16 && !seedChange; gx += 1) for (let gz = -16; gz <= 16; gz += 1) {
      seedChange ||= publicV25StratumAt('strata-order', gx, gz, 8).material
        !== publicV25StratumAt('strata-other', gx, gz, 8).material
    }
    expect(seedChange).toBe(true)
    initial[0].material = 'bedrock'
    expect(publicV25StratumAt('strata-order', ...coordinates[0]).material).not.toBe('bedrock')
  })

  it('rejects invalid seeds, grid coordinates, and depth', () => {
    for (const seed of ['', 'x'.repeat(129), undefined as unknown as string]) {
      expect(() => publicV25StratumAt(seed, 0, 0, 0)).toThrow(RangeError)
    }
    expect(() => publicV25StratumAt(' ', 0, 0, 0)).not.toThrow()
    for (const coordinate of [-257, 256, 0.5, NaN, Infinity]) {
      expect(() => publicV25StratumAt('valid', coordinate, 0, 0)).toThrow(RangeError)
      expect(() => publicV25StratumAt('valid', 0, coordinate, 0)).toThrow(RangeError)
    }
    for (const layer of [-1, 13, 0.5, NaN, Infinity]) {
      expect(() => publicV25StratumAt('valid', 0, 0, layer)).toThrow(RangeError)
    }
  })
})
