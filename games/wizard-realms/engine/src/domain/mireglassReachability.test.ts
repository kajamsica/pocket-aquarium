import { describe, it } from 'vitest'
import { createActiveWorldTerrain } from './activeWorldTerrain'
import { mireglassAnchors, mireglassResources } from './mireglassContent'
import { mireglassMoveBarrier } from './mireglassMovementGate'
import { mireglassRouteSites } from './mireglassRouteSites'
import { MIREGLASS_CORE, MIREGLASS_ENVELOPES, MIREGLASS_FEN_BACK } from './mireglassTerrain'
import { WORLD_CELL_METERS, WORLD_CHUNK_CELLS, worldTileAtGrid } from './worldChunks'

const CELL = WORLD_CELL_METERS
const CHUNK_METERS = CELL * WORLD_CHUNK_CELLS
const MIN_X = MIREGLASS_CORE.minX - 16
const MAX_X = MIREGLASS_ENVELOPES.fringeMarker.maxX + 16
const MIN_Z = MIREGLASS_ENVELOPES.fringeMarker.minZ - 16
const MAX_Z = MIREGLASS_FEN_BACK + 16
const WIDTH = (MAX_X - MIN_X) / CELL + 1
const HEIGHT = (MAX_Z - MIN_Z) / CELL + 1
const DIRECTIONS = [[-CELL, 0], [CELL, 0], [0, -CELL], [0, CELL]] as const
type Point = { x: number; z: number }

/** A bounded, canonical-cell walking graph. Route traversal is checked separately at its site endpoints. */
function walkingGraph(seed: string) {
  const component = new Int32Array(WIDTH * HEIGHT).fill(-1)
  const parent = new Int32Array(component.length).fill(-1)
  const queue = new Int32Array(component.length)
  let componentCount = 0
  const inBounds = ({ x, z }: Point) => x >= MIN_X && x <= MAX_X && z >= MIN_Z && z <= MAX_Z
    && x % CELL === 0 && z % CELL === 0
  const index = ({ x, z }: Point) => ((z - MIN_Z) / CELL) * WIDTH + (x - MIN_X) / CELL
  const point = (at: number): Point => ({ x: MIN_X + at % WIDTH * CELL, z: MIN_Z + Math.floor(at / WIDTH) * CELL })
  const tileAt = (at: Point) => {
    const tile = worldTileAtGrid(seed, at.x / CELL, at.z / CELL)
    if (tile.center.x !== at.x || tile.center.z !== at.z) {
      throw new Error(`${seed}: noncanonical 4m tile at (${at.x}, ${at.z})`)
    }
    return tile
  }
  const componentOf = (start: Point): number => {
    if (!inBounds(start)) throw new Error(`${seed}: target cell (${start.x}, ${start.z}) is outside proof window`)
    const root = index(start)
    if (component[root] !== -1) return component[root]
    tileAt(start)
    const id = componentCount++
    component[root] = id
    parent[root] = root
    queue[0] = root
    let head = 0
    let tail = 1
    while (head < tail) {
      const currentIndex = queue[head++]
      const from = point(currentIndex)
      for (const [dx, dz] of DIRECTIONS) {
        const to = { x: from.x + dx, z: from.z + dz }
        if (!inBounds(to)) continue
        const nextIndex = index(to)
        if (component[nextIndex] !== -1) continue
        const forward = mireglassMoveBarrier(seed, from, to)
        const reverse = mireglassMoveBarrier(seed, to, from)
        if (forward !== reverse) {
          throw new Error(`${seed}: asymmetric movement gate (${from.x}, ${from.z}) -> (${to.x}, ${to.z}): ${forward}/${reverse}`)
        }
        if (forward !== null) continue
        tileAt(to)
        component[nextIndex] = id
        parent[nextIndex] = currentIndex
        queue[tail++] = nextIndex
      }
    }
    return id
  }
  const explainGap = (fromId: number, target: Point) => {
    let nearest = -1
    let distance = Infinity
    for (let at = 0; at < component.length; at += 1) {
      if (component[at] !== fromId) continue
      const candidate = point(at)
      const separation = Math.abs(candidate.x - target.x) + Math.abs(candidate.z - target.z)
      if (separation < distance) { nearest = at; distance = separation }
    }
    const at = point(nearest)
    const blocked = DIRECTIONS
      .map(([dx, dz]) => ({ x: at.x + dx, z: at.z + dz }))
      .filter((next) => Math.abs(next.x - target.x) + Math.abs(next.z - target.z) < distance)
      .map((next) => `${inBounds(next) ? mireglassMoveBarrier(seed, at, next) ?? 'unexpected open edge' : 'proof window'} at (${next.x}, ${next.z})`)
    return `nearest reachable cell (${at.x}, ${at.z}), ${distance / CELL} cells away; ${blocked.join(' or ')}`
  }
  const roundTrip = (from: Point, to: Point, label: string) => {
    const fromId = componentOf(from)
    const toId = componentOf(to)
    if (fromId !== toId) {
      throw new Error(`${seed} ${label}: no walking path from (${from.x}, ${from.z}) to (${to.x}, ${to.z}); ${explainGap(fromId, to)}`)
    }
    // Every accepted edge was checked in both directions, so its witness path is reversible.
    if (componentOf(to) !== componentOf(from)) throw new Error(`${seed} ${label}: return path failed`)
  }
  const pathFromRoot = (destination: Point) => {
    const path: Point[] = []
    let at = index(destination)
    for (;;) {
      path.push(point(at))
      if (parent[at] === at) return path.reverse()
      if (parent[at] < 0) throw new Error(`${seed}: missing walking witness for (${destination.x}, ${destination.z})`)
      at = parent[at]
    }
  }
  return { roundTrip, pathFromRoot, tileAt }
}

describe('Mireglass Reach walking connectivity', () => {
  it('connects every legal bridge and ladder choice across 100 seeds, with reversible routes and active chunk seams', () => {
    for (let seedIndex = 0; seedIndex < 100; seedIndex += 1) {
      const seed = `mireglass-corpus-${seedIndex}`
      const graph = walkingGraph(seed)
      const anchors = mireglassAnchors(seed)
      const resources = mireglassResources(seed)
      const sites = mireglassRouteSites(seed)
      const bridges = sites.filter((site) => site.kind === 'bridge')
      const ladders = sites.filter((site) => site.kind === 'ladder')
      const marker = anchors.fringeMarker.tile.center
      const salvager = anchors.salvager.tile.center
      const cache = anchors.sealCache.tile.center

      graph.roundTrip(marker, salvager, 'marker <-> salvager')
      for (const resource of resources.filter(({ phase }) => phase === 'before_bridge')) {
        graph.roundTrip(marker, resource.tile.center, `before-bridge resource ${resource.id}`)
      }
      for (const bridge of bridges) {
        graph.roundTrip(marker, bridge.from, `bridge approach ${bridge.id}`)
        for (const resource of resources.filter(({ phase }) => phase === 'after_bridge')) {
          graph.roundTrip(bridge.to, resource.tile.center, `bridge ${bridge.id} -> resource ${resource.id}`)
        }
        for (const ladder of ladders) {
          graph.roundTrip(bridge.to, ladder.from, `bridge ${bridge.id} -> ladder approach ${ladder.id}`)
          graph.roundTrip(ladder.to, cache, `ladder ${ladder.id} -> cache via bridge ${bridge.id}`)
          graph.roundTrip(cache, ladder.to, `cache return via ladder ${ladder.id}`)
          graph.roundTrip(ladder.from, bridge.to, `ladder ${ladder.id} return via bridge ${bridge.id}`)
          graph.roundTrip(bridge.from, marker, `bridge ${bridge.id} return to marker`)
        }
      }

      // Replay an actual walking witness through the streaming terrain window and back.
      const terrain = createActiveWorldTerrain(seed)
      const witness = graph.pathFromRoot(salvager)
      let seamCrossings = 0
      for (let index = 1; index < witness.length; index += 1) {
        const from = witness[index - 1]
        const to = witness[index]
        if (Math.floor(from.x / CHUNK_METERS) !== Math.floor(to.x / CHUNK_METERS)
          || Math.floor(from.z / CHUNK_METERS) !== Math.floor(to.z / CHUNK_METERS)) seamCrossings += 1
      }
      for (const at of [...witness, ...witness.slice(0, -1).reverse()]) {
        terrain.activate(at)
        const actual = terrain.tileAtWorld(at.x, at.z)
        const expected = graph.tileAt(at)
        if (!actual || actual.id !== expected.id || actual.center.x !== at.x || actual.center.z !== at.z) {
          throw new Error(`${seed}: active chunk missing canonical walking tile (${at.x}, ${at.z})`)
        }
      }
      if (seamCrossings === 0) throw new Error(`${seed}: marker-to-salvager witness never crossed an active chunk seam`)
      for (const site of sites) {
        for (const at of [site.from, site.to]) {
          terrain.activate(at)
          if (terrain.tileAtWorld(at.x, at.z)?.id !== graph.tileAt(at).id) {
            throw new Error(`${seed} ${site.id}: active chunk missing route endpoint (${at.x}, ${at.z})`)
          }
        }
      }
    }
  }, 120_000)
})
