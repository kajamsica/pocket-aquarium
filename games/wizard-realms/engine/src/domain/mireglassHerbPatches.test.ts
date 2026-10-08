import { describe, expect, it } from 'vitest'
import { mireglassApproachTrail } from './mireglassApproachTrail'
import { mireglassAnchors, mireglassFairyRing, mireglassResources } from './mireglassContent'
import { mireglassHerbPatches } from './mireglassHerbPatches'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { mireglassRouteSites } from './mireglassRouteSites'
import { MIREGLASS_CORE, MIREGLASS_ENVELOPES } from './mireglassTerrain'
import { createStreamedWorld } from './streamedWorld'
import type { Vec3 } from './types'
import { WORLD_CELL_METERS, worldTileAtGrid } from './worldChunks'

const CELL = WORLD_CELL_METERS
const DIRECTIONS = [[-CELL, 0], [CELL, 0], [0, -CELL], [0, CELL]] as const
const seeds = Array.from({ length: 100 }, (_, index) => `mireglass-corpus-${index}`)
const key = ({ x, z }: Pick<Vec3, 'x' | 'z'>) => `${x},${z}`
const distance = (a: Pick<Vec3, 'x' | 'z'>, b: Pick<Vec3, 'x' | 'z'>) =>
  Math.hypot(a.x - b.x, a.z - b.z)

function segmentDistance(point: Vec3, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const projection = Math.max(0, Math.min(1,
    ((point.x - from.x) * dx + (point.z - from.z) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(point.x - from.x - projection * dx, point.z - from.z - projection * dz)
}

/** Walk the normal movement graph in a wider window than the placement search. */
function walkingWitness(seed: string, start: Vec3) {
  const queue: Array<Pick<Vec3, 'x' | 'z'>> = [start]
  const parent = new Map<string, string | null>([[key(start), null]])
  const points = new Map<string, Pick<Vec3, 'x' | 'z'>>([[key(start), start]])
  for (let head = 0; head < queue.length; head += 1) {
    const from = queue[head]
    for (const [dx, dz] of DIRECTIONS) {
      const to = { x: from.x + dx, z: from.z + dz }
      if (to.x < MIREGLASS_CORE.minX || to.x > MIREGLASS_CORE.maxX
        || to.z < MIREGLASS_CORE.minZ || to.z > MIREGLASS_ENVELOPES.bellAlder.maxZ + 2 * CELL
        || parent.has(key(to))
        || mireglassMoveBarrier(seed, from, to) !== null
        || mireglassMoveBarrier(seed, to, from) !== null) continue
      parent.set(key(to), key(from))
      points.set(key(to), to)
      queue.push(to)
    }
  }
  const pathTo = (end: Vec3) => {
    const path: Array<Pick<Vec3, 'x' | 'z'>> = []
    for (let at: string | null | undefined = key(end); at !== null; at = parent.get(at)) {
      if (at === undefined) throw new Error(`${seed}: no path to ${key(end)}`)
      path.push(points.get(at)!)
    }
    return path.reverse()
  }
  return { parent, pathTo }
}

describe('Mireglass Bell Alder herb patch catalog', () => {
  it('places three or four dry, clear, reachable marsh-edge patches across 100 seeds', () => {
    const envelope = MIREGLASS_ENVELOPES.bellAlder
    for (const seed of seeds) {
      const anchors = mireglassAnchors(seed)
      const patches = mireglassHerbPatches(seed)
      const occupied = [
        ...Object.values(anchors).map(({ tile }) => tile.center),
        ...mireglassResources(seed).map(({ tile }) => tile.center),
        mireglassFairyRing(seed).tile.center,
      ]
      const sites = mireglassRouteSites(seed)
      const outpost = anchors.salvager.tile.center
      expect(mireglassApproachTrail(seed).at(-1), `${seed} authored approach`).toEqual(outpost)
      const graph = walkingWitness(seed, outpost)

      expect(patches.length, seed).toBeGreaterThanOrEqual(3)
      expect(patches.length, seed).toBeLessThanOrEqual(4)
      expect(new Set(patches.map(({ id }) => id)).size, seed).toBe(patches.length)
      for (const patch of patches) {
        const { tile } = patch
        expect(patch.id, seed).toBe(`mireglass_reach/resource/herb/${tile.gridX - 3}/${tile.gridZ - 3}`)
        expect(patch.kind).toBe('herb')
        expect(patch.itemId).toBe('marsh_herb')
        expect(tile, `${seed} canonical tile`).toEqual(worldTileAtGrid(seed, tile.gridX - 3, tile.gridZ - 3))
        expect(tile.terrain, `${seed} dry ground`).toBe('loam')
        expect(distance(tile.center, anchors.bellAlder.tile.center), `${seed} alder radius`).toBeLessThanOrEqual(32)
        expect(DIRECTIONS.some(([dx, dz]) => {
          const x = tile.center.x + dx
          const z = tile.center.z + dz
          return x >= envelope.minX && x < envelope.maxX && z >= envelope.minZ && z < envelope.maxZ
            && worldTileAtGrid(seed, x / CELL, z / CELL).terrain === 'wetland'
        }), `${seed} alder wetland edge`).toBe(true)
        for (const point of occupied) {
          expect(distance(tile.center, point), `${seed} occupied clearance`).toBeGreaterThanOrEqual(8)
        }
        for (const site of sites) {
          expect(segmentDistance(tile.center,
            { ...site.from, z: site.from.z - CELL },
            { ...site.to, z: site.to.z + CELL }), `${seed} route clearance`).toBeGreaterThanOrEqual(8)
        }
        expect(graph.parent.has(key(tile.center)), `${seed} route to ${patch.id}`).toBe(true)
      }
      for (let index = 0; index < patches.length; index += 1) {
        for (let other = index + 1; other < patches.length; other += 1) {
          expect(distance(patches[index].tile.center, patches[other].tile.center), `${seed} patch spacing`)
            .toBeGreaterThanOrEqual(8)
        }
      }
    }
  }, 30_000)

  it('replays an actual streamed journey to the marsh edge and back', () => {
    const seed = 'mireglass-corpus-13'
    const outpost = mireglassAnchors(seed).salvager.tile.center
    const patch = mireglassHerbPatches(seed)[0]
    const path = walkingWitness(seed, outpost).pathTo(patch.tile.center)
    const world = createStreamedWorld(seed, outpost)
    for (const to of [...path.slice(1), ...path.slice(0, -1).reverse()]) {
      const from = world.state.player.position
      const result = world.advance([{ type: 'move', delta: { x: to.x - from.x, z: to.z - from.z } }])
      expect(result.rejections, `${seed} move to ${key(to)}`).toEqual([])
      expect(result.state.player.position, `${seed} arrival at ${key(to)}`).toMatchObject(to)
    }
    expect(world.state.player.position).toMatchObject(outpost)
  }, 30_000)

  it('returns a fresh array of immutable patches, including after cache eviction', () => {
    const baseline = new Map(seeds.map((seed) => [seed, mireglassHerbPatches(seed)]))
    for (const seed of [...seeds].reverse()) {
      expect(mireglassHerbPatches(seed), seed).toEqual(baseline.get(seed))
    }
    const altered = mireglassHerbPatches(seeds[0])
    expect(Object.isFrozen(altered)).toBe(false)
    expect(Object.isFrozen(altered[0])).toBe(true)
    expect(Object.isFrozen(altered[0].tile)).toBe(true)
    expect(Object.isFrozen(altered[0].tile.center)).toBe(true)
    expect(() => Object.assign(altered[0].tile.center, { y: -99 })).toThrow(TypeError)
    altered.pop()
    const replay = mireglassHerbPatches(seeds[0])
    expect(replay).not.toBe(altered)
    expect(replay).toEqual(baseline.get(seeds[0]))
    expect(mireglassHerbPatches('')).toEqual(mireglassHerbPatches('wizard-realms'))
  }, 30_000)
})
