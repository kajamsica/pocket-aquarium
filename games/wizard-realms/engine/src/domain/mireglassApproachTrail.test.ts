import { describe, expect, it } from 'vitest'
import { createGeneratedWorld } from './generation'
import { mireglassApproachTrail, mireglassGreenwayToMarkerTrail } from './mireglassApproachTrail'
import { mireglassAnchors } from './mireglassContent'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { createStreamedWorld } from './streamedWorld'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seeds = [
  ...Array.from({ length: 100 }, (_, index) => `mireglass-corpus-${index}`),
  'greenway-alpha',
]

describe('Mireglass dry approach trail', () => {
  it('walks dry canonical cells from fresh Greenway through both profile edges to the marker across 100 seeds', () => {
    for (const seed of seeds.slice(0, 100)) {
      const trail = mireglassGreenwayToMarkerTrail(seed)
      const marker = mireglassAnchors(seed).fringeMarker.tile.center
      expect(trail[0], seed).toEqual(worldTileAtGrid(seed, 0, 0).center)
      expect(trail.at(-1), seed).toEqual(marker)
      expect(mireglassGreenwayToMarkerTrail(seed), `${seed} cached`).toBe(trail)
      expect(Object.isFrozen(trail), seed).toBe(true)
      expect(Object.isFrozen(trail[0]), seed).toBe(true)

      for (const [profile, edgeX] of [
        ['greenway-classic-v1', -12], ['greenway-expanded-v1', -28],
      ] as const) {
        const greenway = createGeneratedWorld(seed, profile)
        const edge = trail.findIndex(({ x, z }) => x === edgeX && z === 0)
        expect(edge, `${seed} ${profile} edge`).toBeGreaterThan(0)
        expect(greenway.tiles.find(({ center }) => center.x === edgeX && center.z === 0), `${seed} ${profile}`)
          .toEqual(worldTileAtGrid(seed, edgeX / WORLD_CELL_METERS, 0))
        expect(trail[edge + 1], `${seed} ${profile} handoff`).toMatchObject({ x: edgeX - WORLD_CELL_METERS, z: 0 })
        expect(greenway.tiles.some(({ center }) => center.x === trail[edge + 1].x
          && center.z === trail[edge + 1].z), `${seed} ${profile} outside footprint`).toBe(false)
      }

      const streamed = createStreamedWorld(seed)
      for (let index = 0; index < trail.length; index += 1) {
        const cell = trail[index]
        const tile = worldTileAtGrid(seed, cell.x / WORLD_CELL_METERS, cell.z / WORLD_CELL_METERS)
        expect(cell, `${seed} cell ${index}`).toEqual(tile.center)
        expect(tile.terrain, `${seed} cell ${index}`).not.toBe('wetland')
        if (index === 0) continue
        const previous = trail[index - 1]
        const delta = { x: cell.x - previous.x, z: cell.z - previous.z }
        expect(Math.abs(delta.x) + Math.abs(delta.z), `${seed} step ${index}`).toBe(WORLD_CELL_METERS)
        expect(mireglassMoveBarrier(seed, previous, cell), `${seed} forward ${index}`).toBeNull()
        expect(mireglassMoveBarrier(seed, cell, previous), `${seed} reverse ${index}`).toBeNull()
        const moved = streamed.advance([{ type: 'move', delta }])
        expect(moved.rejections, `${seed} streamed move ${index}`).toEqual([])
        expect(moved.state.player.position, `${seed} streamed position ${index}`)
          .toMatchObject({ x: cell.x, z: cell.z })
        expect(moved.state.discoveredTileIds, `${seed} discovered ${tile.id}`).toContain(tile.id)
      }
    }
  }, 120_000)

  it('bounds the Greenway connector cache while regenerating the same path and canonical tile IDs', () => {
    const seed = 'mireglass-corpus-0'
    const original = mireglassGreenwayToMarkerTrail(seed)
    const originalIds = original.map(({ x, z }) => worldTileAtGrid(seed,
      x / WORLD_CELL_METERS, z / WORLD_CELL_METERS).id)
    const existingApproach = mireglassApproachTrail(seed)
    for (let index = 1; index <= 8; index += 1) mireglassGreenwayToMarkerTrail(`mireglass-corpus-${index}`)
    const replay = mireglassGreenwayToMarkerTrail(seed)
    expect(replay).not.toBe(original)
    expect(replay).toEqual(original)
    expect(replay.map(({ x, z }) => worldTileAtGrid(seed,
      x / WORLD_CELL_METERS, z / WORLD_CELL_METERS).id)).toEqual(originalIds)
    expect(mireglassApproachTrail(seed)).toBe(existingApproach)
  })

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
