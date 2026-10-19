import { describe, expect, it } from 'vitest'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { encodePublicV11Head, PUBLIC_V11_SCHEMA } from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'
import { createPublicV13MigrationHead, decodePublicV13Head, PUBLIC_V13_SCHEMA } from './publicWorldV13Snapshot'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import type { PublicV13Start } from './publicWorldV13Flow'
import { createPublicV13StreamSession } from './publicWorldV13Stream'
import type { PublicV13StreamIntent } from './publicWorldV13Stream'
import { nearbyWorldTileIds, PUBLIC_SPELL_REVEAL_RADIUS_METERS,
  PUBLIC_WALK_REVEAL_RADIUS_METERS } from './publicWorldDiscovery'
import { WORLD_GRID_MAX, WORLD_CELL_METERS } from './worldChunks'
import { DISCOVERY_MASK_BYTES, discoveryMaskHasTileId, encodeDiscoveredTileIds } from './discoveryMask'
import { highlandLandmark } from './highlandContent'
import { createStreamedWorld } from './streamedWorld'
import { mireglassRouteSites } from './mireglassRouteSites'
import { resolveTerrainWorkSite } from './terrainWorks'

const seed = 'greenway-alpha'
const bridgeId = 'works1:bridge:-102:92:z'
const ladderId = 'works1:ladder:-103:108:W'
const digId = 'tile--64-76'
const sourceIds = withFreshPublicV7Herbs(createFreshPublicWorld(seed,
  'greenway-classic-v1')).discoveredTileIds
const source = (worldSeed = seed) => {
  const base = withFreshPublicV7Herbs(createFreshPublicWorld(worldSeed, 'greenway-classic-v1'))
  const v11 = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(base)))
  return { sourceSchemaVersion: PUBLIC_V11_SCHEMA,
    sourceHead: encodePublicV11Head(v11, null, 0) } as const
}
function startAt(x: number, z: number, built: string[] = [], dug: string[] = [],
  boots = false): PublicV13Start {
  const sourceLineage = source()
  const zero = createPublicV13MigrationHead(sourceLineage)!
  const world = createStreamedWorld(seed, { x, z })
  const player: PublicV13Head['state']['player'] = { ...zero.state.player,
    position: { ...world.state.player.position },
    equipment: { ...zero.state.player.equipment, feet: boots ? 'leather_boots' as const : null },
    inventory: boots ? [{ itemId: 'leather_boots' as const, quantity: 1 }] : zero.state.player.inventory }
  const ids = [...new Set([...sourceIds,
    world.tileAtWorld(x, z)!.id])].sort()
  const state: PublicV13Head['state'] = { ...zero.state, movementOwner: 'streamed',
    tick: zero.state.tick + 1, player, discoveryMask: encodeDiscoveredTileIds(ids),
    terrainWorks: { builtWorkIds: built, dugTileIds: dug } }
  const head = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA, saveRevision: 1,
    bootstrap: zero.bootstrap, state }, sourceLineage)
  if (!head) throw Error('Invalid stream fixture')
  return { state: head.state, bootstrap: head.bootstrap, saveRevision: head.saveRevision,
    sourceLineage }
}
const move = (x: number, z = 0) => ({ type: 'move' as const, delta: { x, z } })
function marketStart(tick: number, x = 0, z = 0): PublicV13Start {
  const base = startAt(x, z)
  const slots = [...base.state.player.tradeSlots] as typeof base.state.player.tradeSlots
  slots[0] = { slotIndex: 0, itemId: 'logs', quantity: 1, unitPrice: 2 }
  const state = { ...base.state, tick, player: { ...base.state.player, tradeSlots: slots } }
  const checked = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: base.saveRevision, bootstrap: base.bootstrap, state }, base.sourceLineage)
  if (!checked) throw Error('Invalid market fixture')
  return { ...base, state: checked.state }
}
function nextSimulationRng(value: number): number {
  let next = value | 0
  next ^= next << 13; next ^= next >>> 17; next ^= next << 5
  return next >>> 0 || 1
}

describe('unmounted compact v13 streamed session', () => {
  it.each([[-64, 0], [WORLD_GRID_MAX * WORLD_CELL_METERS, 0]])(
    'casts a learned glow at %s, %s with canonical mask discovery and repeat-safe XP', (x, z) => {
      const base = startAt(x, z)
      const start = { ...base, state: { ...base.state, player: { ...base.state.player,
        learnedSpellIds: ['wayfinder_glow' as const] } } }
      const session = createPublicV13StreamSession(start)
      const cast = { type: 'cast_spell' as const, spellId: 'wayfinder_glow' as const }
      const expected = nearbyWorldTileIds(start.state.player.position, PUBLIC_SPELL_REVEAL_RADIUS_METERS)
        .filter((id) => !discoveryMaskHasTileId(start.state.discoveryMask, id))
      expect(expected.length).toBeGreaterThan(0)
      const result = session.advance([cast], { walkRequested: false })
      expect(result.rejections).toEqual([])
      expect(result.events[0]).toMatchObject({ type: 'spell_cast',
        revealedTileIds: expected, revealedDigSiteIds: [] })
      expect(result.events.filter((event) => event.type === 'tile_discovered')
        .map((event) => event.tileId)).toEqual(expected)
      expect(new Set(result.events.filter((event) => event.type === 'tile_discovered')
        .map((event) => event.tileId)).size).toBe(expected.length)
      expect(result.events.slice(-2)).toMatchObject([
        { type: 'skill_xp_gained', skillId: 'spellcraft', xp: expected.length * 10 },
        { type: 'skill_xp_gained', skillId: 'wayfinding', xp: expected.length * 10 }])
      expect(result.events.map((event) => event.sequence)).toEqual(result.events.map((_, index) =>
        start.state.eventSequence + index + 1))
      const saved = session.snapshotForSave()
      const expectedMask = new Uint8Array(start.state.discoveryMask)
      const addedMask = encodeDiscoveredTileIds(expected)
      for (let i = 0; i < expectedMask.length; i++) expectedMask[i] |= addedMask[i]
      expect(saved.discoveryMask).toEqual(expectedMask)
      expect(saved.player.skillXp.spellcraft).toBe(start.state.player.skillXp.spellcraft + expected.length * 10)
      expect(saved.player.skillXp.wayfinding).toBe(start.state.player.skillXp.wayfinding + expected.length * 10)
      expect(saved.player.xp).toBe(start.state.player.xp)
      expect(session.view().activeKnownTileIds).toEqual(expect.arrayContaining(expected))
      const reloaded = createPublicV13StreamSession({ ...start, state: saved, saveRevision: 2 })
      for (const owner of [session, reloaded]) {
        expect(owner.advance([cast], { walkRequested: false }).events).toMatchObject([
          { type: 'spell_cast', revealedTileIds: [], revealedDigSiteIds: [] }])
        expect(owner.snapshotForSave().player.skillXp).toEqual(saved.player.skillXp)
        expect(owner.snapshotForSave().discoveryMask).toEqual(saved.discoveryMask)
      }
      expect(() => createPublicV13StreamSession({ ...start, state: saved,
        sourceLineage: source('forged-source') })).toThrow(RangeError)
    })

  it('rejects unlearned, invalid, and composite casts without clock, mask, market, or XP changes', () => {
    const session = createPublicV13StreamSession(marketStart(599))
    const before = session.snapshotForSave()
    const cast = { type: 'cast_spell' as const, spellId: 'wayfinder_glow' as const }
    expect(session.advance([cast], { walkRequested: false }).rejections)
      .toMatchObject([{ intentType: 'cast_spell', code: 'unlearned_spell' }])
    expect(session.advance([{ ...cast, spellId: 'forged' } as unknown as PublicV13StreamIntent],
      { walkRequested: false }).rejections).toMatchObject([{ code: 'invalid_value' }])
    expect(session.advance([{ type: 'look', yawDelta: .1, pitchDelta: 0 }, cast],
      { walkRequested: false }).rejections).toMatchObject([{ intentIndex: 1, code: 'invalid_value' }])
    expect(session.snapshotForSave()).toEqual(before)
  })

  it('reveals the outer ring after ordinary walking has discovered the inner 16 meters', () => {
    const base = startAt(-64, 0)
    const session = createPublicV13StreamSession({ ...base, state: { ...base.state,
      player: { ...base.state.player, learnedSpellIds: ['wayfinder_glow'] } } })
    expect(session.advance([move(.16)], { walkRequested: false }).rejections).toEqual([])
    const before = session.snapshotForSave()
    const walkingCircle = nearbyWorldTileIds(before.player.position, PUBLIC_WALK_REVEAL_RADIUS_METERS)
    expect(walkingCircle.every((id) => discoveryMaskHasTileId(before.discoveryMask, id))).toBe(true)
    const expected = nearbyWorldTileIds(before.player.position, PUBLIC_SPELL_REVEAL_RADIUS_METERS)
      .filter((id) => !discoveryMaskHasTileId(before.discoveryMask, id))
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.every((id) => !walkingCircle.includes(id))).toBe(true)
    const cast = { type: 'cast_spell' as const, spellId: 'wayfinder_glow' as const }
    const result = session.advance([cast], { walkRequested: false })
    expect(result.events.filter((event) => event.type === 'tile_discovered')
      .map((event) => event.tileId)).toEqual(expected)
    expect(session.snapshotForSave().player.skillXp.spellcraft)
      .toBe(before.player.skillXp.spellcraft + expected.length * 10)
    expect(session.advance([cast], { walkRequested: false }).events)
      .toMatchObject([{ type: 'spell_cast', revealedTileIds: [] }])
  })

  it('settles a due sale after casting and rejects unsafe skill progress atomically', () => {
    const base = marketStart(599, -64, 0)
    const learned = { ...base, state: { ...base.state, player: { ...base.state.player,
      learnedSpellIds: ['wayfinder_glow' as const] } } }
    const cast = { type: 'cast_spell' as const, spellId: 'wayfinder_glow' as const }
    const session = createPublicV13StreamSession(learned)
    const result = session.advance([cast], { walkRequested: false })
    expect(result.events[0].type).toBe('spell_cast')
    expect(result.events.at(-1)?.type).toBe('trade_listing_sold')
    expect(session.snapshotForSave().tick).toBe(600)
    expect(session.snapshotForSave().player.coins).toBe(base.state.player.coins + 2)
    const full = createPublicV13StreamSession({ ...learned, state: { ...learned.state,
      player: { ...learned.state.player, skillXp: { ...learned.state.player.skillXp,
        spellcraft: Number.MAX_SAFE_INTEGER } } } })
    const before = full.snapshotForSave()
    expect(full.advance([cast], { walkRequested: false }).rejections)
      .toMatchObject([{ code: 'invalid_value' }])
    expect(full.snapshotForSave()).toEqual(before)
  })

  it('rehydrates a compact unsaved stream from a real revision-zero Greenway base', () => {
    const lineage = source()
    const zero = createPublicV13MigrationHead(lineage)!
    const base: PublicV13Start = { state: zero.state, bootstrap: zero.bootstrap,
      saveRevision: zero.saveRevision, sourceLineage: lineage }
    const current = { ...startAt(0, 0, [bridgeId], [digId]).state,
      discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff) }
    expect(() => createPublicV13StreamSession(base)).toThrow(RangeError)
    const session = createPublicV13StreamSession(base, current)
    const expected = structuredClone(session.snapshotForSave())
    expect(expected.terrainWorks).toEqual(current.terrainWorks)
    expect(expected.windstep).toEqual(current.windstep)
    expect(expected.discoveryMask).toEqual(current.discoveryMask)
    expect(base.saveRevision).toBe(0)
    current.discoveryMask.fill(0)
    current.player.coins += 77
    const view = session.view()
    const viewedPosition = view.player.position as { x: number }
    viewedPosition.x += 77
    expect(session.snapshotForSave()).toEqual(expected)
    expect(session.advance([move(.16)], { walkRequested: false }).rejections).toEqual([])
    expect(session.snapshotForSave().tick).toBe(expected.tick + 1)
  })

  it('rejects stale, mask-rollback, changed-source, and wrong-owner stream currents', () => {
    const base = startAt(0, 0)
    expect(() => createPublicV13StreamSession(base, base.state)).toThrow(RangeError)
    const dense: PublicV13Start = { ...base, state: { ...base.state,
      discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff) } }
    expect(() => createPublicV13StreamSession(dense,
      { ...base.state, tick: dense.state.tick + 1 })).toThrow(RangeError)
    expect(() => createPublicV13StreamSession(base,
      { ...base.state, tick: base.state.tick + 1, movementOwner: 'greenway' })).toThrow(RangeError)
    const changed = { ...base, sourceLineage: source('another-greenway') }
    expect(() => createPublicV13StreamSession(changed,
      { ...base.state, tick: base.state.tick + 1 })).toThrow(RangeError)
  })

  it('rejects Greenway, forged starts, and a second or oversized move without partial state', () => {
    const lineage = source(), zero = createPublicV13MigrationHead(lineage)!
    expect(() => createPublicV13StreamSession({ state: zero.state, bootstrap: zero.bootstrap,
      saveRevision: zero.saveRevision, sourceLineage: lineage })).toThrow()
    const valid = startAt(0, 0)
    expect(() => createPublicV13StreamSession({ ...valid, state: { ...valid.state,
      player: { ...valid.state.player, position: { x: Infinity, y: 0, z: 0 } } } })).toThrow()
    const session = createPublicV13StreamSession(valid)
    const before = session.snapshotForSave()
    expect(session.advance([move(.16), move(.16)], { walkRequested: false }).rejections)
      .toMatchObject([{ intentIndex: 1, code: 'invalid_value' }])
    expect(session.advance([move(.24)], { walkRequested: false }).rejections)
      .toMatchObject([{ intentIndex: 0, code: 'invalid_value' }])
    expect(session.snapshotForSave()).toEqual(before)
    expect(session.advance([move(.16)], { walkRequested: false }).rejections).toEqual([])
    expect(session.view().tick).toBe(before.tick + 1)
  })

  it('advances one accepted idle clock and RNG, settling a due listing after streamed events', () => {
    const start = marketStart(599)
    const session = createPublicV13StreamSession(start)
    const first = session.advance([], { walkRequested: false })
    const saved = session.snapshotForSave()
    expect(first.rejections).toEqual([])
    expect(first.events).toEqual([{ type: 'trade_listing_sold', tick: 600,
      sequence: start.state.eventSequence + 1, slotIndex: 0, itemId: 'logs',
      quantity: 1, unitPrice: 2, totalPrice: 2 }])
    expect(saved.tick).toBe(600)
    expect(saved.rng.simulation).toBe(nextSimulationRng(start.state.rng.simulation))
    expect(saved.player.coins).toBe(start.state.player.coins + 2)
    expect(saved.player.tradeSlots[0].itemId).toBeNull()
    expect(saved.eventSequence).toBe(first.events.at(-1)?.sequence)
    expect('discoveredTileIds' in saved).toBe(false)
    const reloaded = createPublicV13StreamSession({ ...start, state: saved,
      saveRevision: start.saveRevision + 1 })
    expect(reloaded.snapshotForSave()).toEqual(saved)
    const detached = session.snapshotForSave()
    detached.discoveryMask[0] ^= 1
    detached.player.coins += 100
    expect(session.snapshotForSave()).toEqual(saved)
  })

  it('keeps market pending off-cycle, orders look/move before sales, and rejects bad frames atomically', () => {
    const start = marketStart(598)
    const session = createPublicV13StreamSession(start)
    const idle = session.advance([], { walkRequested: false })
    expect(idle.events).toEqual([])
    const pending = session.snapshotForSave()
    expect(pending.tick).toBe(599)
    expect(pending.player.tradeSlots[0].itemId).toBe('logs')
    for (const invalid of [
      [move(.16), { type: 'look' as const, yawDelta: .1, pitchDelta: 0 }],
      [{ type: 'look' as const, yawDelta: 0, pitchDelta: 0 },
        { type: 'jump' as const }],
      [move(.16), move(.16), move(.16)],
      [move(.24)],
    ]) {
      expect(session.advance(invalid, { walkRequested: false }).rejections).toHaveLength(1)
      expect(session.snapshotForSave()).toEqual(pending)
    }
    const accepted = session.advance([
      { type: 'look', yawDelta: .1, pitchDelta: 0 }, move(.16),
    ], { walkRequested: false })
    expect(accepted.rejections).toEqual([])
    expect(accepted.events.slice(0, 2).map((event) => event.type))
      .toEqual(['player_looked', 'player_moved'])
    expect(accepted.events.at(-1)?.type).toBe('trade_listing_sold')
    expect(accepted.events.map((event) => event.sequence))
      .toEqual(accepted.events.map((_, index) => pending.eventSequence + index + 1))
    const saved = session.snapshotForSave()
    expect(saved.tick).toBe(600)
    expect(saved.rng.simulation).toBe(nextSimulationRng(pending.rng.simulation))
    expect(saved.player.coins).toBe(pending.player.coins + 2)
    expect(saved.eventSequence).toBe(accepted.events.at(-1)?.sequence)
  })

  it('discovers Quarry Crown after realized entry, after due sale, once through save and reload', () => {
    const landmark = highlandLandmark(seed)
    const start = marketStart(599, landmark.tile.center.x - 8.32,
      landmark.tile.center.z)
    const session = createPublicV13StreamSession(start)
    const approach = session.advance([move(.16)], { walkRequested: false })
    expect(approach.rejections).toEqual([])
    expect(approach.events.at(-1)?.type).toBe('trade_listing_sold')
    expect(session.snapshotForSave().highland.landmarkDiscovered).toBe(false)
    const entry = session.advance([move(.16)], { walkRequested: false })
    expect(entry.rejections).toEqual([])
    expect(entry.events.at(-1)).toEqual({ type: 'highland_landmark_discovered',
      tick: 601, sequence: session.snapshotForSave().eventSequence, landmarkId: landmark.id })
    expect(entry.events.map((event) => event.sequence)).toEqual(entry.events.map((_, index) =>
      approach.events.at(-1)!.sequence + index + 1))
    const saved = session.snapshotForSave()
    expect(saved.highland.landmarkDiscovered).toBe(true)
    const restored = createPublicV13StreamSession({ ...start, state: saved,
      saveRevision: start.saveRevision + 1 })
    expect(restored.snapshotForSave().highland.landmarkDiscovered).toBe(true)
    expect(restored.advance([move(.16)], { walkRequested: false }).events
      .filter((event) => event.type === 'highland_landmark_discovered')).toEqual([])
    const detached = session.snapshotForSave()
    Object.assign(detached.highland, { landmarkDiscovered: false })
    expect(session.snapshotForSave().highland.landmarkDiscovered).toBe(true)
  })

  it('orders a due sale before the one Highland landmark event on the same frame', () => {
    const landmark = highlandLandmark(seed)
    const start = marketStart(599, landmark.tile.center.x - 8.16,
      landmark.tile.center.z)
    const session = createPublicV13StreamSession(start)
    const entered = session.advance([move(.16)], { walkRequested: false })
    expect(entered.rejections).toEqual([])
    expect(entered.events.slice(-2).map((event) => event.type))
      .toEqual(['trade_listing_sold', 'highland_landmark_discovered'])
    expect(entered.events.map((event) => event.sequence)).toEqual(entered.events.map((_, index) =>
      start.state.eventSequence + index + 1))
    const saved = session.snapshotForSave()
    expect(saved.tick).toBe(600)
    expect(saved.rng.simulation).toBe(nextSimulationRng(start.state.rng.simulation))
    expect(saved.player.coins).toBe(start.state.player.coins + 2)
    expect(saved.highland.landmarkDiscovered).toBe(true)
    expect(saved.eventSequence).toBe(entered.events.at(-1)?.sequence)
  })

  it('does not discover the Highland landmark on idle, look, zero displacement, or rejection', () => {
    const landmark = highlandLandmark(seed)
    const start = startAt(landmark.tile.center.x - 7.84, landmark.tile.center.z)
    const session = createPublicV13StreamSession(start)
    for (const intents of [[], [{ type: 'look' as const, yawDelta: .1, pitchDelta: 0 }],
      [move(0)], [move(.24)]]) {
      expect(session.advance(intents, { walkRequested: false }).events
        .filter((event) => event.type === 'highland_landmark_discovered')).toEqual([])
      expect(session.snapshotForSave().highland.landmarkDiscovered).toBe(false)
    }
    expect(session.advance([move(.16)], { walkRequested: false }).events
      .filter((event) => event.type === 'highland_landmark_discovered')).toHaveLength(1)
  })

  it('preserves original dug Y and built bridge/ladder support through reload', () => {
    for (const [id, dx, dz] of [[bridgeId, 0, .16], [ladderId, -.16, 0]] as const) {
      const site = resolveTerrainWorkSite(seed, id)
      if (!site || site.kind === 'dig') throw Error('Invalid structure fixture')
      const session = createPublicV13StreamSession(startAt(site.from.x, site.from.z, [id]))
      for (let i = 0; i < 9; i++) expect(session.advance([move(dx, dz)],
        { walkRequested: false }).rejections).toEqual([])
      const saved = session.snapshotForSave()
      const reloaded = createPublicV13StreamSession({ ...startAt(site.from.x, site.from.z, [id]),
        state: saved, saveRevision: 2 })
      expect(reloaded.view().player.position).toEqual(session.view().player.position)
      expect(reloaded.advance([move(dx, dz)], { walkRequested: false }).rejections).toEqual([])
    }
    const site = resolveTerrainWorkSite(seed, digId)
    if (!site || site.kind !== 'dig') throw Error('Invalid dig fixture')
    const base = startAt(site.center.x, site.center.z)
    const dugState = { ...base.state, terrainWorks: { builtWorkIds: [], dugTileIds: [digId] },
      player: { ...base.state.player, position: { ...base.state.player.position,
        y: base.state.player.position.y - .24 } } }
    const dug = createPublicV13StreamSession({ ...base, state: dugState })
    expect(dug.snapshotForSave().player.position.y).toBeCloseTo(dugState.player.position.y)
    expect(dug.advance([], { walkRequested: false }).rejections).toEqual([])
    expect(dug.view().player.position.y).toBeCloseTo(dugState.player.position.y)
  })

  it.each(['bridge', 'ladder'] as const)('keeps an authored Mireglass %s traversable with v13 work hooks', (kind) => {
    const route = mireglassRouteSites(seed).find((site) => site.kind === kind)!
    const base = startAt(route.from.x, route.from.z)
    const xp = kind === 'bridge' ? 80 : 60
    const state: PublicV13Head['state'] = { ...base.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([...sourceIds,
        `tile-${route.from.x / 4 + 3}-${route.from.z / 4 + 3}`,
        `tile-${route.to.x / 4 + 3}-${route.to.z / 4 + 3}`])].sort()),
      mireglass: { ...base.state.mireglass, builtRoutes: { ...base.state.mireglass.builtRoutes,
        [kind]: route.id } },
      terrainWorks: { builtWorkIds: [kind === 'bridge' ? ladderId : bridgeId], dugTileIds: [] },
      player: { ...base.state.player, xp: base.state.player.xp + xp,
        level: 1 + Math.floor((base.state.player.xp + xp) / 100),
        skillXp: { ...base.state.player.skillXp,
          construction: base.state.player.skillXp.construction + xp } } }
    const session = createPublicV13StreamSession({ ...base, state })
    const length = Math.hypot(route.to.x - route.from.x, route.to.z - route.from.z)
    const delta = move((route.to.x - route.from.x) / length * .16,
      (route.to.z - route.from.z) / length * .16)
    for (let i = 0; i < Math.round(length / .16); i++) {
      expect(session.advance([delta], { walkRequested: false }).rejections).toEqual([])
    }
    expect(session.view().player.position.y).toBeCloseTo(route.to.y, 1)
    const saved = session.snapshotForSave()
    expect(createPublicV13StreamSession({ ...base, state: saved,
      saveRevision: base.saveRevision + 1 }).view().player.position).toEqual(session.view().player.position)
  })

  it('caps dense and long-travel discovery to the local window without dropping saved bits', () => {
    const base = startAt(0, 0)
    const dense = { ...base.state,
      discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff) }
    const session = createPublicV13StreamSession({ ...base, state: dense })
    expect(session.view().activeKnownTileIds.length).toBeLessThanOrEqual(2_304)
    for (let index = 0; index < 430; index++) {
      expect(session.advance([move(.16)], { walkRequested: false }).rejections).toEqual([])
      expect(session.view().activeKnownTileIds.length).toBeLessThanOrEqual(2_304)
    }
    const saved = session.snapshotForSave()
    expect(saved.discoveryMask).toEqual(dense.discoveryMask)
    expect('discoveredTileIds' in saved).toBe(false)
    expect(session.view().activeKnownTileIds).not.toContain('tile--13-3')
  })

  it('rebases at a chunk seam, drops exited local IDs, and retains their compact bits', () => {
    const base = startAt(63.84, 0)
    const oldId = 'tile--13-3'
    const sparse = { ...base.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([...sourceIds,
        oldId, 'tile-19-3'])].sort()) }
    const session = createPublicV13StreamSession({ ...base, state: sparse })
    expect(session.view().activeKnownTileIds).toContain(oldId)
    const before = sparse.eventSequence
    const advanced = session.advance([move(.16)], { walkRequested: false })
    expect(advanced.rejections).toEqual([])
    expect(advanced.events.map((event) => event.sequence))
      .toEqual(advanced.events.map((_, index) => before + index + 1))
    expect(session.view().activeKnownTileIds).not.toContain(oldId)
    expect(discoveryMaskHasTileId(session.snapshotForSave().discoveryMask, oldId)).toBe(true)
  })

  it('uses barefoot walk, booted default run, and booted walk toggle', () => {
    const bare = createPublicV13StreamSession(startAt(0, 0))
    const booted = createPublicV13StreamSession(startAt(0, 0, [], [], true))
    expect(bare.advance([move(.24)], { walkRequested: false }).rejections).toHaveLength(1)
    expect(booted.advance([move(.24)], { walkRequested: false }).rejections).toEqual([])
    expect(booted.advance([move(.24)], { walkRequested: true }).rejections).toHaveLength(1)
  })
})
