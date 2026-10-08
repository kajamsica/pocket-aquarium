import { describe, expect, it } from 'vitest'
import { createActiveWorldTerrain } from './activeWorldTerrain'
import { hashSeed } from './generation'
import {
  classifyStreamedRegion, HIGHLAND_CONTENT_REVISION, HIGHLAND_CORE, HIGHLAND_LANDMARK,
  highlandCorridorCells, highlandLandmark, highlandStoneNodes, isHighlandAuthoredPosition,
} from './highlandContent'
import { mireglassAnchors } from './mireglassContent'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { createStreamedWorld } from './streamedWorld'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const seeds = ['greenway-alpha', 'wizard-realms',
  ...Array.from({ length: 100 }, (_, index) => `mireglass-corpus-${index}`)]
const CELL = WORLD_CELL_METERS

describe('Highland quarry pinned content', () => {
  it('pins a 248-cell, 988 m cardinal corridor with the stated waypoints and x-first ties', () => {
    const route = highlandCorridorCells()
    expect(route).toHaveLength(248)
    expect(route[0]).toEqual({ x: 12, z: 0 })
    expect(route.at(-1)).toEqual({ x: 520, z: -480 })
    expect(route).toContainEqual({ x: 384, z: -320 })
    expect(route).toContainEqual({ x: 464, z: -432 })
    expect(route).toContainEqual({ x: 448, z: -384 })
    expect(route.slice(route.findIndex((cell) => cell.x === 96 && cell.z === 0),
      route.findIndex((cell) => cell.x === 96 && cell.z === 0) + 3))
      .toEqual([{ x: 96, z: 0 }, { x: 100, z: 0 }, { x: 100, z: -4 }])
    expect(Object.isFrozen(route)).toBe(true)
    expect(route.every(Object.isFrozen)).toBe(true)
    for (let index = 1; index < route.length; index += 1) {
      const a = route[index - 1]
      const b = route[index]
      expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)).toBe(CELL)
    }
  })

  it('selects four stable, physically rocky nodes at least 20 m apart over all 102 seeds', () => {
    for (const seed of seeds) {
      const nodes = highlandStoneNodes(seed)
      expect(nodes, seed).toHaveLength(4)
      expect(new Set(nodes.map((node) => node.id)).size, seed).toBe(4)
      const seedHash = hashSeed(seed).toString(16).padStart(8, '0')
      for (const [index, node] of nodes.entries()) {
        const { x, z } = node.tile.center
        expect(x, seed).toBeGreaterThanOrEqual(500)
        expect(x, seed).toBeLessThan(540)
        expect(z, seed).toBeGreaterThanOrEqual(-500)
        expect(z, seed).toBeLessThan(-460)
        expect(node.tile.terrain, seed).toBe('rocky')
        expect(node.id, seed).toBe(`highland_quarry/${HIGHLAND_CONTENT_REVISION}/stone/${seedHash}/${x / CELL}/${z / CELL}`)
        expect(node.tile.gridX, seed).toBe(x / CELL + 3)
        expect(node.tile.gridZ, seed).toBe(z / CELL + 3)
        for (const prior of nodes.slice(0, index)) {
          expect(Math.hypot(x - prior.tile.center.x, z - prior.tile.center.z), seed).toBeGreaterThanOrEqual(20)
        }
      }
      expect(highlandStoneNodes(seed), `${seed} repeat`).toBe(nodes)
      expect(Object.isFrozen(nodes), seed).toBe(true)
      expect(nodes.every((node) => Object.isFrozen(node) && Object.isFrozen(node.tile)
        && Object.isFrozen(node.tile.center)), seed).toBe(true)
    }
    expect(highlandStoneNodes('greenway-alpha').map(({ tile }) => [tile.center.x, tile.center.z]))
      .toEqual([[528, -488], [528, -468], [508, -484], [508, -464]])
  }, 45_000)

  it('keeps the landmark and node catalog canonical after unrelated chunk activation orders', () => {
    for (const seed of seeds.slice(0, 3)) {
      const original = highlandStoneNodes(seed).map((node) => ({ id: node.id, tile: node.tile }))
      const route = highlandCorridorCells()
      for (const ordered of [route, [...route].reverse()]) {
        const active = createActiveWorldTerrain(seed)
        for (const point of ordered) {
          active.activate(point)
          expect(active.tileAtWorld(point.x, point.z), `${seed} ${point.x},${point.z}`)
            .toEqual(worldTileAtGrid(seed, point.x / CELL, point.z / CELL))
          expect(active.activeChunkCount).toBeLessThanOrEqual(9)
        }
      }
      for (let index = 0; index < 8; index += 1) highlandStoneNodes(`cache-evict-${seed}-${index}`)
      expect(highlandStoneNodes(seed)).toEqual(original)
      expect(highlandLandmark(seed)).toMatchObject({ id: HIGHLAND_LANDMARK.id,
        tile: { center: { x: 464, z: -432 }, terrain: 'rocky' } })
    }
  }, 45_000)

  it('walks the pinned corridor out and back under streamed movement authority', () => {
    const route = highlandCorridorCells()
    for (const seed of seeds.slice(0, 3)) {
      const runtime = createStreamedWorld(seed, route[0])
      for (const ordered of [route, [...route].reverse()]) {
        for (let index = 1; index < ordered.length; index += 1) {
          const previous = ordered[index - 1]
          const next = ordered[index]
          const result = runtime.advance([{ type: 'move', delta: {
            x: next.x - previous.x, z: next.z - previous.z,
          } }], { atomicOnRejection: true })
          expect(result.rejections, `${seed} ${previous.x},${previous.z} to ${next.x},${next.z}`).toEqual([])
          expect(result.state.player.position).toMatchObject(next)
          expect(runtime.activeChunkCount()).toBeLessThanOrEqual(9)
        }
      }
      expect(runtime.state.player.position).toMatchObject(route[0])
    }
  }, 45_000)

  it('keeps the dry walking corridor reversible across all 102 seeds', () => {
    const route = highlandCorridorCells()
    for (const seed of seeds) {
      let maxRise = 0
      for (let index = 0; index < route.length; index += 1) {
        const here = route[index]
        const tile = worldTileAtGrid(seed, here.x / CELL, here.z / CELL)
        expect(tile.terrain, `${seed} cell ${index}`).not.toBe('wetland')
        if (index === 0) continue
        const previous = route[index - 1]
        const from = worldTileAtGrid(seed, previous.x / CELL, previous.z / CELL)
        expect(mireglassMoveBarrier(seed, previous, here), `${seed} forward ${index}`).toBeNull()
        expect(mireglassMoveBarrier(seed, here, previous), `${seed} reverse ${index}`).toBeNull()
        maxRise = Math.max(maxRise, Math.abs(tile.center.y - from.center.y))
      }
      expect(maxRise, seed).toBeLessThan(0.75)
    }
  }, 45_000)

  it('classifies only the authored Highland core and late corridor, with seed-aware Mireglass approach', () => {
    expect(HIGHLAND_CORE).toEqual({ minX: 448, maxX: 544, minZ: -512, maxZ: -424 })
    expect(isHighlandAuthoredPosition({ x: 464, z: -432 })).toBe(true)
    expect(isHighlandAuthoredPosition({ x: 384, z: -320 })).toBe(true)
    expect(isHighlandAuthoredPosition({ x: 320, z: -224 })).toBe(false)
    expect(classifyStreamedRegion('greenway-alpha', { x: 320, z: -224 })).toBe('wilderness')
    expect(classifyStreamedRegion('greenway-alpha', { x: 200, z: -100 })).toBe('wilderness')
    expect(classifyStreamedRegion('greenway-alpha', { x: 520, z: -480 })).toBe('highland_quarry')
    // Mireglass has its fixed core, one-cell side banks, a z=520 back bank,
    // the marker envelope, and an 8 m halo along the seed-dependent approach.
    expect(classifyStreamedRegion('greenway-alpha', { x: -300, z: 300 })).toBe('mireglass_reach')
    expect(classifyStreamedRegion('greenway-alpha', { x: -452, z: 400 })).toBe('mireglass_reach')
    expect(classifyStreamedRegion('greenway-alpha', { x: -252, z: 400 })).toBe('mireglass_reach')
    expect(classifyStreamedRegion('greenway-alpha', { x: -300, z: 520 })).toBe('mireglass_reach')
    expect(classifyStreamedRegion('greenway-alpha', { x: -460, z: 400 })).toBe('wilderness')
    expect(classifyStreamedRegion('greenway-alpha', { x: -248, z: 400 })).toBe('wilderness')
    expect(classifyStreamedRegion('greenway-alpha', { x: -300, z: 524 })).toBe('wilderness')

    const firstSeed = 'greenway-alpha'
    const firstMarker = mireglassAnchors(firstSeed).fringeMarker.tile.center
    const otherSeed = seeds.find((seed) => Math.abs(mireglassAnchors(seed).fringeMarker.tile.center.x
      - firstMarker.x) > 16)
    expect(otherSeed).toBeDefined()
    const approach = { x: firstMarker.x, z: 40 }
    expect(classifyStreamedRegion(firstSeed, approach)).toBe('mireglass_reach')
    expect(classifyStreamedRegion(otherSeed!, approach)).toBe('wilderness')
  }, 45_000)
})
