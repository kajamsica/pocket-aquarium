import { describe, expect, it } from 'vitest'
import { mireglassApproachTrail } from './mireglassApproachTrail'
import { mireglassAnchors } from './mireglassContent'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seeds = [
  ...Array.from({ length: 100 }, (_, index) => `mireglass-corpus-${index}`),
  'greenway-alpha',
]

describe('Mireglass dry approach trail', () => {
  it('routes every seed from marker to salvager on reproducible dry, cardinal, walkable cells', () => {
    for (const seed of seeds) {
      const trail = mireglassApproachTrail(seed)
      const anchors = mireglassAnchors(seed)
      expect(trail.length, seed).toBeGreaterThan(1)
      expect(trail[0], seed).toEqual(anchors.fringeMarker.tile.center)
      expect(trail.at(-1), seed).toEqual(anchors.salvager.tile.center)
      expect(mireglassApproachTrail(seed), `${seed} repeat`).toBe(trail)
      expect(Object.isFrozen(trail), seed).toBe(true)
      expect(Object.isFrozen(trail[0]), seed).toBe(true)
      for (let index = 0; index < trail.length; index += 1) {
        const cell = trail[index]
        const tile = worldTileAtGrid(seed, cell.x / WORLD_CELL_METERS, cell.z / WORLD_CELL_METERS)
        expect(cell, `${seed} cell ${index} (${cell.x}, ${cell.z})`).toEqual(tile.center)
        expect(tile.terrain, `${seed} cell ${index} (${cell.x}, ${cell.z})`).not.toBe('wetland')
        if (index === 0) continue
        const previous = trail[index - 1]
        expect(Math.abs(cell.x - previous.x) + Math.abs(cell.z - previous.z), `${seed} step ${index}`).toBe(WORLD_CELL_METERS)
        expect(mireglassMoveBarrier(seed, previous, cell), `${seed} forward step ${index}`).toBeNull()
        expect(mireglassMoveBarrier(seed, cell, previous), `${seed} reverse step ${index}`).toBeNull()
      }
    }
  }, 120_000)

  it('bounds cached trails while recomputing an evicted seed identically', () => {
    const original = mireglassApproachTrail('mireglass-corpus-0')
    for (let index = 1; index <= 8; index += 1) mireglassApproachTrail(`mireglass-corpus-${index}`)
    const replay = mireglassApproachTrail('mireglass-corpus-0')
    expect(replay).not.toBe(original)
    expect(replay).toEqual(original)
  })
})
