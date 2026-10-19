import { describe, expect, it } from 'vitest'
import { mireglassAnchors } from './mireglassContent'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { isValidPublicWorldV9State, withFreshPublicV9Camps } from './publicWorldV9State'
import { isValidPublicWorldV10State, publicV10BaseGroundWitness,
  withPublicV10TerrainRevision } from './publicWorldV10State'

const seed = 'greenway-alpha'
const fresh = withFreshPublicV9Camps(withFreshPublicV7Herbs(createFreshPublicWorld(seed, 'greenway-classic-v1')))
const v10 = withPublicV10TerrainRevision(fresh)

function excavatedAtCache(y: number) {
  const cache = mireglassAnchors(seed).sealCache.tile
  return { ...v10, movementOwner: 'streamed' as const,
    player: { ...v10.player, xp: 50, level: 1, position: { ...cache.center, y },
      inventory: [...v10.player.inventory, { itemId: 'mireglass_reach/item/seal' as const, quantity: 1 }],
      learnedSpellIds: ['wayfinder_glow' as const],
      skillXp: { ...v10.player.skillXp, wayfinding: 10, spellcraft: 10, excavation: 40 } },
    discoveredTileIds: [...v10.discoveredTileIds, cache.id].sort(),
    mireglass: { ...v10.mireglass, fringeMarkerStudied: true,
      cacheRevealed: true, cacheExcavated: true } }
}

describe('public v10 effective-terrain state', () => {
  it('adds only the fixed revision marker and leaves the v9 source untouched', () => {
    expect(v10).toEqual({ ...fresh, terrainRevision: 'mireglass-cache-pit-v1' })
    expect(v10.player).toBe(fresh.player)
    expect(isValidPublicWorldV10State(v10, null)).toBe(true)
    expect(isValidPublicWorldV9State(v10, null)).toBe(false)
    expect(isValidPublicWorldV10State(fresh, null)).toBe(false)
    expect(() => withPublicV10TerrainRevision(v10)).toThrow(RangeError)
  })

  it('accepts a real landed pit pose while v9 rejects it, and keeps the witness detached', () => {
    const landed = excavatedAtCache(1.65)
    expect(isValidPublicWorldV10State(landed, null)).toBe(true)
    const witness = publicV10BaseGroundWitness(landed)
    expect(witness.player.position.y).toBeCloseTo(2.4)
    expect(landed.player.position.y).toBe(1.65)
    expect(isValidPublicWorldV9State(witness, null)).toBe(true)
    const { terrainRevision: _revision, ...withoutMarker } = landed
    expect(isValidPublicWorldV9State(withoutMarker, null)).toBe(false)
  })

  it('rejects any below-ground pose without the dig fact, wrong cell, or malformed exact keys', () => {
    const landed = excavatedAtCache(1.65)
    expect(isValidPublicWorldV10State({ ...landed, mireglass: { ...landed.mireglass,
      cacheExcavated: false } }, null)).toBe(false)
    expect(isValidPublicWorldV10State({ ...landed, player: { ...landed.player,
      position: { ...landed.player.position, y: 1.64 } } }, null)).toBe(false)
    expect(isValidPublicWorldV10State({ ...landed, terrainRevision: 'other' }, null)).toBe(false)
    expect(isValidPublicWorldV10State({ ...landed, extra: true }, null)).toBe(false)
    const hidden = { ...landed }
    Object.defineProperty(hidden, 'hidden', { value: true })
    expect(isValidPublicWorldV10State(hidden, null)).toBe(false)
  })
})
