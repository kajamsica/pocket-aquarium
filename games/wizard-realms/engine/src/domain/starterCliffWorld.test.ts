import { describe, expect, it } from 'vitest'
import { createGeneratedWorld, terrainHeightAt } from './generation'
import { STARTER_CLIFF_PROFILE, STARTER_CLIFF_RISE, STARTER_CLIFF_SITE_ID,
  starterCliffFace } from './starterCliffProfile'
import { createStarterCliffGreenwayFacts, starterCliffGroundYAt,
  starterCliffWorldChunk, starterCliffWorldTileAtGrid } from './starterCliffWorld'
import { worldChunk, worldTileAtGrid } from './worldChunks'

const seeds = ['wizard-realms', 'greenway-alpha', 'new-cliff-seed']

describe('dormant new-world starter cliff facts', () => {
  it.each(seeds)('derives one real ladder site and coherent grounded facts for %s', (seed) => {
    const facts = createStarterCliffGreenwayFacts(seed)
    const base = createGeneratedWorld(seed, 'greenway-expanded-v1')
    const site = facts.routeSites[0]
    expect(facts.seed).toBe(seed)
    expect(facts.profile).toBe(STARTER_CLIFF_PROFILE)
    expect(facts.tiles).toHaveLength(256)
    expect(facts.routeSites).toHaveLength(1)
    expect(site).toMatchObject({ id: STARTER_CLIFF_SITE_ID, routeId: 'greenway_ladder',
      from: { x: 0, z: -4 }, to: { x: 0, z: -8 } })
    expect(site.to.y - site.from.y).toBeCloseTo(STARTER_CLIFF_RISE, 10)
    expect(facts.routes[0]).toMatchObject({ id: 'greenway_ladder',
      siteId: null, from: site.from, to: site.to })
    expect(facts.ladderFace).toMatchObject({ siteId: site.id,
      from: { x: 0, y: site.from.y, z: -5.35 },
      to: { x: 0, y: site.to.y, z: -6 }, width: 1.05 })
    expect(starterCliffFace(seed, { ...facts.routes[0], siteId: site.id }, facts.profile, true))
      .toEqual(facts.ladderFace)
    expect(starterCliffFace(seed, { ...facts.routes[0], siteId: site.id }, facts.profile, false))
      .toBeNull()

    const grounded = [facts.playerStart, ...facts.resources.map((item) => item.position),
      ...facts.stores.map((item) => item.position), ...facts.fairyRings.map((item) => item.position),
      ...facts.inscriptions.map((item) => item.position), ...facts.digSites.map((item) => item.position),
      ...facts.routes.flatMap((route) => [route.from, route.to])]
    for (const point of grounded) {
      expect(point.y).toBe(terrainHeightAt(facts.tiles, point.x, point.z))
    }
    expect(facts.resources.map((item) => [item.id, item.position.x, item.position.z]))
      .toEqual(base.resources.map((item) => [item.id, item.position.x, item.position.z]))
  })

  it.each(seeds)('projects the same height in stored Greenway facts and streamed chunks for %s', (seed) => {
    const facts = createStarterCliffGreenwayFacts(seed)
    const streamed = starterCliffWorldChunk(seed, 0, -1)
    for (const [x, z] of [[0, -4], [0, -8], [4, -8], [12, -16]]) {
      const gx = x / 4, gz = z / 4
      const tile = facts.tiles.find((entry) => entry.center.x === x && entry.center.z === z)!
      const chunkTile = streamed.tiles.find((entry) => entry.center.x === x && entry.center.z === z)!
      expect(chunkTile).toEqual(tile)
      expect(starterCliffWorldTileAtGrid(seed, gx, gz)).toEqual(tile)
      expect(starterCliffGroundYAt(seed, x, z)).toBe(tile.center.y)
    }
    expect(starterCliffGroundYAt(seed, 0, -5.99)).toBe(facts.routeSites[0].from.y)
    expect(starterCliffGroundYAt(seed, 0, -6)).toBe(facts.routeSites[0].to.y)
  })

  it('leaves unrelated cells, original constructors and the old profile unmodified', () => {
    const seed = 'greenway-alpha'
    const original = createGeneratedWorld(seed, 'greenway-expanded-v1')
    const before = JSON.stringify(original)
    const facts = createStarterCliffGreenwayFacts(seed)
    expect(JSON.stringify(original)).toBe(before)
    expect(createGeneratedWorld(seed, 'greenway-expanded-v1')).toEqual(original)
    for (const [gx, gz] of [[10, -2], [0, 0], [0, -8], [-40, 30]]) {
      expect(starterCliffWorldTileAtGrid(seed, gx, gz)).toEqual(worldTileAtGrid(seed, gx, gz))
    }
    expect(starterCliffWorldChunk(seed, 0, 0)).toEqual(worldChunk(seed, 0, 0))
    expect(facts.tiles.find((tile) => tile.center.x === 0 && tile.center.z === 0))
      .toEqual(original.tiles.find((tile) => tile.center.x === 0 && tile.center.z === 0))
    expect(facts.routes[0].to.y).not.toBe(original.routes[0].to.y)
  })

  it('repeats exactly and rejects invalid floor queries instead of inventing support', () => {
    for (const seed of seeds) expect(createStarterCliffGreenwayFacts(seed))
      .toEqual(createStarterCliffGreenwayFacts(seed))
    expect(starterCliffGroundYAt('greenway-alpha', NaN, 0)).toBeNull()
    expect(starterCliffGroundYAt('greenway-alpha', 0, Infinity)).toBeNull()
    expect(starterCliffGroundYAt('greenway-alpha', 4096, 0)).toBeNull()
    expect(() => starterCliffWorldTileAtGrid('greenway-alpha', 4096, 0)).toThrow(RangeError)
    expect(() => createStarterCliffGreenwayFacts(null as never)).toThrow(TypeError)
  })
})
