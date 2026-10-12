import { describe, expect, it } from 'vitest'
import { discoveredTileSet, nearbyWorldTileIds, PUBLIC_START_REVEAL_RADIUS_METERS,
  PUBLIC_WALK_REVEAL_RADIUS_METERS, PUBLIC_SPELL_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'

describe('public-world discovery membership', () => {
  it('reuses one set per frozen array without changing or sorting its input', () => {
    const ids = Object.freeze(['tile-8-3', 'tile-3-3'])
    const known = discoveredTileSet(ids)
    expect(discoveredTileSet(ids)).toBe(known)
    expect(discoveredTileSet(Object.freeze([...ids]))).not.toBe(known)
    expect([...known]).toEqual(ids)
    expect(ids).toEqual(['tile-8-3', 'tile-3-3'])
  })

  it('rebuilds mutable arrays so in-place additions and replacements stay visible', () => {
    const ids = ['tile-3-3']
    const first = discoveredTileSet(ids)
    ids.push('tile-8-3')
    const second = discoveredTileSet(ids)
    expect(second).not.toBe(first)
    expect(first.has('tile-8-3')).toBe(false)
    expect(second.has('tile-8-3')).toBe(true)
    ids[0] = 'tile-9-3'
    const third = discoveredTileSet(ids)
    expect(third.has('tile-3-3')).toBe(false)
    expect(third.has('tile-9-3')).toBe(true)
    expect(ids).toEqual(['tile-9-3', 'tile-8-3'])
  })
})

describe('public-world discovery circles', () => {
  it('supports a bounded 24-meter spell circle without expanding walking discovery', () => {
    const spell = nearbyWorldTileIds({ x: 0, z: 0 }, PUBLIC_SPELL_REVEAL_RADIUS_METERS)
    const walk = nearbyWorldTileIds({ x: 0, z: 0 }, PUBLIC_WALK_REVEAL_RADIUS_METERS)
    expect(spell).toContain('tile-9-3')
    expect(spell).not.toContain('tile-9-4')
    expect(walk).not.toContain('tile-9-3')
    expect(walk.every((id) => spell.includes(id))).toBe(true)
    expect(() => nearbyWorldTileIds({ x: 0, z: 0 }, 24.01)).toThrow(RangeError)
  })

  it('starts in a 24m-wide clearing of 29 canonical 4m cells', () => {
    const ids = nearbyWorldTileIds({ x: 0, z: 0 }, PUBLIC_START_REVEAL_RADIUS_METERS)
    expect(ids).toHaveLength(29)
    expect(ids).toContain('tile-3-3')
    expect(ids).toContain('tile-6-3') // 12m from the origin
    expect(ids).not.toContain('tile-6-4') // just outside the circular edge
    expect(ids).toEqual([...ids].sort())
  })

  it('reveals tile centers within 16m of the walking pose, across a cell boundary', () => {
    const ids = nearbyWorldTileIds({ x: 8.16, z: 0 }, PUBLIC_WALK_REVEAL_RADIUS_METERS)
    expect(ids).toContain('tile-8-3') // x=20, before entering that cell
    expect(ids).toContain('tile-7-4') // x=16, z=4
    expect(ids).toContain('tile-8-4') // x=20, z=4 is now within the radius
    expect(ids).toContain('tile-8-5') // x=20, z=8 is now within the radius
    expect(ids).toContain('tile-9-3') // x=24 is now within the radius
    expect(ids).not.toContain('tile-9-4') // x=24, z=4 remains beyond the radius
  })

  it('stays inside world bounds at a remote edge', () => {
    const ids = nearbyWorldTileIds({ x: 255 * 4, z: 255 * 4 }, PUBLIC_WALK_REVEAL_RADIUS_METERS)
    expect(ids).toContain('tile-258-258')
    expect(ids.some((id) => /tile-(259|260)-/.test(id))).toBe(false)
  })
})
