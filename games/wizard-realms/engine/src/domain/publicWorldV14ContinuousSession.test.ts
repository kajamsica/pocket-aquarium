import { describe, expect, it } from 'vitest'
import { encodeDiscoveredTileIds } from './discoveryMask'
import { mireglassAnchors } from './mireglassContent'
import { advancePublicV14BoundaryFrame } from './publicWorldV14Boundary'
import { createPublicV14ContinuousSession } from './publicWorldV14ContinuousSession'
import type { PublicV14Start } from './publicWorldV14Flow'
import { createFreshPublicV14Head, encodePublicV14Head } from './publicWorldV14Snapshot'
import type { PublicV14State } from './publicWorldV14Snapshot'
import { resolvePublicV14Surface } from './publicWorldV14Terrain'
import { starterCliffSupportAt } from './starterCliffMovement'
import { STARTER_CLIFF_SITE_ID } from './starterCliffProfile'
import { starterCliffWorldTileAtGrid } from './starterCliffWorld'
import { resolveTerrainWorkSite } from './terrainWorks'
import { stepRng } from './world'

const seed = 'greenway-alpha'
const fresh = () => createFreshPublicV14Head(seed)
const move = (x: number, z: number) => [{ type: 'move' as const, delta: { x, z } }]
const walk = { walkRequested: true }
const start = (state: PublicV14State): PublicV14Start => {
  const { lineage } = fresh()
  const checked = encodePublicV14Head(state, 1, lineage)
  return { state: checked.state, lineage, saveRevision: 1, bootstrap: null }
}
const known = (state: PublicV14State, id: string) => {
  const mask = new Uint8Array(state.discoveryMask)
  const bit = encodeDiscoveredTileIds([id])
  for (let index = 0; index < mask.length; index++) mask[index] |= bit[index]
  return mask
}
function greenwayAt(x: number, z: number): PublicV14State {
  const base = fresh().head.state
  const support = starterCliffSupportAt({ seed, profile: base.generationProfile,
    route: base.greenway.routes[0], built: false }, { x, z })!
  return { ...base, tick: 1,
    player: { ...base.player, position: { x, z, y: support.floorY } },
    discoveryMask: known(base, starterCliffWorldTileAtGrid(seed,
      Math.ceil(x / 4 - 0.5), Math.ceil(z / 4 - 0.5)).id) }
}
function streamedAt(base: PublicV14State, x: number, z: number): PublicV14State {
  const surface = resolvePublicV14Surface(base, { x, z })!
  return { ...base, tick: 1, movementOwner: 'streamed',
    player: { ...base.player, position: { x, z, y: surface.floorY } },
    discoveryMask: known(base, surface.tileId) }
}
function dryWestEdge(): PublicV14State {
  for (let z = -28; z <= 32; z += 4) {
    const state = greenwayAt(-30, z)
    if (advancePublicV14BoundaryFrame(state, move(-0.16, 0), walk).candidate) return state
  }
  throw new Error('No dry west edge found.')
}

describe('dormant v14 continuous movement session', () => {
  it('hands one 50 ms tick to each owner out and back, but requires checked boundary commit', () => {
    const initial = dryWestEdge()
    const session = createPublicV14ContinuousSession(start(initial))
    const before = session.view()
    const out = session.advanceFrame([{ type: 'look', yawDelta: 0.1, pitchDelta: 0 },
      ...move(-0.16, 0)], walk)
    expect(out.rejections).toEqual([])
    expect(out.events.slice(0, 2).map((event) => event.type)).toEqual(['player_looked', 'player_moved'])
    expect(session.view()).toMatchObject({ movementOwner: 'streamed', tick: initial.tick + 1,
      pendingBoundary: true })
    expect(session.view().activeTiles.length).toBeLessThanOrEqual(2_304)
    expect(session.previewSnapshot().rng.simulation).toBe(stepRng(initial.rng.simulation))
    expect(session.previewSnapshot().eventSequence).toBe(initial.eventSequence + out.events.length)
    const back = session.advanceFrame(move(0.16, 0), walk)
    expect(back.rejections).toEqual([])
    expect(session.view()).toMatchObject({ movementOwner: 'greenway', tick: initial.tick + 2,
      pendingBoundary: true })
    expect(session.view().activeTiles).toHaveLength(256)
    expect(session.view().player.position).toEqual(before.player.position)
    expect(session.previewSnapshot().eventSequence).toBe(initial.eventSequence
      + out.events.length + back.events.length)
    expect(session.snapshotForSave()).toMatchObject({ status: 'needs-checked-commit',
      boundaryTransitions: 2 })
  })

  it('walks the built 1.56 m Greenway face and defers airborne snapshots until landing', () => {
    const initial = greenwayAt(0, -5.2)
    const built: PublicV14State = { ...initial,
      greenway: { ...initial.greenway, builtRouteIds: ['greenway_ladder'],
        routes: initial.greenway.routes.map((route) => route.id === 'greenway_ladder'
          ? { ...route, siteId: STARTER_CLIFF_SITE_ID } : route) },
      player: { ...initial.player, xp: 60,
        skillXp: { ...initial.player.skillXp, construction: 60 } } }
    const session = createPublicV14ContinuousSession(start(built))
    const lower = session.view().player.position.y
    for (let index = 0; index < 7; index++) {
      expect(session.advanceFrame(move(0, -0.16), walk).rejections).toEqual([])
    }
    expect(session.view().player.position.z).toBeCloseTo(-6.32, 10)
    expect(session.view().player.position.y - lower).toBeCloseTo(1.56, 5)
    for (let index = 0; index < 7; index++) {
      expect(session.advanceFrame(move(0, 0.16), walk).rejections).toEqual([])
    }
    expect(session.view().player.position.y).toBeCloseTo(lower, 5)
    const jumped = session.advanceFrame([{ type: 'jump' }], walk)
    expect(jumped.events.map((event) => event.type)).toContain('player_jumped')
    expect(session.snapshotForSave()).toEqual({ status: 'deferred-airborne', pendingBoundary: false })
    for (let index = 0; index < 30 && session.view().player.verticalVelocity !== 0; index++) {
      expect(session.advanceFrame([], walk).rejections).toEqual([])
    }
    expect(session.view().player.verticalVelocity).toBe(0)
    expect(session.snapshotForSave().status).toBe('ready')
  })

  it('defers an airborne streamed crossing, then marks its landed state for checked commit', () => {
    const session = createPublicV14ContinuousSession(start(dryWestEdge()))
    expect(session.advanceFrame(move(-0.16, 0), walk).rejections).toEqual([])
    expect(session.advanceFrame([{ type: 'jump' }], walk).rejections).toEqual([])
    expect(session.snapshotForSave()).toEqual({ status: 'deferred-airborne', pendingBoundary: true })
    const blocked = session.previewSnapshot()
    expect(session.advanceFrame(move(0.16, 0), walk).rejections[0]?.code).toBe('airborne')
    expect(session.previewSnapshot()).toEqual(blocked)
    for (let index = 0; index < 30 && session.view().player.verticalVelocity !== 0; index++) {
      expect(session.advanceFrame([], walk).rejections).toEqual([])
    }
    expect(session.snapshotForSave()).toMatchObject({ status: 'needs-checked-commit',
      boundaryTransitions: 1 })
  })

  it('uses cache and built-work streamed floors in the bounded active window', () => {
    const base = fresh().head.state
    const cache = mireglassAnchors(seed).sealCache.tile.center
    const cacheState = streamedAt({ ...base,
      mireglass: { ...base.mireglass, fringeMarkerStudied: true,
        cacheRevealed: true, cacheExcavated: true },
      player: { ...base.player, xp: 50,
        inventory: [...base.player.inventory,
          { itemId: 'mireglass_reach/item/seal', quantity: 1 }],
        learnedSpellIds: ['wayfinder_glow'],
        skillXp: { ...base.player.skillXp, wayfinding: 10,
          spellcraft: 10, excavation: 40 } } }, cache.x, cache.z)
    const cacheSession = createPublicV14ContinuousSession(start(cacheState))
    expect(cacheSession.view().player.position.y).toBe(1.65)
    expect(cacheSession.advanceFrame([], walk).rejections).toEqual([])
    expect(cacheSession.snapshotForSave().status).toBe('ready')
    expect(cacheSession.view().activeTiles.length).toBeLessThanOrEqual(2_304)

    const bridge = resolveTerrainWorkSite(seed, 'works1:bridge:-102:92:z')!
    const dig = resolveTerrainWorkSite(seed, 'tile--64-76')!
    if (bridge.kind !== 'bridge' || dig.kind !== 'dig') throw new Error('Missing work fixtures.')
    const point = { x: (bridge.from.x + bridge.to.x) / 2,
      z: (bridge.from.z + bridge.to.z) / 2 }
    const works: PublicV14State = { ...base,
      terrainWorks: { builtWorkIds: [bridge.id], dugTileIds: [dig.id] },
      player: { ...base.player, xp: 110, level: 2,
        skillXp: { ...base.player.skillXp, construction: 80, excavation: 30 } } }
    const workSession = createPublicV14ContinuousSession(start(streamedAt(works, point.x, point.z)))
    expect(resolvePublicV14Surface(workSession.previewSnapshot(), point)?.support).toBe('work')
    expect(workSession.advanceFrame([], walk).rejections).toEqual([])
    expect(workSession.snapshotForSave().status).toBe('ready')
  })

  it('rejects unsupported actions and the 2 km edge without advancing clock or active authority', () => {
    const initial = streamedAt(fresh().head.state, 1_022, 0)
    const session = createPublicV14ContinuousSession(start(initial))
    const before = session.previewSnapshot()
    const edge = session.advanceFrame(move(0.16, 0), walk)
    expect(edge.rejections[0]?.code).toBe('out_of_bounds')
    expect(edge.events).toEqual([])
    expect(session.previewSnapshot()).toEqual(before)
    const unsupported = session.advanceFrame([{ type: 'harvest', resourceId: 'none' }], walk)
    expect(unsupported.rejections[0]?.code).toBe('unavailable_here')
    expect(session.previewSnapshot()).toEqual(before)
    expect(session.view().activeTiles.length).toBeLessThanOrEqual(2_304)
  })
})
