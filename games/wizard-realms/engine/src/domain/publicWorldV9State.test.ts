import { describe, expect, it } from 'vitest'
import { createFreshPublicWorld } from './publicWorldState'
import { isValidPublicWorldV7State, withFreshPublicV7Herbs } from './publicWorldV7'
import { isValidPublicWorldV9State, withFreshPublicV9Camps } from './publicWorldV9State'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const v7 = withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1'))
const empty = withFreshPublicV9Camps(v7)
const tile = worldTileAtGrid(seed, -76, 100)
const other = worldTileAtGrid(seed, -70, 100)
const camp = { ...empty, discoveredTileIds: [...empty.discoveredTileIds, tile.id].sort(), fieldCampTileIds: [tile.id] }

describe('exact public v9 camp state', () => {
  it('adds only empty camp history to decoded v8 and preserves the older validator boundary', () => {
    expect(empty).toEqual({ ...v7, fieldCampTileIds: [] })
    expect(empty.player).toBe(v7.player)
    expect(isValidPublicWorldV9State(empty, null)).toBe(true)
    expect(isValidPublicWorldV7State(empty, null)).toBe(false)
    expect(isValidPublicWorldV9State(v7, null)).toBe(false)
    expect(() => withFreshPublicV9Camps(empty)).toThrow(RangeError)
  })

  it('validates one canonical discovered site across reload and travel', () => {
    expect(isValidPublicWorldV9State(camp, null)).toBe(true)
    expect(isValidPublicWorldV9State(JSON.parse(JSON.stringify(camp)), null)).toBe(true)
    expect(isValidPublicWorldV9State({ ...camp, tick: 1 }, null)).toBe(true)
    expect(isValidPublicWorldV9State({ ...camp, fieldCampTileIds: [other.id] }, null)).toBe(false)
  })

  it('rejects malformed IDs, duplicates, extra keys and tampered v7 facts', () => {
    for (const fieldCampTileIds of [null, 'tile', [null], ['invented'], ['tile--073-103'],
      ['tile-0-0'], [tile.id, tile.id], [tile.id, other.id], [other.id, tile.id]]) {
      expect(isValidPublicWorldV9State({ ...camp, fieldCampTileIds }, null)).toBe(false)
    }
    expect(isValidPublicWorldV9State({ ...camp, fieldCampTileIds: new Array(1) }, null)).toBe(false)
    const sparseWithOtherKey = new Array(1) as string[] & { extra?: boolean }
    sparseWithOtherKey.extra = true
    expect(isValidPublicWorldV9State({ ...camp, fieldCampTileIds: sparseWithOtherKey }, null)).toBe(false)
    const extraArrayKey = [tile.id] as string[] & { extra?: boolean }
    extraArrayKey.extra = true
    expect(isValidPublicWorldV9State({ ...camp, fieldCampTileIds: extraArrayKey }, null)).toBe(false)
    expect(isValidPublicWorldV9State({ ...camp, extra: true }, null)).toBe(false)
    const hidden = { ...camp }
    Object.defineProperty(hidden, 'hidden', { value: true })
    expect(isValidPublicWorldV9State(hidden, null)).toBe(false)
    expect(isValidPublicWorldV9State({ ...camp, [Symbol('extra')]: true }, null)).toBe(false)
    expect(isValidPublicWorldV9State({ ...camp, tick: -1 }, null)).toBe(false)
    expect(isValidPublicWorldV9State({ ...camp, mireglass: { ...camp.mireglass, herbHarvestCycles: [{ patchId: 'invented', cycle: 0 }] } }, null)).toBe(false)
  })
})
