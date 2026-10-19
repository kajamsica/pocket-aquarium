import { IDBFactory as FakeFactory } from 'fake-indexeddb'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { publicV14ActionForView, publicV14CheckpointDue, publicV14CheckpointWithWorkMode,
  publicV14IdleWorksSampler, publicV14MovementIntents,
  publicV14WorkIntentStillReady, PublicV14Controller } from './PublicV14Controller'
import { createPublicV14ControllerRuntime } from './PublicV14ControllerRuntime'
import { publicWorldV14ViewProjection } from './PublicV14WorldView'
import { createAtomicV14Store } from './domain/atomicV14Database'
import { createPublicV14ContinuousSession } from './domain/publicWorldV14ContinuousSession'
import { encodeDiscoveredTileIds } from './domain/discoveryMask'
import { PUBLIC_V11_BOOTS_LISTING_ID } from './domain/publicWorldGait'
import { createFreshPublicV14Head, encodePublicV14Head } from './domain/publicWorldV14Snapshot'
import { commitPublicV14FrameBatch, inspectPublicV14, startFreshPublicV14 } from './domain/publicWorldV14Flow'
import { resolvePublicV14Surface } from './domain/publicWorldV14Terrain'
import { STARTER_CLIFF_SITE_ID } from './domain/starterCliffProfile'
import { resolveTerrainWorkSite } from './domain/terrainWorks'
import { createTimedMovementSampler, recordTimedMovement, sampleTimedMovement } from './view/timedInput'

const fresh = () => {
  const { head, lineage } = createFreshPublicV14Head('greenway-alpha')
  return { state: head.state, bootstrap: null, saveRevision: 0, lineage }
}
const projection = () => {
  const session = createPublicV14ContinuousSession(fresh())
  return publicWorldV14ViewProjection(session.previewSnapshot(), session.view(), [], null)
}
const bridgeId = 'works1:bridge:-102:92:z'
const readyWorkStart = () => {
  const initial = fresh()
  const site = resolveTerrainWorkSite(initial.state.seed, bridgeId)
  if (!site || site.kind !== 'bridge') throw new Error('Missing bridge fixture')
  const point = { x: site.from.x, z: site.from.z + 1.2 }
  const support = resolvePublicV14Surface(initial.state, point)
  if (!support) throw new Error('Missing streamed support')
  const discoveryMask = new Uint8Array(initial.state.discoveryMask)
  const discovered = encodeDiscoveredTileIds([...new Set([
    ...site.footprintTileIds, support.tileId])].sort())
  for (let index = 0; index < discoveryMask.length; index++) discoveryMask[index] |= discovered[index]
  const state = { ...initial.state, movementOwner: 'streamed' as const, tick: 1,
    discoveryMask,
    player: { ...initial.state.player, position: { ...point, y: support.floorY },
      inventory: [...initial.state.player.inventory, { itemId: 'logs' as const, quantity: 12 }] } }
  return { ...initial, saveRevision: 1,
    state: encodePublicV14Head(state, 1, initial.lineage).state }
}

describe('opt-in v14 React controller', () => {
  it('routes only visible Greenway actions through the checked action grammar', () => {
    const view = projection()
    const tree = view.resources.find((resource) => resource.kind === 'tree' && resource.available)!
    const chop = { ...view, nearbyInteraction: { kind: 'resource' as const,
      targetId: tree.id, label: 'Greenway oak', action: 'Chop', actionable: true } }
    expect(publicV14ActionForView({ type: 'interact' }, chop))
      .toEqual({ type: 'harvest', resourceId: tree.id })
    expect(publicV14ActionForView({ type: 'interact' }, { ...chop,
      nearbyInteraction: { ...chop.nearbyInteraction, actionable: false } })).toBeNull()
    expect(publicV14ActionForView({ type: 'equipment.equip',
      stackId: 'inventory-woodcutters_axe', slot: 'mainHand' }, view))
      .toEqual({ type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' })
    expect(publicV14ActionForView({ type: 'equipment.equip',
      stackId: 'inventory-woodcutters_axe', slot: 'feet' }, view)).toBeNull()
    expect(publicV14ActionForView({ type: 'equipment.equip',
      stackId: 'inventory-field_spade', slot: 'mainHand' }, view)).toBeNull()
    expect(publicV14ActionForView({ type: 'equipment.equip',
      stackId: 'inventory-field_spade', slot: 'mainHand' }, { ...view,
      backpack: { ...view.backpack, stacks: [...view.backpack.stacks,
        { id: 'inventory-field_spade', itemId: 'field_spade', name: 'Field spade', quantity: 1 }] } }))
      .toEqual({ type: 'equip_item', itemId: 'field_spade', slot: 'mainHand' })
    const ready = { ...view, selectedBuildSiteId: STARTER_CLIFF_SITE_ID,
      buildSites: view.buildSites.map((site) => ({ ...site, status: 'ready' as const })) }
    expect(publicV14ActionForView({ type: 'build-site.confirm',
      siteId: STARTER_CLIFF_SITE_ID }, ready)).toEqual({ type: 'build_route',
      routeId: 'greenway_ladder', siteId: STARTER_CLIFF_SITE_ID })
    expect(publicV14ActionForView({ type: 'build-site.confirm',
      siteId: STARTER_CLIFF_SITE_ID }, view)).toBeNull()
    expect(publicV14ActionForView({ type: 'build-site.confirm',
      siteId: 'greenway_ladder:x:2' }, ready)).toBeNull()
    expect(publicV14ActionForView({ type: 'build-site.confirm',
      siteId: STARTER_CLIFF_SITE_ID }, { ...ready, buildSites: [] })).toBeNull()
  })

  it('keeps Outfitters and equipment tied to currently visible inventory and listings', () => {
    const view = projection()
    const open = { ...view, openStoreId: 'store-greenway' }
    expect(publicV14ActionForView({ type: 'store.select-listing', storeId: 'store-greenway',
      listingId: PUBLIC_V11_BOOTS_LISTING_ID }, view)).toBeNull()
    expect(publicV14ActionForView({ type: 'store.select-listing', storeId: 'store-greenway',
      listingId: PUBLIC_V11_BOOTS_LISTING_ID }, open)).toEqual({ type: 'buy_store_listing',
      storeId: 'store-greenway', listingId: PUBLIC_V11_BOOTS_LISTING_ID })
    expect(publicV14ActionForView({ type: 'store.select-listing', storeId: 'store-greenway',
      listingId: 'spade' }, open)).toEqual({ type: 'buy_store_listing',
      storeId: 'store-greenway', listingId: 'spade' })
    expect(publicV14ActionForView({ type: 'store.select-listing', storeId: 'store-greenway',
      listingId: 'hidden' }, open)).toBeNull()
    expect(publicV14ActionForView({ type: 'equipment.unequip', slot: 'feet' }, view)).toBeNull()
    const boots = { ...view, equipment: { ...view.equipment,
      feet: { id: 'boots', itemId: 'leather_boots', name: 'Leather boots', quantity: 1 } } }
    expect(publicV14ActionForView({ type: 'equipment.unequip', slot: 'feet' }, boots))
      .toEqual({ type: 'unequip_item', slot: 'feet' })
    const selling = { ...open, stores: open.stores.map((store) => ({ ...store,
      sellOffers: [{ itemId: 'stone', name: 'Stone', quantity: 3, unitPrice: 1 }] })) }
    expect(publicV14ActionForView({ type: 'store.sell-item', storeId: 'store-greenway',
      itemId: 'stone', quantity: 3 }, selling)).toEqual({ type: 'sell_to_store',
      storeId: 'store-greenway', itemId: 'stone', quantity: 3 })
    expect(publicV14ActionForView({ type: 'store.sell-item', storeId: 'store-greenway',
      itemId: 'stone', quantity: 4 }, selling)).toBeNull()
    expect(publicV14ActionForView({ type: 'store.sell-item', storeId: 'store-greenway',
      itemId: 'stone', quantity: 1 }, view)).toBeNull()
    expect(publicV14ActionForView({ type: 'store.select-listing', storeId: 'store-greenway',
      listingId: PUBLIC_V11_BOOTS_LISTING_ID }, { ...open, unavailableActions: true })).toBeNull()
    expect(publicV14ActionForView({ type: 'interact' }, { ...view,
      controllerActionsEnabled: false })).toBeNull()
    expect(publicV14ActionForView({ type: 'saved-work.confirm', id: 'works1:hidden' }, view)).toBeNull()
  })

  it('confirms only the live ready aimed Works ID, not a stale turn or dormant preview', () => {
    const session = createPublicV14ContinuousSession(readyWorkStart())
    const show = (modeActive: boolean, actionsEnabled = true) =>
      publicWorldV14ViewProjection(session.previewSnapshot(), session.view(), [], null,
        null, false, { kind: 'bridge', bodyYaw: session.view().player.yaw,
          modeActive, actionsEnabled })
    const dormant = show(false)
    expect(dormant.savedTerrainWorks).toMatchObject({ modeActive: false,
      selectedKind: 'bridge', actionsEnabled: true, preview: null })
    expect(publicV14WorkIntentStillReady(dormant, bridgeId)).toBe(false)
    const aimed = show(true)
    expect(aimed.savedTerrainWorks?.preview?.selected).toMatchObject({
      site: { id: bridgeId }, rejection: null })
    expect(publicV14WorkIntentStillReady(aimed, bridgeId)).toBe(true)
    expect(publicV14WorkIntentStillReady(aimed, 'works1:bridge:other')).toBe(false)
    expect(publicV14WorkIntentStillReady(show(true, false), bridgeId)).toBe(false)
    expect(session.advanceFrame([{ type: 'look', yawDelta: Math.PI, pitchDelta: 0 }],
      { walkRequested: false }).rejections).toEqual([])
    expect(publicV14WorkIntentStillReady(show(true), bridgeId)).toBe(false)
  })

  it('keeps Works open after an idle 64-frame checkpoint on the healthy streamed owner', async () => {
    const start = readyWorkStart()
    let runtime: ReturnType<typeof createPublicV14ControllerRuntime>
    runtime = createPublicV14ControllerRuntime(start, {
      frames: vi.fn(async () => ({ ok: true as const, value: { start: {
        ...start, saveRevision: 2, state: runtime.preview() }, events: [] } })),
      action: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })),
    })
    const workMode = { current: true }
    for (let index = 0; index < 64; index++) {
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(publicV14CheckpointDue(runtime.status(), false)).toBe(true)
    expect((await publicV14CheckpointWithWorkMode(runtime, workMode)).status).toBe('saved')
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0 })
    expect(workMode.current).toBe(true)
    const view = publicWorldV14ViewProjection(runtime.preview(), runtime.view(), [], null,
      null, false, { kind: 'bridge', bodyYaw: runtime.view().player.yaw,
        modeActive: workMode.current, actionsEnabled: true })
    expect(view.savedTerrainWorks?.preview?.selected).toMatchObject({ site: { id: bridgeId },
      rejection: null })
  })

  it('closes Works after a blocked checkpoint or when the current owner is Greenway', async () => {
    const blocked = createPublicV14ControllerRuntime(readyWorkStart(), {
      frames: vi.fn(async () => ({ ok: false as const, reason: 'revision-changed' })),
      action: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })),
    })
    blocked.advanceFrame([], false)
    const blockedMode = { current: true }
    expect((await publicV14CheckpointWithWorkMode(blocked, blockedMode)).status).toBe('blocked')
    expect(blockedMode.current).toBe(false)
    const greenwayStart = fresh()
    let greenway: ReturnType<typeof createPublicV14ControllerRuntime>
    greenway = createPublicV14ControllerRuntime(greenwayStart, {
      frames: vi.fn(async () => ({ ok: true as const, value: { start: {
        ...greenwayStart, saveRevision: 1, state: greenway.preview() }, events: [] } })),
      action: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })),
    })
    greenway.advanceFrame([], false)
    const staleMode = { current: true }
    expect((await publicV14CheckpointWithWorkMode(greenway, staleMode)).status).toBe('saved')
    expect(staleMode.current).toBe(false)
  })

  it('does not record idle Works frames or catch up, but preserves queued movement and jump', () => {
    const runtime = createPublicV14ControllerRuntime(readyWorkStart(), {
      frames: vi.fn(async () => ({ ok: false as const, reason: 'revision-changed' })),
      action: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })),
    })
    let sampler = createTimedMovementSampler(0)
    let lastStep = 0
    const input = (held: readonly [number, number] = [0, 0],
      tap: readonly [number, number] | null = null, jump = false) => ({
      held, tap, jump, sampler })
    for (let now = 50; now <= 3_500; now += 50) {
      const paused = publicV14IdleWorksSampler(runtime.view(), true, input(), now)
      expect(paused).not.toBeNull()
      sampler = paused!
      lastStep = now
    }
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0 })
    expect(sampler.cursorMs).toBe(3_500)
    expect(Math.floor((3_500 - lastStep) / 50)).toBe(0)
    recordTimedMovement(sampler, 3_505, [0, 1])
    recordTimedMovement(sampler, 3_520, [0, 0])
    expect(publicV14IdleWorksSampler(runtime.view(), true, input(), 3_550)).toBeNull()
    expect(sampleTimedMovement(sampler, 3_550)[1]).toBeGreaterThan(0)
    expect(publicV14IdleWorksSampler(runtime.view(), true, input([0, 1]), 3_600)).toBeNull()
    expect(publicV14IdleWorksSampler(runtime.view(), true, input([0, 0], [0, 1]), 3_600)).toBeNull()
    expect(publicV14IdleWorksSampler(runtime.view(), true, input([0, 0], null, true), 3_600)).toBeNull()
    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    expect(publicV14IdleWorksSampler(runtime.view(), true, input(), 3_600)).toBeNull()
    expect(publicV14IdleWorksSampler({ ...runtime.view(), pendingBoundary: true },
      true, input(), 3_600)).toBeNull()
    expect(publicV14IdleWorksSampler(runtime.view(), false, input(), 3_600)).toBeNull()
  })

  it('checkpoints one pending streamed frame before idle Works pauses, then stays idle', async () => {
    const locks = { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
      callback: () => T | Promise<T>) => callback() }
    const store = createAtomicV14Store(new FakeFactory())
    const created = await startFreshPublicV14(locks, store, 'greenway-alpha')
    if (!created.ok) throw new Error('Could not create v14 fixture')
    const move = (x: number) => ({ intents: [{ type: 'move' as const, delta: { x, z: 0 } }],
      walkRequested: true })
    const first = await commitPublicV14FrameBatch(locks, store,
      Array(128).fill(move(0.16)), 0, created.value.lineage)
    if (!first.ok) throw new Error(`Could not reach streamed boundary: ${first.reason}`)
    const second = await commitPublicV14FrameBatch(locks, store,
      [...Array(84).fill(move(0.16)), move(0.08), move(0.16)], 1, created.value.lineage)
    if (!second.ok) throw new Error(`Could not enter streamed owner: ${second.reason}`)
    const runtime = createPublicV14ControllerRuntime(second.value.start, {
      frames: (frames, revision, lineage) => commitPublicV14FrameBatch(locks, store,
        frames, revision, lineage),
      action: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })),
    })
    expect(runtime.view().movementOwner).toBe('streamed')
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 1, saveRevision: 2 })
    const sampler = createTimedMovementSampler(0)
    expect(publicV14IdleWorksSampler(runtime.view(), true,
      { held: [0, 0], tap: null, jump: false, sampler }, 50)).not.toBeNull()
    expect(publicV14CheckpointDue(runtime.status(), false)).toBe(false)
    expect(publicV14CheckpointDue(runtime.status(), false, true)).toBe(true)
    const workMode = { current: true }
    expect((await publicV14CheckpointWithWorkMode(runtime, workMode)).status).toBe('saved')
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0, saveRevision: 3 })
    expect(workMode.current).toBe(true)
    expect((await inspectPublicV14(locks, store))).toMatchObject({ ok: true,
      value: { status: 'valid', start: { saveRevision: 3, state: { tick: runtime.view().tick } } } })
    expect(publicV14CheckpointDue(runtime.status(), false, true)).toBe(false)
  }, 60_000)

  it('samples character pivots and forward movement without coupling camera drag to body yaw', () => {
    expect(publicV14MovementIntents(0, [1, 0], 0.16)).toEqual([
      { type: 'look', yawDelta: -0.13, pitchDelta: 0 }])
    expect(publicV14MovementIntents(0, [0, 1], 0.16)).toEqual([
      { type: 'move', delta: { x: -0, z: -0.16 } }])
    expect(publicV14MovementIntents(0, [0, -1], 0.16)).toEqual([
      { type: 'move', delta: { x: 0, z: 0.16 } }])
    expect(publicV14MovementIntents(0, [0, 0], 0.16)).toEqual([])
  })

  it('signals boundary or 64-frame checkpoints, defers airborne writes, and freezes on failure', async () => {
    const writes = { frames: vi.fn(async () => ({ ok: false as const, reason: 'revision-changed' })),
      action: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })) }
    const runtime = createPublicV14ControllerRuntime(fresh(), writes)
    expect(publicV14CheckpointDue(runtime.status(), runtime.view().pendingBoundary)).toBe(false)
    runtime.advanceFrame([{ type: 'jump' }], false)
    expect(publicV14CheckpointDue(runtime.status(), true)).toBe(true)
    expect(await runtime.save()).toEqual({ status: 'deferred-airborne' })
    expect(writes.frames).not.toHaveBeenCalled()
    for (let index = 0; index < 30 && runtime.view().player.verticalVelocity !== 0; index++) {
      runtime.advanceFrame([], false)
    }
    expect(runtime.view().player.verticalVelocity).toBe(0)
    expect((await runtime.save()).status).toBe('blocked')
    expect(publicV14CheckpointDue(runtime.status(), true)).toBe(false)
    expect(runtime.status()).toMatchObject({ gate: 'blocked', blockedReason: 'revision-changed' })
    const second = createPublicV14ControllerRuntime(fresh(), writes)
    for (let index = 0; index < 64; index++) second.advanceFrame([], false)
    expect(publicV14CheckpointDue(second.status(), false)).toBe(true)
  })

  it('requests a legal checkpoint at the 128-frame cap while movement stays paused', async () => {
    const start = fresh()
    let runtime: ReturnType<typeof createPublicV14ControllerRuntime>
    const writes = { frames: vi.fn(async () => ({ ok: true as const, value: {
      start: { ...start, saveRevision: 1, state: runtime.preview() }, events: [] } })),
      action: vi.fn(async () => ({ ok: false as const, reason: 'action-rejected' })) }
    runtime = createPublicV14ControllerRuntime(start, writes)
    for (let index = 0; index < 128; index++) {
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(runtime.status()).toMatchObject({ gate: 'cap-paused', pendingFrames: 128 })
    expect(runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
    expect(publicV14CheckpointDue(runtime.status(), runtime.view().pendingBoundary)).toBe(true)
    expect((await runtime.save()).status).toBe('saved')
    expect(writes.frames).toHaveBeenCalledOnce()
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0 })
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
  })

  it('renders the initial truthful starter-cliff surface without mounting entry or a browser', () => {
    const markup = renderToStaticMarkup(createElement(PublicV14Controller, {
      start: fresh(), locks: { request: async <T,>(_name: string, _options: { mode: 'exclusive' },
        callback: () => T | Promise<T>) => callback() },
      store: createAtomicV14Store(new FakeFactory()),
    }))
    expect(markup).toContain('data-public-v14="true"')
    expect(markup).toContain('data-owner="greenway"')
    expect(markup).toContain('route build site')
    expect(markup).toContain('W/S move')
    expect(markup).toContain('hold and drag to orbit')
    expect(markup).not.toContain('greenway_ladder:x:2')
    expect(markup).not.toContain('Saved work controls appear in Works when ready')
  })
})
