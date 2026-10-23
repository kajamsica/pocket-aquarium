import { describe, expect, it } from 'vitest'
import type { WizardTerrainCell } from './contracts'
import { visibleWildCreatureEncounters } from './wildCreatureEncounters'

const cell = (x: number, z: number, y = 2, size = 4): WizardTerrainCell => ({
  id: `tile-${x}-${z}`, position: [x, y, z], size: [size, size],
  height: y, climate: 'temperate_forest',
})

describe('wild creature encounter selection', () => {
  it('requires the exact revealed 4 m cell and uses its visual height', () => {
    const player = [528, 0, -496] as const
    expect(visibleWildCreatureEncounters([], player, [])).toEqual([])
    expect(visibleWildCreatureEncounters([cell(528, -496, 3, 8)], player, [])).toEqual([])
    const [barrow] = visibleWildCreatureEncounters([cell(528, -496, 3)], player, [])
    expect(barrow).toMatchObject({ id: 'barrow-mole', modelId: 'barrow-mole',
      position: [528, 3, -496], idleClip: 'Idle' })
  })

  it('includes a revealed encounter at 60 m, but not beyond that radius', () => {
    const terrain = [cell(528, -496)]
    expect(visibleWildCreatureEncounters(terrain, [588, 0, -496], [])).toHaveLength(1)
    expect(visibleWildCreatureEncounters(terrain, [588.01, 0, -496], [])).toEqual([])
  })

  it('hides an open pit encounter while leaving a closed column visible', () => {
    const terrain = [cell(528, -496)]
    const player = [528, 0, -496] as const
    expect(visibleWildCreatureEncounters(terrain, player,
      [{ gx: 132, gz: -124, openDepth: 1 }])).toEqual([])
    expect(visibleWildCreatureEncounters(terrain, player,
      [{ gx: 132, gz: -124, openDepth: 0 }])).toHaveLength(1)
  })

  it('returns at most two nearby species in stable ID order, never the late Aether Ray', () => {
    const terrain = [cell(480, -484), cell(528, -496), cell(656, -468), cell(-344, 340)]
    const ids = visibleWildCreatureEncounters(terrain, [504, 0, -490], []).map(({ id }) => id)
    expect(ids).toEqual(['barrow-mole', 'ironback-beetle'])
    expect(ids).toHaveLength(2)
    expect(ids).not.toContain('aether-ray')
  })
})
