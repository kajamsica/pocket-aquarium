import { describe, expect, it, vi } from 'vitest'

const routeProbe = vi.hoisted(() => ({ canonicalCalls: 0 }))
vi.mock('./routeSites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./routeSites')>()
  return { ...actual,
    canonicalRouteSites: (...args: Parameters<typeof actual.canonicalRouteSites>) => {
      routeProbe.canonicalCalls++
      return actual.canonicalRouteSites(...args)
    },
  }
})
import { DISCOVERY_MASK_BYTES, discoveryMaskHasTileId } from './discoveryMask'
import { createGeneratedWorld, terrainHeightAt } from './generation'
import { MIREGLASS_RING_ID } from './mireglassContent'
import { mireglassRouteSites } from './mireglassRouteSites'
import { createPublicV11RouteSupport } from './publicV11RouteSupport'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { encodePublicV11Head, PUBLIC_V11_SCHEMA } from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'
import { createPublicV13ContinuousSession } from './publicWorldV13ContinuousSession'
import type { PublicV13Start } from './publicWorldV13Flow'
import type { PublicWorldIntent } from './publicWorldRuntime'
import { createPublicV13MigrationHead, decodePublicV13Head, PUBLIC_V13_SCHEMA } from './publicWorldV13Snapshot'
import { canonicalRouteSites } from './routeSites'
import { appendTerrainWorkLedger } from './terrainWorkLedger'
import { stepRng } from './world'
import { worldTileAtGrid } from './worldChunks'

const seed = 'greenway-alpha'
type Profile = 'greenway-classic-v1' | 'greenway-expanded-v1'
const move = (x: number, z = 0) => ({ type: 'move' as const, delta: { x, z } })
function zeroAt(profile: Profile, x: number, tick = 0, listing = false, z = 0): PublicV13Start {
  const fresh = createFreshPublicWorld(seed, profile)
  const v11 = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(
    withFreshPublicV7Herbs(fresh))))
  const slots = [...v11.player.tradeSlots] as typeof v11.player.tradeSlots
  if (listing) slots[0] = { slotIndex: 0, itemId: 'logs', quantity: 1, unitPrice: 2 }
  const tile = worldTileAtGrid(seed, Math.ceil(x / 4 - .5), Math.ceil(z / 4 - .5))
  const state = { ...v11, tick,
    player: { ...v11.player, tradeSlots: slots,
      position: { x, y: terrainHeightAt(v11.greenway.tiles, x, z), z } },
    discoveredTileIds: [...new Set([...v11.discoveredTileIds, tile.id])].sort() }
  const sourceLineage = { sourceSchemaVersion: PUBLIC_V11_SCHEMA,
    sourceHead: encodePublicV11Head(state, null, 0) } as const
  const zero = createPublicV13MigrationHead(sourceLineage)!
  return { state: zero.state, bootstrap: zero.bootstrap,
    saveRevision: zero.saveRevision, sourceLineage }
}

describe('unmounted continuous v13 session', () => {
  it('walks onto visible Greenway low steps from their edge and an aligned angle', () => {
    const zero = zeroAt('greenway-classic-v1', 0, 0, false, -4)
    const site = canonicalRouteSites(createGeneratedWorld(seed, 'greenway-classic-v1'))
      .find((candidate) => candidate.id === 'greenway_ladder:x:0')!
    const startAtFoot = (x: number, yaw: number) => {
      const state = { ...zero.state,
        discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff),
        greenway: { ...zero.state.greenway, builtRouteIds: ['greenway_ladder'],
          routes: zero.state.greenway.routes.map((route) => route.id === 'greenway_ladder'
            ? { ...route, siteId: site.id, from: site.from, to: site.to } : route) },
        player: { ...zero.state.player, yaw, xp: 60,
          skillXp: { ...zero.state.player.skillXp, construction: 60 },
          position: { x, y: terrainHeightAt(zero.state.greenway.tiles, x, -4), z: -4 } } }
      const head = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
        saveRevision: 1, bootstrap: zero.bootstrap, state }, zero.sourceLineage)!
      expect(head).not.toBeNull()
      return createPublicV13ContinuousSession({ ...zero, state: head.state, saveRevision: 1 })
    }

    const edge = startAtFoot(.72, 0)
    expect(edge.advanceFrame([move(0, -.16)], { walkRequested: false }).rejections).toEqual([])
    expect(edge.view().player.position).toMatchObject({ x: .72, z: -4.16 })

    const angled = startAtFoot(.69, -.13)
    const angledStep = move(-Math.sin(-.13) * .16, -Math.cos(-.13) * .16)
    expect(angled.advanceFrame([angledStep], { walkRequested: false }).rejections).toEqual([])
    expect(angled.view().player.position.x).toBeCloseTo(.7107414628191511)
    expect(angled.view().player.position.z).toBeCloseTo(-4.158649902994366)
    expect(angled.advanceFrame([angledStep], { walkRequested: false }).rejections).toEqual([])
    expect(angled.view().player.position.z).toBeCloseTo(-4.317299805988732)

    const outside = startAtFoot(.76, 0)
    const before = outside.snapshotForSave()
    expect(outside.advanceFrame([move(0, -.16)], { walkRequested: false }).rejections)
      .toMatchObject([{ code: 'locked_area' }])
    expect(outside.snapshotForSave()).toEqual(before)
  })

  it('walks off built route endpoints when a fixed W frame overshoots the area seam', () => {
    const zero = zeroAt('greenway-classic-v1', 0, 0, false, -4)
    const sites = canonicalRouteSites(createGeneratedWorld(seed, 'greenway-classic-v1'))
    const selected = ['greenway_ladder:x:0', 'highland_bridge:z:-8'].map((id) =>
      sites.find((site) => site.id === id)!)
    const routes = zero.state.greenway.routes.map((route) => {
      const site = selected.find((candidate) => candidate.routeId === route.id)
      return site ? { ...route, siteId: site.id, from: site.from, to: site.to } : route
    })
    for (const { x, z, yaw, pace, frames, destination } of [
      { x: 6, z: -8, yaw: Math.PI / 2, pace: .16, frames: 13, destination: { x: 3.92, z: -8 } },
      { x: 0, z: -8, yaw: Math.PI, pace: .24, frames: 17, destination: { x: 0, z: -3.92 } },
    ]) {
      const running = pace === .24
      const state = { ...zero.state, discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff),
        greenway: { ...zero.state.greenway, builtRouteIds: ['greenway_ladder', 'highland_bridge'],
          unlockedRecipeIds: ['greenway_ladder', 'highland_bridge'], routes },
        player: { ...zero.state.player, yaw, xp: 140, level: 2,
          coins: zero.state.player.coins - (running ? 25 : 0),
          inventory: running ? [...zero.state.player.inventory, { itemId: 'leather_boots', quantity: 1 }]
            : zero.state.player.inventory,
          equipment: { ...zero.state.player.equipment, feet: running ? 'leather_boots' : null },
          skillXp: { ...zero.state.player.skillXp, construction: 140 },
          position: { x, y: terrainHeightAt(zero.state.greenway.tiles, x, z), z } } }
      const head = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
        saveRevision: 1, bootstrap: zero.bootstrap, state }, zero.sourceLineage)!
      expect(head).not.toBeNull()
      const session = createPublicV13ContinuousSession({ ...zero, state: head.state, saveRevision: 1 })
      const step = move(-Math.sin(yaw) * pace, -Math.cos(yaw) * pace)
      for (let frame = 0; frame < frames; frame++) {
        expect(session.advanceFrame([step], { walkRequested: false }).rejections).toEqual([])
      }
      expect(session.view().player.position.x).toBeCloseTo(destination.x)
      expect(session.view().player.position.z).toBeCloseTo(destination.z)
      expect(session.advanceFrame([step], { walkRequested: false }).rejections).toEqual([])
    }
  })

  it('bounds direct endpoint crossing without narrowing built Fen or Slate routes', () => {
    const zero = zeroAt('greenway-classic-v1', 0)
    const site = canonicalRouteSites(createGeneratedWorld(seed, 'greenway-classic-v1'))
      .find((candidate) => candidate.id === 'highland_bridge:z:-8')!
    const greenway = { ...zero.state.greenway, builtRouteIds: ['highland_bridge' as const],
      routes: zero.state.greenway.routes.map((route) => route.id === 'highland_bridge'
        ? { ...route, siteId: site.id, from: site.from, to: site.to } : route) }
    const state = { ...zero.state, discoveredTileIds: [], greenway }
    routeProbe.canonicalCalls = 0
    const support = createPublicV11RouteSupport(state)
    expect(routeProbe.canonicalCalls).toBe(1)
    expect(support.crossing({ x: 4.08, z: -8 }, { x: 3.92, z: -8 })?.kind)
      .toBe('highland_bridge')
    expect(support.crossing({ x: 4.08, z: -8 }, { x: 3.8, z: -8 })).toBeNull()
    expect(support.crossing({ x: 4.08, z: -7.29 }, { x: 3.92, z: -7.29 })).toBeNull()
    routeProbe.canonicalCalls = 0
    expect(createPublicV11RouteSupport({ ...state, greenway: { ...greenway,
      builtRouteIds: [] } }).crossing(
      { x: 4.08, z: -8 }, { x: 3.92, z: -8 })).toBeNull()
    expect(routeProbe.canonicalCalls).toBe(0)
    const stale = createPublicV11RouteSupport({ ...state, greenway: { ...greenway,
      routes: greenway.routes.map((route) => route.id === 'highland_bridge'
        ? { ...route, siteId: 'stale-site' } : route) } })
    expect(routeProbe.canonicalCalls).toBe(1)
    expect(stale.crossing({ x: 4.08, z: -8 }, { x: 3.92, z: -8 })).toBeNull()

    const regional = mireglassRouteSites(seed)
    const fen = regional.find((candidate) => candidate.kind === 'bridge')!
    const slate = regional.find((candidate) => candidate.kind === 'ladder')!
    const built = createPublicV11RouteSupport({ ...state,
      mireglass: { ...state.mireglass, builtRoutes: { bridge: fen.id, ladder: slate.id } } })
    const inside = (route: typeof fen, t: number) => ({
      x: route.from.x + (route.to.x - route.from.x) * t,
      z: route.from.z + (route.to.z - route.from.z) * t,
    })
    expect(built.crossing(inside(fen, .25), inside(fen, .75))?.kind).toBe('fen_bridge')
    expect(built.crossing(inside(slate, .25), inside(slate, .75))?.kind).toBe('slate_ladder')
    routeProbe.canonicalCalls = 0
    const regionalOnly = createPublicV11RouteSupport({ ...state,
      greenway: { ...greenway, builtRouteIds: [] },
      mireglass: { ...state.mireglass, builtRoutes: { bridge: fen.id, ladder: slate.id } } })
    expect(routeProbe.canonicalCalls).toBe(0)
    expect(regionalOnly.clearsMireglassBarrier(inside(fen, .25), inside(fen, .75),
      'fen_channel')).toBe(true)
    expect(regionalOnly.clearsMireglassBarrier(inside(slate, .25), inside(slate, .75),
      'slate_cliff')).toBe(true)
  })

  it('routes learned glow across the boundary and preserves it through saved reload and return', () => {
    const zero = zeroAt('greenway-classic-v1', -12)
    const base = { ...zero, state: { ...zero.state, player: { ...zero.state.player,
      learnedSpellIds: ['wayfinder_glow' as const] } }, saveRevision: 1 }
    const session = createPublicV13ContinuousSession(base)
    expect(session.advanceFrame([move(-.16)], { walkRequested: false }).rejections).toEqual([])
    const cast = { type: 'cast_spell' as const, spellId: 'wayfinder_glow' as const }
    expect(session.advanceFrame([cast], { walkRequested: false }).events[0])
      .toMatchObject({ type: 'spell_cast' })
    const saved = session.snapshotForSave()
    const restored = createPublicV13ContinuousSession({ ...base, state: saved, saveRevision: 2 })
    expect(restored.advanceFrame([cast], { walkRequested: false }).events)
      .toMatchObject([{ type: 'spell_cast', revealedTileIds: [] }])
    const beforeInvalid = restored.snapshotForSave()
    expect(restored.advanceFrame([{ type: 'look', yawDelta: .1, pitchDelta: 0 }, cast],
      { walkRequested: false }).rejections).toMatchObject([{ code: 'invalid_frame' }])
    expect(restored.snapshotForSave()).toEqual(beforeInvalid)
    expect(restored.advanceFrame([move(.16)], { walkRequested: false }).rejections).toEqual([])
    expect(restored.view().movementOwner).toBe('greenway')
    expect(restored.advanceFrame([cast], { walkRequested: false }).rejections).toEqual([])
  })

  it.each([['greenway-classic-v1', -12], ['greenway-expanded-v1', -30]] as const)(
    'walks out and back across %s from revision zero after an unsaved frame', (profile, edge) => {
      const base = zeroAt(profile, edge)
      const original = structuredClone(base)
      const session = createPublicV13ContinuousSession(base)
      expect(session.view().movementOwner).toBe('greenway')
      const dirty = session.advanceFrame([{ type: 'look', yawDelta: .1, pitchDelta: .02 }],
        { walkRequested: false })
      expect(dirty.rejections).toEqual([])
      const out = session.advanceFrame([move(-.16)], { walkRequested: false })
      expect(out.rejections).toEqual([])
      expect(session.view().movementOwner).toBe('streamed')
      expect(out.events.map((event) => event.sequence))
        .toEqual(out.events.map((_, index) => base.state.eventSequence + dirty.events.length + index + 1))
      const exterior = session.snapshotForSave()
      const exteriorPreview = session.previewSnapshot()
      expect(exteriorPreview).toEqual(exterior)
      exteriorPreview.discoveryMask.fill(0)
      exteriorPreview.player.coins += 10
      expect(session.snapshotForSave()).toEqual(exterior)
      expect(exterior.player.position.x).toBeLessThan(edge)
      const back = session.advanceFrame([move(.16)], { walkRequested: false })
      expect(back.rejections).toEqual([])
      expect(session.view().movementOwner).toBe('greenway')
      const saved = session.snapshotForSave()
      expect(saved.player.position.x).toBeCloseTo(edge)
      expect(saved.tick).toBe(base.state.tick + 3)
      expect(saved.rng.simulation).toBe(stepRng(stepRng(stepRng(base.state.rng.simulation))))
      expect(saved.eventSequence).toBe(base.state.eventSequence
        + dirty.events.length + out.events.length + back.events.length)
      expect(saved.terrainWorks).toEqual(base.state.terrainWorks)
      expect(saved.windstep).toEqual(base.state.windstep)
      expect(decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
        saveRevision: base.saveRevision + 1, bootstrap: base.bootstrap,
        state: saved }, base.sourceLineage)).not.toBeNull()
      const finalMask = new Uint8Array(saved.discoveryMask)
      const greenwayPreview = session.previewSnapshot()
      expect(greenwayPreview).toEqual(saved)
      greenwayPreview.discoveryMask.fill(0)
      saved.discoveryMask.fill(0)
      expect(session.snapshotForSave().discoveryMask).toEqual(finalMask)
      expect(base).toEqual(original)
    })

  it('retains dense bits, work, wind, inventory, and ordered due market settlement', () => {
    const zero = zeroAt('greenway-classic-v1', -12, 598, true)
    const context = { seed, fieldCampTileIds: [], authoredBuiltRouteIds: [] }
    let works = zero.state.terrainWorks
    for (const id of ['works1:bridge:-102:92:z', 'works1:ladder:-103:108:W', 'tile--64-76']) {
      works = appendTerrainWorkLedger(works, id, context)!
    }
    const state = { ...zero.state, discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff),
      terrainWorks: works, highland: { ...zero.state.highland, landmarkDiscovered: true },
      windstep: { ...zero.state.windstep, learned: true } }
    const head = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
      saveRevision: 1, bootstrap: zero.bootstrap, state }, zero.sourceLineage)!
    expect(head).not.toBeNull()
    const base: PublicV13Start = { ...zero, state: head.state, saveRevision: 1 }
    const session = createPublicV13ContinuousSession(base)
    const inventory = structuredClone(base.state.player.inventory)
    expect(session.advanceFrame([{ type: 'look', yawDelta: .1, pitchDelta: 0 }],
      { walkRequested: false }).rejections).toEqual([])
    const sale = session.advanceFrame([move(-.16)], { walkRequested: false })
    expect(sale.rejections).toEqual([])
    expect(sale.events.at(-1)?.type).toBe('trade_listing_sold')
    expect(sale.events.map((event) => event.sequence)).toEqual(sale.events.map((_, index) =>
      base.state.eventSequence + 2 + index))
    expect(session.advanceFrame([move(.16)], { walkRequested: false }).rejections).toEqual([])
    const saved = session.snapshotForSave()
    expect(saved.player.coins).toBe(base.state.player.coins + 2)
    expect(saved.player.inventory).toEqual(inventory)
    expect(saved.terrainWorks).toEqual(works)
    expect(saved.windstep).toEqual(state.windstep)
    expect(discoveryMaskHasTileId(saved.discoveryMask, 'tile-100-100')).toBe(true)
    expect(saved.discoveryMask).toEqual(state.discoveryMask)
    expect('discoveredTileIds' in saved).toBe(false)
  })

  it('rejects invalid composites, cross-region fairy travel, and blocked seams atomically', () => {
    const base = zeroAt('greenway-classic-v1', -12)
    const session = createPublicV13ContinuousSession(base)
    const before = session.snapshotForSave()
    const invalid = session.advanceFrame([move(-.16),
      { type: 'look', yawDelta: .1, pitchDelta: 0 }], { walkRequested: false })
    expect(invalid.rejections).toMatchObject([{ code: 'invalid_frame', intentIndex: 1 }])
    expect(invalid.events).toEqual([])
    expect(session.advanceFrame([null as unknown as PublicWorldIntent],
      { walkRequested: false }).rejections).toMatchObject([{ code: 'invalid_frame' }])
    const fairy = session.advanceFrame([{ type: 'teleport_fairy_ring',
      sourceRingId: 'ring-greenway', targetRingId: MIREGLASS_RING_ID }],
      { walkRequested: false })
    expect(fairy.rejections).toMatchObject([{ code: 'unavailable_here' }])
    expect(fairy.events).toEqual([])
    expect(session.advanceFrame([move(-.24)], { walkRequested: false }).rejections)
      .toMatchObject([{ code: 'invalid_value' }])
    expect(session.snapshotForSave()).toEqual(before)
    base.state.discoveryMask.fill(0)
    expect(session.advanceFrame([move(-.16)], { walkRequested: false }).rejections).toEqual([])
    const streamed = session.snapshotForSave()
    expect(session.advanceFrame([{ type: 'teleport_fairy_ring',
      sourceRingId: MIREGLASS_RING_ID, targetRingId: 'ring-greenway' }],
      { walkRequested: false }).rejections).toMatchObject([{ code: 'unavailable_here' }])
    expect(session.snapshotForSave()).toEqual(streamed)
  })

  it('preserves Greenway-only fairy travel and atomically rejects a locked northern return', () => {
    const zero = zeroAt('greenway-classic-v1', 0)
    const catalog = canonicalRouteSites(createGeneratedWorld(seed, 'greenway-classic-v1'))
    const sites = ['greenway_ladder', 'highland_bridge'].map((id) =>
      catalog.find((site) => site.routeId === id)!)
    const routes = zero.state.greenway.routes.map((route) => {
      const site = sites.find((candidate) => candidate.routeId === route.id)
      return site ? { ...route, siteId: site.id, from: site.from, to: site.to } : route
    })
    const ring = zero.state.greenway.fairyRings.find((item) => item.id === 'ring-greenway')!
    const state = { ...zero.state, discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff),
      greenway: { ...zero.state.greenway, routes,
        builtRouteIds: ['greenway_ladder', 'highland_bridge'],
        unlockedRecipeIds: ['greenway_ladder', 'highland_bridge'] },
      player: { ...zero.state.player, position: ring.position, xp: 140, level: 2,
        discoveredRingIds: ['ring-greenway', 'ring-highland'],
        skillXp: { ...zero.state.player.skillXp, construction: 140 } } }
    const head = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
      saveRevision: 1, bootstrap: zero.bootstrap, state }, zero.sourceLineage)!
    const session = createPublicV13ContinuousSession({ ...zero, state: head.state, saveRevision: 1 })
    const jumped = session.advanceFrame([{ type: 'teleport_fairy_ring',
      sourceRingId: 'ring-greenway', targetRingId: 'ring-highland' }], { walkRequested: false })
    expect(jumped.rejections).toEqual([])
    expect(jumped.events.filter((event) => event.type === 'tile_discovered')).toEqual([])
    expect(session.view().movementOwner).toBe('greenway')

    const north = createPublicV13ContinuousSession(zeroAt('greenway-classic-v1', 0, 0, false, -12))
    expect(north.advanceFrame([move(0, -.16)], { walkRequested: false }).rejections).toEqual([])
    const beforeReturn = north.snapshotForSave()
    expect(north.advanceFrame([move(0, .16)], { walkRequested: false }).rejections)
      .toMatchObject([{ code: 'locked_area' }])
    expect(north.snapshotForSave()).toEqual(beforeReturn)
  })
})
