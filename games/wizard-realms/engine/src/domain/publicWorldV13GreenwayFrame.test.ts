import { describe, expect, it } from 'vitest'
import { createGeneratedWorld, terrainHeightAt } from './generation'
import { MIREGLASS_RING_ID } from './mireglassContent'
import { canonicalRouteSites } from './routeSites'
import { DISCOVERY_MASK_BYTES, discoveryMaskHasTileId } from './discoveryMask'
import { createFreshPublicWorld } from './publicWorldState'
import { withFreshPublicV7Herbs } from './publicWorldV7'
import { withFreshPublicV9Camps } from './publicWorldV9State'
import { withPublicV10TerrainRevision } from './publicWorldV10State'
import { encodePublicV11Head, PUBLIC_V11_SCHEMA } from './publicWorldV11Snapshot'
import { withPublicV11Highland } from './publicWorldV11State'
import { createPublicV13MigrationHead, decodePublicV13Head, PUBLIC_V13_SCHEMA } from './publicWorldV13Snapshot'
import type { PublicV13Head } from './publicWorldV13Snapshot'
import type { PublicV13Start } from './publicWorldV13Flow'
import { createPublicV13GreenwaySession } from './publicWorldV13GreenwayFrame'

const seed = 'greenway-alpha'
const profile = 'greenway-classic-v1'
const source = (worldProfile: 'greenway-classic-v1' | 'greenway-expanded-v1' = profile) => {
  const fresh = withFreshPublicV7Herbs(createFreshPublicWorld(seed, worldProfile))
  const v11 = withPublicV11Highland(withPublicV10TerrainRevision(withFreshPublicV9Camps(fresh)))
  return { sourceSchemaVersion: PUBLIC_V11_SCHEMA,
    sourceHead: encodePublicV11Head(v11, null, 0) } as const
}
function startAt(x?: number, z?: number, changes: Partial<PublicV13Head['state']> = {},
  worldProfile: 'greenway-classic-v1' | 'greenway-expanded-v1' = profile): PublicV13Start {
  const sourceLineage = source(worldProfile)
  const zero = createPublicV13MigrationHead(sourceLineage)!
  const state = { ...zero.state, ...changes,
    player: { ...zero.state.player, ...changes.player,
      position: x === undefined ? zero.state.player.position
        : { x, y: terrainHeightAt(zero.state.greenway.tiles, x, z!), z: z! } } }
  const head = decodePublicV13Head({ schemaVersion: PUBLIC_V13_SCHEMA,
    saveRevision: 1, bootstrap: zero.bootstrap, state }, sourceLineage)
  if (!head) throw Error('Invalid Greenway fixture')
  return { state: head.state, bootstrap: head.bootstrap, saveRevision: head.saveRevision,
    sourceLineage }
}
const move = (x: number, z = 0) => ({ type: 'move' as const, delta: { x, z } })

describe('unmounted compact v13 Greenway session', () => {
  it('rehydrates an unsaved revision-zero Greenway frame without advancing the saved base', () => {
    const lineage = source()
    const zero = createPublicV13MigrationHead(lineage)!
    const base: PublicV13Start = { state: zero.state, bootstrap: zero.bootstrap,
      saveRevision: zero.saveRevision, sourceLineage: lineage }
    const first = createPublicV13GreenwaySession(base)
    expect(first.advance([move(.16)], { walkRequested: false }).rejections).toEqual([])
    const current = first.snapshotForSave()
    const expected = structuredClone(current)
    const resumed = createPublicV13GreenwaySession(base, current)
    expect(resumed.snapshotForSave()).toEqual(expected)
    expect(base.saveRevision).toBe(0)
    current.discoveryMask.fill(0)
    current.player.coins += 99
    const view = resumed.view()
    view.player.coins += 99
    expect(resumed.snapshotForSave()).toEqual(expected)
    expect(resumed.advance([move(.16)], { walkRequested: false }).rejections).toEqual([])
    expect(resumed.snapshotForSave().tick).toBe(expected.tick + 1)
  })

  it('rejects stale, mask-rollback, changed-source, and wrong-owner Greenway currents', () => {
    const sparse = startAt()
    const dense = startAt(undefined, undefined,
      { discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff) })
    expect(() => createPublicV13GreenwaySession(sparse, sparse.state)).toThrow(RangeError)
    expect(() => createPublicV13GreenwaySession(dense,
      { ...sparse.state, tick: dense.state.tick + 1 })).toThrow(RangeError)
    expect(() => createPublicV13GreenwaySession(sparse,
      { ...sparse.state, tick: sparse.state.tick + 1, movementOwner: 'streamed' })).toThrow(RangeError)
    const changed = { ...sparse, sourceLineage: source('greenway-expanded-v1') }
    expect(() => createPublicV13GreenwaySession(changed,
      { ...sparse.state, tick: sparse.state.tick + 1 })).toThrow(RangeError)
  })

  it('keeps a dense remote mask compact, detached, and exact through frames and reload', () => {
    const base = startAt()
    const dense = startAt(undefined, undefined,
      { discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff) })
    const oldLineage = structuredClone(dense.sourceLineage)
    const session = createPublicV13GreenwaySession(dense)
    expect(session.view().knownGreenwayTileIds).toHaveLength(49)
    expect(session.view().knownGreenwayTileIds).not.toContain('tile-100-100')
    for (let step = 0; step < 5; step++) {
      const advanced = session.advance([move(.16)], { walkRequested: false })
      expect(advanced.rejections).toEqual([])
      expect(advanced.events.filter((event) => event.type === 'tile_discovered')).toEqual([])
      expect(session.view().knownGreenwayTileIds.length).toBeLessThanOrEqual(49)
    }
    const saved = session.snapshotForSave()
    expect(saved.discoveryMask).toEqual(dense.state.discoveryMask)
    expect(discoveryMaskHasTileId(saved.discoveryMask, 'tile-100-100')).toBe(true)
    expect('discoveredTileIds' in saved).toBe(false)
    saved.discoveryMask.fill(0)
    const stillSaved = session.snapshotForSave()
    expect(discoveryMaskHasTileId(stillSaved.discoveryMask, 'tile-100-100')).toBe(true)
    const reloaded = createPublicV13GreenwaySession({ ...dense, state: stillSaved,
      saveRevision: dense.saveRevision + 1 })
    expect(reloaded.view().player.position).toEqual(session.view().player.position)
    expect(reloaded.advance([move(.16)], { walkRequested: false }).rejections).toEqual([])
    expect(dense.sourceLineage).toEqual(oldLineage)
    expect(dense.sourceLineage.sourceHead.schemaVersion).toBe(PUBLIC_V11_SCHEMA)
    expect(base.state.discoveryMask).toEqual(createPublicV13MigrationHead(base.sourceLineage)!.state.discoveryMask)
  })

  it('caps an expanded dense Greenway witness at its 256 authored tiles', () => {
    const expanded = startAt(undefined, undefined,
      { discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff) },
      'greenway-expanded-v1')
    const session = createPublicV13GreenwaySession(expanded)
    expect(session.view().knownGreenwayTileIds).toHaveLength(256)
    expect(session.advance([move(.16)], { walkRequested: false }).rejections).toEqual([])
    expect(session.view().knownGreenwayTileIds).toHaveLength(256)
    expect(session.snapshotForSave().discoveryMask).toEqual(expanded.state.discoveryMask)
  })

  it('does not rediscover remote mask-known tiles after an in-Greenway fairy jump', () => {
    const base = startAt()
    const catalog = canonicalRouteSites(createGeneratedWorld(seed, profile))
    const sites = ['greenway_ladder', 'highland_bridge'].map((id) =>
      catalog.find((site) => site.routeId === id)!)
    const routes = base.state.greenway.routes.map((route) => {
      const site = sites.find((candidate) => candidate.routeId === route.id)
      return site ? { ...route, siteId: site.id, from: site.from, to: site.to } : route
    })
    const sourceRing = base.state.greenway.fairyRings.find((ring) => ring.id === 'ring-greenway')!
    const ready = startAt(undefined, undefined, { discoveryMask: new Uint8Array(DISCOVERY_MASK_BYTES).fill(0xff),
      greenway: { ...base.state.greenway, builtRouteIds: ['greenway_ladder', 'highland_bridge'],
        unlockedRecipeIds: ['greenway_ladder', 'highland_bridge'], routes },
      player: { ...base.state.player, position: sourceRing.position, xp: 140, level: 2,
        discoveredRingIds: ['ring-greenway', 'ring-highland'],
        skillXp: { ...base.state.player.skillXp, construction: 140 } } })
    const session = createPublicV13GreenwaySession(ready)
    const jumped = session.advance([{ type: 'teleport_fairy_ring',
      sourceRingId: 'ring-greenway', targetRingId: 'ring-highland' }], { walkRequested: false })
    expect(jumped.rejections).toEqual([])
    expect(jumped.events.filter((event) => event.type === 'tile_discovered')).toEqual([])
    expect(session.snapshotForSave().discoveryMask).toEqual(ready.state.discoveryMask)
  })

  it('merges only discovered event bits and preserves wind and terrain work overlays', () => {
    const initial = startAt(8, 0)
    const session = createPublicV13GreenwaySession(initial)
    const before = session.snapshotForSave()
    const advanced = session.advance([move(.16)], { walkRequested: false })
    expect(advanced.rejections).toEqual([])
    const discoveries = advanced.events.filter((event) => event.type === 'tile_discovered')
    expect(discoveries.length).toBeGreaterThan(0)
    const saved = session.snapshotForSave()
    for (const event of discoveries) expect(discoveryMaskHasTileId(saved.discoveryMask, event.tileId)).toBe(true)
    expect(saved.windstep).toEqual(before.windstep)
    expect(saved.terrainWorks).toEqual(before.terrainWorks)
    expect(saved.eventSequence).toBe(before.eventSequence + advanced.events.length)
    expect(saved.tick).toBe(before.tick + 1)
  })

  it('reuses Greenway gathering, shop, equip, sale, and trade listing behavior', () => {
    const initial = startAt()
    const tree = initial.state.greenway.resources.find((resource) => resource.kind === 'tree')!
    const atTree = startAt(tree.position.x, tree.position.z)
    const gathering = createPublicV13GreenwaySession(atTree)
    expect(gathering.advance([{ type: 'equip_item', itemId: 'woodcutters_axe',
      slot: 'mainHand' }], { walkRequested: false }).rejections).toEqual([])
    for (let strike = 0; strike < tree.health; strike++) {
      expect(gathering.advance([{ type: 'harvest', resourceId: tree.id }],
        { walkRequested: false }).rejections).toEqual([])
    }
    const chopped = gathering.snapshotForSave()
    expect(chopped.greenway.resources.find((resource) => resource.id === tree.id)?.depleted).toBe(true)
    expect(chopped.player.inventory.find((stack) => stack.itemId === 'logs')?.quantity).toBe(4)
    expect(gathering.advance([{ type: 'create_trade_listing', slotIndex: 0,
      itemId: 'logs', quantity: 1, unitPrice: 3 }], { walkRequested: false }).rejections).toEqual([])
    expect(gathering.snapshotForSave().player.tradeSlots[0].itemId).toBe('logs')
    expect(gathering.advance([{ type: 'cancel_trade_listing', slotIndex: 0 }],
      { walkRequested: false }).rejections).toEqual([])

    const store = initial.state.greenway.stores[0]
    const shopping = createPublicV13GreenwaySession(startAt(store.position.x, store.position.z,
      { player: { ...initial.state.player,
        inventory: [...initial.state.player.inventory, { itemId: 'logs', quantity: 1 }] } }))
    const listing = store.listings[0]
    expect(shopping.advance([{ type: 'buy_store_listing', storeId: store.id,
      listingId: listing.id }], { walkRequested: false }).rejections).toEqual([])
    expect(shopping.snapshotForSave().greenway.stores[0].listings[0].stock).toBe(listing.stock - 1)
    expect(shopping.advance([{ type: 'sell_to_store', storeId: store.id,
      itemId: 'logs', quantity: 1 }], { walkRequested: false }).rejections).toEqual([])
  })

  it('rejects outbound travel, cross-region teleport, invalid gait and forged starts atomically', () => {
    const edge = createPublicV13GreenwaySession(startAt(-12, 0))
    const before = edge.snapshotForSave()
    const denied = edge.advance([{ type: 'look', yawDelta: .1, pitchDelta: 0 }, move(-.16)],
      { walkRequested: false })
    expect(denied.rejections).toMatchObject([{ code: 'unavailable_here', intentIndex: 1 }])
    expect(denied.events).toEqual([])
    expect(edge.advance([{ type: 'teleport_fairy_ring', sourceRingId: 'ring-greenway',
      targetRingId: MIREGLASS_RING_ID }], { walkRequested: false }).rejections)
      .toMatchObject([{ code: 'unavailable_here' }])
    expect(edge.advance([move(.24)], { walkRequested: false }).rejections)
      .toMatchObject([{ code: 'invalid_value' }])
    expect(edge.snapshotForSave()).toEqual(before)
    const booted = startAt(undefined, undefined, { player: { ...before.player,
      position: { ...startAt().state.player.position },
      equipment: { ...before.player.equipment, feet: 'leather_boots' },
      inventory: [...before.player.inventory, { itemId: 'leather_boots', quantity: 1 }] } })
    const runner = createPublicV13GreenwaySession(booted)
    expect(runner.advance([move(.24)], { walkRequested: false }).rejections).toEqual([])
    expect(runner.advance([move(.24)], { walkRequested: true }).rejections)
      .toMatchObject([{ code: 'invalid_value' }])
    expect(() => createPublicV13GreenwaySession({ ...booted, state: { ...booted.state,
      player: { ...booted.state.player, position: { x: Infinity, y: 0, z: 0 } } } })).toThrow()
  })

  it('keeps the authored low-step construction and traverse path inside Greenway', () => {
    const initial = startAt()
    const site = canonicalRouteSites(createGeneratedWorld(seed, profile)).find((candidate) =>
      candidate.routeId === 'greenway_ladder' && candidate.from.x === 0)!
    const atFoot = startAt(site.from.x, site.from.z, { player: { ...initial.state.player,
      inventory: [...initial.state.player.inventory, { itemId: 'logs', quantity: 4 }] } })
    const session = createPublicV13GreenwaySession(atFoot)
    const built = session.advance([{ type: 'build_route', routeId: 'greenway_ladder',
      siteId: site.id }], { walkRequested: false })
    expect(built.rejections).toEqual([])
    expect(built.events.map((event) => event.type)).toContain('route_built')
    const saved = session.snapshotForSave()
    expect(saved.greenway.builtRouteIds).toContain('greenway_ladder')
    expect(saved.greenway.routes.find((route) => route.id === 'greenway_ladder')?.siteId).toBe(site.id)
    const traversed = session.advance([{ type: 'traverse_route', routeId: 'greenway_ladder' }],
      { walkRequested: false })
    expect(traversed.rejections).toEqual([])
    expect(traversed.events.map((event) => event.type)).toContain('route_used')
    expect(session.snapshotForSave().player.position).toEqual(site.to)
  })
})
