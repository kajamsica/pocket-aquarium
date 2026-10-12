import { describe, expect, it, vi } from 'vitest'
import * as activeTerrain from './activeWorldTerrain'
import { encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { mireglassRouteSites } from './mireglassRouteSites'
import { MIREGLASS_CORE } from './mireglassTerrain'
import { createPublicV14StreamTerrain, createPublicV23StreamTerrain,
  resolvePublicV14Surface, resolvePublicV23Surface } from './publicWorldV14Terrain'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { createFreshPublicV14State } from './publicWorldV14Validation'
import { starterCliffSupportAt } from './starterCliffMovement'
import { STARTER_CLIFF_SITE_ID } from './starterCliffProfile'
import { starterCliffGroundYAt, starterCliffWorldTileAtGrid } from './starterCliffWorld'
import { appendTerrainWorkLedger } from './terrainWorkLedger'
import { terrainWorkSupportAt } from './terrainWorkSupport'
import { resolveTerrainWorkSite } from './terrainWorks'
import { resolvePublicV23Site } from './publicWorldV23Sites'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
const base = () => createFreshPublicV14State(seed)
const workContext = { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] }
const standing = (state: PublicV14State, point: { x: number; z: number }): PublicV14State => {
  const surface = resolvePublicV14Surface(state, point)!
  const mask = new Uint8Array(state.discoveryMask)
  const bit = encodeDiscoveredTileIds([surface.tileId])
  for (let index = 0; index < mask.length; index++) mask[index] |= bit[index]
  return { ...state, discoveryMask: mask,
    player: { ...state.player, position: { ...point, y: surface.floorY } } }
}

describe('dormant v14 active terrain and surface proof', () => {
  it('uses one tile-owning chunk for surface probes without narrowing streamed movement', () => {
    const create = vi.spyOn(activeTerrain, 'createActiveWorldTerrain')
    try {
      for (const sampleSeed of [seed, 'wizard-realms']) {
        const state = createFreshPublicV14State(sampleSeed)
        for (const point of [{ x: 63.99, z: -64.001 }, { x: -64.001, z: 63.99 },
          { x: -1026 + 1e-7, z: 1022 }]) {
          const surface = resolvePublicV14Surface(state, point)
          const terrain = create.mock.results.at(-1)?.value
          expect(terrain?.activeChunkCount).toBe(1)
          expect(surface?.tileId).toBe(starterCliffWorldTileAtGrid(sampleSeed,
            Math.ceil(point.x / 4 - 0.5), Math.ceil(point.z / 4 - 0.5)).id)
          expect(resolvePublicV23Surface(state, point, [])).toEqual(surface)
          expect(create.mock.results.at(-1)?.value.activeChunkCount).toBe(1)
        }
      }
      const dig = resolveTerrainWorkSite(seed, 'tile--64-76')
      if (!dig || dig.kind !== 'dig') throw new Error('Missing canonical dig site')
      const ledger = appendTerrainWorkLedger(base().terrainWorks, dig.id, workContext)!
      const initial = base()
      const worked = { ...initial, terrainWorks: ledger,
        mireglass: { ...initial.mireglass, cacheExcavated: true } }
      for (const point of [mireglassAnchors(seed).sealCache.tile.center, dig.center]) {
        const surface = resolvePublicV14Surface(worked, point)
        expect(surface).not.toBeNull()
        expect(create.mock.results.at(-1)?.value.activeChunkCount).toBe(1)
        expect(resolvePublicV23Surface(worked, point, [])).toEqual(surface)
        expect(create.mock.results.at(-1)?.value.activeChunkCount).toBe(1)
      }
      const regional = resolvePublicV23Site(seed,
        'works5:ladder:mireglass-slate:W:-103:4306')!
      const point = { x: (regional.from.x + regional.to.x) / 2,
        z: (regional.from.z + regional.to.z) / 2 }
      expect(resolvePublicV23Surface(initial, point, [regional.id])?.support).toBe('work')
      expect(create.mock.results.at(-1)?.value.activeChunkCount).toBe(1)
      expect(createPublicV14StreamTerrain(initial).activeChunkCount()).toBe(9)
      expect(createPublicV23StreamTerrain(initial, []).activeChunkCount()).toBe(9)
    } finally { create.mockRestore() }
  })

  it('matches A in a bounded active window, including cliff, half-cell seams and edges', () => {
    const state = base()
    const runtime = createPublicV14StreamTerrain(state)
    expect(runtime.activeChunkCount()).toBe(9)
    expect(runtime.activeTiles()).toHaveLength(2_304)
    for (const [x, z] of [[0, -5.999], [0, -6], [4, -8], [-28, -8],
      [-30, -8], [-30 + 1e-7, -8], [34, 0]]) {
      const gx = Math.ceil(x / 4 - 0.5), gz = Math.ceil(z / 4 - 0.5)
      const canonical = starterCliffWorldTileAtGrid(seed, gx, gz)
      const tile = runtime.tileAtWorld(x, z)!
      const active = runtime.activeTiles().find((candidate) => candidate.id === canonical.id)!
      const surface = resolvePublicV14Surface(state, { x, z })!
      expect(tile).toEqual(canonical)
      expect(active).toEqual(canonical)
      expect(surface).toEqual({ tileId: canonical.id, terrainY: canonical.center.y,
        floorY: starterCliffGroundYAt(seed, x, z), support: 'terrain' })
    }
    expect(runtime.tileAtWorld(0, -6)!.center.y
      - runtime.tileAtWorld(0, -5.999)!.center.y).toBeCloseTo(1.56, 10)
    expect(runtime.tileAtWorld(-28, -8)!.center.y)
      .not.toBe(worldTileAtGrid(seed, -7, -2).center.y)
    expect(resolvePublicV14Surface(state, { x: -1026, z: 0 })).toBeNull()
    expect(resolvePublicV14Surface(state, { x: -1026 + 1e-7, z: 0 })).not.toBeNull()
    expect(resolvePublicV14Surface(state, { x: 1022, z: 0 })).not.toBeNull()
    expect(resolvePublicV14Surface(state, { x: 1022 + 1e-7, z: 0 })).toBeNull()
  })

  it('applies disjoint cache and work overlays after canonical cliff tiles', () => {
    const cache = mireglassAnchors(seed).sealCache.tile
    const dugId = 'tile--64-76'
    const dug = resolveTerrainWorkSite(seed, dugId)!
    const bridge = resolveTerrainWorkSite(seed, 'works1:bridge:-102:92:z')
    const ladder = resolveTerrainWorkSite(seed, 'works1:ladder:-103:108:W')
    expect(dug.kind).toBe('dig')
    if (!bridge || bridge.kind !== 'bridge' || !ladder || ladder.kind !== 'ladder') {
      throw new Error('Expected canonical Mireglass terrain work sites.')
    }
    expect(MIREGLASS_CORE.maxX).toBeLessThan(-32)
    expect(MIREGLASS_CORE.minZ).toBeGreaterThan(32)
    for (const tile of [cache, worldTileAtGrid(seed, -67, 73),
      worldTileAtGrid(seed, bridge.from.x / 4, bridge.from.z / 4),
      worldTileAtGrid(seed, ladder.from.x / 4, ladder.from.z / 4)]) {
      expect(tile.center.x).toBeLessThan(-32)
      expect(tile.center.z).toBeGreaterThan(32)
      expect(starterCliffWorldTileAtGrid(seed, tile.center.x / 4,
        tile.center.z / 4)).toEqual(tile)
    }
    const afterDig = appendTerrainWorkLedger(base().terrainWorks, dugId, workContext)!
    const afterBridge = appendTerrainWorkLedger(afterDig, bridge.id, workContext)!
    const ledger = appendTerrainWorkLedger(afterBridge, ladder.id, workContext)!
    expect(ledger).not.toBeNull()
    const initial = base()
    const state: PublicV14State = { ...initial, terrainWorks: ledger,
      mireglass: { ...initial.mireglass, cacheExcavated: true } }
    const cacheSurface = resolvePublicV14Surface(state, cache.center)!
    expect(cacheSurface).toMatchObject({ tileId: cache.id, terrainY: 1.65,
      floorY: 1.65, support: 'terrain' })
    const cacheRuntime = createPublicV14StreamTerrain(standing(state, cache.center))
    expect(cacheRuntime.tileAtWorld(cache.center.x, cache.center.z)?.center.y).toBe(1.65)
    expect(cacheRuntime.activeTiles().find((tile) => tile.id === cache.id)?.center.y).toBe(1.65)
    if (dug.kind !== 'dig') return
    const dugSurface = resolvePublicV14Surface(state, dug.center)!
    expect(dugSurface.terrainY).toBeCloseTo(dug.center.y - 0.24, 10)
    expect(dugSurface.floorY).toBeCloseTo(dugSurface.terrainY, 10)
    const dugRuntime = createPublicV14StreamTerrain(standing(state, dug.center))
    expect(dugRuntime.tileAtWorld(dug.center.x, dug.center.z)?.center.y)
      .toBeCloseTo(dugSurface.terrainY, 10)
    expect(dugRuntime.activeTiles().find((tile) => tile.id === dug.id)?.center.y)
      .toBeCloseTo(dugSurface.terrainY, 10)
    const center = (site: typeof bridge | typeof ladder) => ({
      x: (site.from.x + site.to.x) / 2, z: (site.from.z + site.to.z) / 2 })
    for (const site of [bridge, ladder]) {
      const point = center(site)
      const surface = resolvePublicV14Surface(state, point)!
      expect(surface.support).toBe('work')
      expect(surface.floorY).toBeCloseTo(terrainWorkSupportAt(site, point).floorY!, 10)
      const runtime = createPublicV14StreamTerrain(standing(state, point))
      expect(runtime.advance([]).state.player.position.y).toBeCloseTo(surface.floorY, 10)
    }
  })

  it('uses authored Mireglass support but never projects the legacy Greenway ramp', () => {
    const initial = base()
    const route = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const state: PublicV14State = { ...initial, mireglass: { ...initial.mireglass,
      builtRoutes: { ...initial.mireglass.builtRoutes, bridge: route.id } },
    greenway: { ...initial.greenway, builtRouteIds: ['greenway_ladder'],
      routes: initial.greenway.routes.map((entry) => entry.id === 'greenway_ladder'
        ? { ...entry, siteId: STARTER_CLIFF_SITE_ID } : entry) } }
    const midpoint = { x: (route.from.x + route.to.x) / 2,
      z: (route.from.z + route.to.z) / 2 }
    const regional = resolvePublicV14Surface(state, midpoint)!
    expect(regional.support).toBe('authored_route')
    expect(regional.floorY).toBeCloseTo((route.from.y + route.to.y) / 2 + 0.16, 10)
    const regionalRuntime = createPublicV14StreamTerrain(standing(state, midpoint))
    expect(regionalRuntime.advance([]).state.player.position.y).toBeCloseTo(regional.floorY, 10)
    const point = { x: 0, z: -5.7 }
    const starter = resolvePublicV14Surface(state, point)!
    const realLadder = starterCliffSupportAt({ seed, profile: state.generationProfile,
      route: state.greenway.routes[0], built: true }, point)!
    expect(realLadder.kind).toBe('ladder')
    expect(starter.support).toBe('terrain')
    expect(starter.floorY).toBe(starterCliffGroundYAt(seed, point.x, point.z))
    expect(starter.floorY).toBeLessThan(realLadder.floorY)

    const corner = { x: -1024, z: -1024 }
    const cornerTile = starterCliffWorldTileAtGrid(seed, -256, -256)
    const known = encodeDiscoveredTileIds([cornerTile.id, 'tile-3-3'].sort())
    const remote: PublicV14State = { ...initial, discoveryMask: known,
      player: { ...initial.player, position: { ...corner, y: cornerTile.center.y } } }
    const runtime = createPublicV14StreamTerrain(remote)
    expect(runtime.activeChunkCount()).toBe(4)
    expect(runtime.activeTiles()).toHaveLength(1_024)
    expect(runtime.tileAtWorld(corner.x, corner.z)).toEqual(cornerTile)
  })
})
