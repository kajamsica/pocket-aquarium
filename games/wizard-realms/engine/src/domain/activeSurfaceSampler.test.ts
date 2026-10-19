import { describe, expect, it } from 'vitest'
import { createActiveSurfaceSampler } from './activeSurfaceSampler'
import { encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { mireglassRouteSites } from './mireglassRouteSites'
import { createPublicV23SurfaceSampler, resolvePublicV23Surface } from './publicWorldV14Terrain'
import { createFreshPublicV14State } from './publicWorldV14Validation'
import { publicV17StarterSupportAt } from './publicWorldV17StarterMovement'
import { createPublicV23Root, decodePublicV23Progress } from './publicWorldV23Snapshot'
import { resolvePublicV23Site } from './publicWorldV23Sites'
import { emptyPublicV26TerrainLedger } from './publicWorldV26TerrainLedger'
import type { PublicV31Progress } from './publicWorldV31Migration'
import { projectPublicV31Pose } from './publicWorldV31Support'
import { appendTerrainWorkLedger } from './terrainWorkLedger'
import { resolveTerrainWorkSite } from './terrainWorks'

const seed = 'greenway-alpha'
const point = (x: number, z: number) => ({ x, z })
const midpoint = (site: { from: { x: number; z: number }; to: { x: number; z: number } }) =>
  point((site.from.x + site.to.x) / 2, (site.from.z + site.to.z) / 2)

function v31At(x: number, z: number): PublicV31Progress {
  const { head } = createPublicV23Root(seed)
  const ground = publicV17StarterSupportAt({ seed,
    profile: head.state.generationProfile,
    route: head.state.greenway.routes.find((route) => route.id === 'greenway_ladder') ?? null,
    built: false, greenwayWorks: head.greenwayWorks }, point(x, z))
  if (!ground) throw new Error('Missing Greenway support')
  const old = decodePublicV23Progress({ state: { ...head.state,
    player: { ...head.state.player,
      position: { x, y: ground.floorY, z } } },
  greenwayWorks: head.greenwayWorks, regionalWorks: head.regionalWorks }, seed)
  if (!old) throw new Error('Missing V23 progress')
  return { ...old, terrain: emptyPublicV26TerrainLedger(), nextHomeAtMs: 0,
    riverBridgeIds: [], miningTools: { basicPickOwned: false,
      enchantedPickOwned: false, activePick: null }, claimedBridgeheadId: null,
    raisedSoilCells: [] }
}

describe('disposable active surface sampler', () => {
  it('matches V23 for distinct river, cliff, seam, boundary, discovery, and built-support probes', () => {
    const base = createFreshPublicV14State(seed)
    const route = mireglassRouteSites(seed).find((site) => site.kind === 'bridge')!
    const dug = resolveTerrainWorkSite(seed, 'tile--64-76')!
    const bridge = resolveTerrainWorkSite(seed, 'works1:bridge:-102:92:z')!
    const ladder = resolveTerrainWorkSite(seed, 'works1:ladder:-103:108:W')!
    if (dug.kind !== 'dig' || bridge.kind === 'dig' || ladder.kind === 'dig') {
      throw new Error('Invalid terrain-work fixture kinds')
    }
    const regional = resolvePublicV23Site(seed,
      'works5:ladder:mireglass-slate:W:-103:4306')!
    const context = { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] }
    const ledger = [dug.id, bridge.id, ladder.id].reduce((value, id) => {
      const next = appendTerrainWorkLedger(value, id, context)
      if (!next) throw new Error(`Invalid fixture work ${id}`)
      return next
    }, base.terrainWorks)
    const built = { ...base, terrainWorks: ledger,
      mireglass: { ...base.mireglass, cacheExcavated: true,
        builtRoutes: { ...base.mireglass.builtRoutes, bridge: route.id } } }
    const revealed = { ...built, discoveryMask: encodeDiscoveredTileIds([
      'tile-3-3', 'tile--61-79'].sort()) }
    const probes = [point(0, 0), point(12, 5.9), point(0, -5.999), point(0, -6),
      point(63.99, -64.001), point(-64.001, 63.99),
      point(-1026, 0), point(-1026 + 1e-7, 0), point(1022, 0),
      point(1022 + 1e-7, 0), point(Number.NaN, 0),
      mireglassAnchors(seed).sealCache.tile.center, dug.center,
      midpoint(bridge), midpoint(ladder), midpoint(route), midpoint(regional)]
    for (const state of [base, built, revealed]) {
      for (const ids of [[], [regional.id]]) {
        const sampled = createActiveSurfaceSampler({ state,
          regionalWorks: { builtLadderIds: ids } })
        for (const position of probes) {
          expect(sampled(position), `${state === base ? 'base' : 'worked'} ${JSON.stringify(position)}`)
            .toEqual(resolvePublicV23Surface(state, position, ids))
        }
      }
    }
    expect(createActiveSurfaceSampler({ state: built,
      regionalWorks: { builtLadderIds: [regional.id] } })(midpoint(regional))?.support)
      .toBe('work')
    expect(createActiveSurfaceSampler({ state: built,
      regionalWorks: { builtLadderIds: [] } })(midpoint(route))?.support)
      .toBe('authored_route')
  })

  it('owns batch inputs, while raised soil remains a V31 pose overlay', () => {
    const state = createFreshPublicV14State(seed)
    const original = structuredClone(state)
    const ids: string[] = []
    const sampled = createPublicV23SurfaceSampler(state, ids)
    const at = point(4, 0)
    const expected = resolvePublicV23Surface(original, at, [])
    ids.push('forged')
    const mutableState = state as { seed: string }
    mutableState.seed = 'changed-after-creation'
    expect(sampled(at)).toEqual(expected)
    expect(createPublicV23SurfaceSampler(state, ids)(at)).toBeNull()

    const v31 = v31At(4, 0)
    const lift = { ...v31, raisedSoilCells: [{ gx: 1, gz: 0 }] }
    const carrierSurface = createActiveSurfaceSampler(v31)(at)
    expect(carrierSurface).toEqual(resolvePublicV23Surface(v31.state, at, []))
    expect(projectPublicV31Pose(lift)?.effective.floorY).toBeCloseTo(
      projectPublicV31Pose(v31)!.effective.floorY + 0.4)
    // This sampler never guesses the V31 effective height from its V23 carrier floor.
    expect(createActiveSurfaceSampler(lift)(at)).toEqual(carrierSurface)
    const pit = { ...v31, terrain: { ...v31.terrain,
      columns: [{ gx: 1, gz: 0, openDepth: 1, rewardDepth: 1, pitLadder: false }] } }
    expect(projectPublicV31Pose(pit)?.effective.floorY).toBeCloseTo(
      projectPublicV31Pose(v31)!.effective.floorY - 0.4)
    expect(createActiveSurfaceSampler(pit)(at)).toEqual(carrierSurface)
  })

  it('records a fixed distinct-probe timing fixture without claiming integration speedup', () => {
    const state = createFreshPublicV14State(seed)
    const probes = Array.from({ length: 96 }, (_, index) =>
      point(-9.5 + index * 0.2, 2 + (index % 7) * 0.13))
    const time = (createRead: () => (position: { x: number; z: number }) => unknown) => {
      const start = performance.now()
      const values = probes.map(createRead())
      return { elapsedMs: performance.now() - start, values }
    }
    const canonicalRead = () => (position: { x: number; z: number }) =>
      resolvePublicV23Surface(state, position, [])
    const batchRead = () => createPublicV23SurfaceSampler(state, [])
    time(canonicalRead)
    time(batchRead)
    const canonical = Array.from({ length: 5 }, () => time(canonicalRead))
    const cached = Array.from({ length: 5 }, () => time(batchRead))
    for (let index = 0; index < 5; index++) {
      expect(cached[index].values).toEqual(canonical[index].values)
    }
    const median = (runs: typeof canonical) => runs.map((run) => run.elapsedMs)
      .sort((a, b) => a - b)[2]
    console.info(`surface distinct-probe fixture (${probes.length}, including batch creation): canonical ${median(canonical).toFixed(2)} ms; batch sampler ${median(cached).toFixed(2)} ms`)
  })
})
