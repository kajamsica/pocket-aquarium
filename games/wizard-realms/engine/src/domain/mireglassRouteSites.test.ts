import { describe, expect, it } from 'vitest'
import { mireglassAnchors, mireglassResources } from './mireglassContent'
import { MIREGLASS_CONTENT_REVISION, MIREGLASS_ENVELOPES, mireglassBermFaceRowAt, mireglassFenRowAt } from './mireglassTerrain'
import { mireglassRouteSites } from './mireglassRouteSites'
import { worldChunk, worldTileAtGrid } from './worldChunks'

const seeds = Array.from({ length: 100 }, (_, index) => `mireglass-corpus-${index}`)
const tileAt = (seed: string, x: number, z: number) => worldTileAtGrid(seed, x / 4, z / 4)

describe('Mireglass Reach canonical route sites', () => {
  it('offers at least two clear, dry-supported choices per route across the fixed 100-seed corpus', () => {
    for (const seed of seeds) {
      const sites = mireglassRouteSites(seed)
      const occupied = [
        ...Object.values(mireglassAnchors(seed)).map(({ tile }) => tile.center),
        ...mireglassResources(seed).map(({ tile }) => tile.center),
      ]
      expect(sites.filter(({ kind }) => kind === 'bridge').length, seed).toBeGreaterThanOrEqual(2)
      expect(sites.filter(({ kind }) => kind === 'ladder').length, seed).toBeGreaterThanOrEqual(2)
      expect(new Set(sites.map(({ id }) => id)).size, seed).toBe(sites.length)
      expect(Object.isFrozen(sites), seed).toBe(true)

      for (const site of sites) {
        const x = site.from.x
        const row = site.kind === 'bridge' ? mireglassFenRowAt(seed, x) : mireglassBermFaceRowAt(seed, x)
        const envelope = site.kind === 'bridge' ? MIREGLASS_ENVELOPES.fenChannel : MIREGLASS_ENVELOPES.slateBerm
        const approach = tileAt(seed, x, site.from.z - 4)
        const from = tileAt(seed, site.from.x, site.from.z)
        const to = tileAt(seed, site.to.x, site.to.z)
        const exit = tileAt(seed, x, site.to.z + 4)

        expect(site.revision).toBe(MIREGLASS_CONTENT_REVISION)
        expect(x).toBeGreaterThanOrEqual(envelope.minX)
        expect(x).toBeLessThan(envelope.maxX)
        expect(site.id).toBe(`${site.routeId}/${x / 4}/${row / 4}`)
        expect(site.from).toEqual(from.center)
        expect(site.to).toEqual(to.center)
        expect(Object.isFrozen(site)).toBe(true)
        expect(Object.isFrozen(site.from)).toBe(true)
        expect(Object.isFrozen(site.to)).toBe(true)
        expect(approach.terrain).toBe('loam')
        expect(Math.abs(approach.center.y - from.center.y)).toBeLessThanOrEqual(0.9)
        expect(Math.abs(to.center.y - exit.center.y)).toBeLessThanOrEqual(0.9)
        for (const point of occupied) {
          const nearestZ = Math.max(approach.center.z, Math.min(exit.center.z, point.z))
          expect(Math.hypot(point.x - x, point.z - nearestZ), `${seed} ${site.id} content clearance`).toBeGreaterThanOrEqual(4)
        }

        if (site.kind === 'bridge') {
          expect(site.routeId).toBe('mireglass_reach/route/fen_bridge')
          expect(site.logCost).toBe(8)
          expect(site.spanMeters).toBe(8)
          expect(site.from.z).toBe(row - 4)
          expect(site.to.z).toBe(row + 4)
          expect([from.terrain, tileAt(seed, x, row).terrain, to.terrain, exit.terrain])
            .toEqual(['loam', 'wetland', 'loam', 'loam'])
          expect(Math.abs(from.center.y - tileAt(seed, x, row).center.y)).toBeLessThanOrEqual(0.9)
          expect(Math.abs(to.center.y - tileAt(seed, x, row).center.y)).toBeLessThanOrEqual(0.9)
        } else {
          expect(site.routeId).toBe('mireglass_reach/route/slate_ladder')
          expect(site.logCost).toBe(4)
          expect(site.spanMeters).toBe(4)
          expect(site.from.z).toBe(row - 4)
          expect(site.to.z).toBe(row)
          expect([from.terrain, to.terrain, exit.terrain]).toEqual(['loam', 'rocky', 'rocky'])
          expect(site.riseMeters).toBe(1.56)
          expect(site.to.y - site.from.y).toBeCloseTo(1.56, 8)
        }
      }
    }
  }, 30_000)

  it('regenerates identically after shuffled seed and chunk evaluation', () => {
    const baseline = new Map(seeds.map((seed) => [seed, mireglassRouteSites(seed)]))
    const order = [...seeds]
    let state = 7291
    for (let index = order.length - 1; index > 0; index -= 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const swap = state % (index + 1)
      ;[order[index], order[swap]] = [order[swap], order[index]]
    }
    expect(order).not.toEqual(seeds)
    for (const seed of order) {
      const chunks = [[-7, 5], [-6, 5], [-7, 6], [-6, 6]] as const
      for (const [chunkX, chunkZ] of seed.length % 2 ? chunks : [...chunks].reverse()) {
        worldChunk(seed, chunkX, chunkZ)
      }
      expect(mireglassRouteSites(seed)).toEqual(baseline.get(seed))
    }
    expect(mireglassRouteSites('')).toEqual(mireglassRouteSites('wizard-realms'))
  }, 30_000)
})
