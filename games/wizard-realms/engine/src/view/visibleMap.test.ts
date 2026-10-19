import { describe, expect, it } from 'vitest'
import { visibleMapTiles } from './visibleMap'

const grid = (width: number, depth = width) => Array.from({ length: width * depth }, (_, index) => ({
  gridX: index % width - Math.floor(width / 2),
  gridZ: Math.floor(index / width) - Math.floor(depth / 2),
}))

describe('bounded local map', () => {
  it('keeps the complete classic and expanded Greenway map', () => {
    for (const size of [7, 16]) {
      const tiles = grid(size)
      expect(visibleMapTiles(tiles, 0, 0)).toEqual(tiles)
      expect(visibleMapTiles(tiles, -100, 100)).toEqual(tiles)
    }
  })

  it('keeps a 33 by 33 local atlas while moving and clamps it at edges', () => {
    const tiles = grid(48)
    const middle = visibleMapTiles(tiles, 0, 0)
    expect(middle).toHaveLength(33 * 33)
    expect([middle[0].gridX, middle[0].gridZ]).toEqual([-16, -16])
    expect([middle.at(-1)?.gridX, middle.at(-1)?.gridZ]).toEqual([16, 16])
    const edge = visibleMapTiles(tiles, -24, 23)
    expect(edge).toHaveLength(33 * 33)
    expect([edge[0].gridX, edge[0].gridZ]).toEqual([-24, -9])
    expect([edge.at(-1)?.gridX, edge.at(-1)?.gridZ]).toEqual([8, 23])
  })

  it('orders shuffled input north-up and keeps a bounded custom radius', () => {
    const tiles = grid(48)
    const local = visibleMapTiles([...tiles].reverse(), 0, 0, 2)
    expect(local).toHaveLength(25)
    expect(local[0]).toEqual({ gridX: -2, gridZ: -2 })
    expect(local.at(-1)).toEqual({ gridX: 2, gridZ: 2 })
    expect(visibleMapTiles(tiles, 0, 0, Infinity)).toHaveLength(33 * 33)
    expect(visibleMapTiles([], 0, 0)).toEqual([])
  })
})
