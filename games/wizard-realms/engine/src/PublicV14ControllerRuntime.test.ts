import { describe, expect, it, vi } from 'vitest'
import { createPublicV14ControllerRuntime } from './PublicV14ControllerRuntime'
import { advancePublicV14GreenwayAction } from './domain/publicWorldV14Actions'
import { advancePublicV14BoundaryFrame } from './domain/publicWorldV14Boundary'
import { createPublicV14ContinuousSession } from './domain/publicWorldV14ContinuousSession'
import { resolvePublicV14Surface } from './domain/publicWorldV14Terrain'
import { confirmPublicV14TerrainWork } from './domain/publicWorldV14TerrainWork'
import type { PublicV14Start } from './domain/publicWorldV14Flow'
import { PUBLIC_V11_BOOTS_LISTING_ID } from './domain/publicWorldGait'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import { createFreshPublicV14Head, encodePublicV14Head } from './domain/publicWorldV14Snapshot'
import type { PublicV14Frame } from './domain/publicWorldV14Snapshot'
import { starterCliffSupportAt } from './domain/starterCliffMovement'
import { starterCliffWorldTileAtGrid } from './domain/starterCliffWorld'
import { encodeDiscoveredTileIds } from './domain/discoveryMask'
import { resolveTerrainWorkSite } from './domain/terrainWorks'

const seed = 'greenway-alpha'
const walk = true
const freshStart = (): PublicV14Start => {
  const { head, lineage } = createFreshPublicV14Head(seed)
  return { state: head.state, bootstrap: null, saveRevision: 0, lineage }
}
const move = (x: number, z: number): PublicWorldIntent[] => [{ type: 'move', delta: { x, z } }]
function harness(initial = freshStart(), includeWork = false) {
  let server = initial
  const calls: { kind: 'frames' | 'action' | 'work'; revision: number; value: unknown }[] = []
  const workWriter = vi.fn(async (id: string, revision: number,
    lineage: PublicV14Start['lineage']) => {
    calls.push({ kind: 'work' as const, revision, value: id })
    if (revision !== server.saveRevision) return { ok: false as const, reason: 'revision-changed' }
    const result = confirmPublicV14TerrainWork(server.state, id)
    if (!result.candidate || !result.event) return { ok: false as const, reason: 'action-rejected' }
    server = { state: result.candidate, bootstrap: null, saveRevision: revision + 1, lineage }
    return { ok: true as const, value: { start: server, event: result.event } }
  })
  const writers: Parameters<typeof createPublicV14ControllerRuntime>[1] = {
    frames: vi.fn(async (frames, revision, lineage) => {
      calls.push({ kind: 'frames', revision, value: structuredClone(frames) })
      if (revision !== server.saveRevision) return { ok: false as const, reason: 'revision-changed' }
      const replay = createPublicV14ContinuousSession(server)
      const events = []
      for (const frame of frames) {
        const result = replay.advanceFrame(frame.intents, { walkRequested: frame.walkRequested })
        if (result.rejections.length) return { ok: false as const, reason: 'frame-rejected' }
        events.push(...result.events)
      }
      const readiness = replay.snapshotForSave()
      if (readiness.status === 'deferred-airborne') return { ok: false as const, reason: 'frame-rejected' }
      server = { state: readiness.state, bootstrap: null,
        saveRevision: revision + 1, lineage }
      return { ok: true as const, value: { start: server, events } }
    }),
    action: vi.fn(async (intent, revision, lineage) => {
      calls.push({ kind: 'action', revision, value: structuredClone(intent) })
      if (revision !== server.saveRevision) return { ok: false as const, reason: 'revision-changed' }
      const result = advancePublicV14GreenwayAction(server.state, intent)
      if (result.rejections.length) return { ok: false as const, reason: 'action-rejected' }
      server = { state: result.state, bootstrap: null,
        saveRevision: revision + 1, lineage }
      return { ok: true as const, value: { start: server, events: result.events } }
    }),
    ...(includeWork ? { work: workWriter } : {}),
  }
  return { runtime: createPublicV14ControllerRuntime(initial, writers), writers, calls,
    workWriter, server: () => server }
}
const bridgeId = 'works1:bridge:-102:92:z'
function workStart(): PublicV14Start {
  const fresh = freshStart(), site = resolveTerrainWorkSite(seed, bridgeId)
  if (!site || site.kind !== 'bridge') throw new Error('Missing bridge fixture')
  const point = site.from
  const surface = resolvePublicV14Surface(fresh.state, point)!
  const mask = new Uint8Array(fresh.state.discoveryMask)
  const bits = encodeDiscoveredTileIds([...new Set([surface.tileId,
    site.footprintTileIds[1]])].sort())
  for (let index = 0; index < mask.length; index++) mask[index] |= bits[index]
  const state = { ...fresh.state, tick: 1, movementOwner: 'streamed' as const,
    discoveryMask: mask,
    player: { ...fresh.state.player, position: { ...point, y: surface.floorY },
      inventory: [...fresh.state.player.inventory, { itemId: 'logs' as const, quantity: 12 }] } }
  return { state: encodePublicV14Head(state, 1, fresh.lineage).state,
    bootstrap: null, saveRevision: 1, lineage: fresh.lineage }
}
function edgeStart(): PublicV14Start {
  const fresh = freshStart(), base = fresh.state
  for (let z = -28; z <= 32; z += 4) {
    const point = { x: -30, z }
    const floor = starterCliffSupportAt({ seed, profile: base.generationProfile,
      route: base.greenway.routes[0], built: false }, point)!.floorY
    const tile = starterCliffWorldTileAtGrid(seed, Math.ceil(point.x / 4 - 0.5),
      Math.ceil(point.z / 4 - 0.5))
    const mask = new Uint8Array(base.discoveryMask)
    const bit = encodeDiscoveredTileIds([tile.id])
    for (let index = 0; index < mask.length; index++) mask[index] |= bit[index]
    const state = { ...base, tick: 1, discoveryMask: mask,
      player: { ...base.player, position: { ...point, y: floor } } }
    if (advancePublicV14BoundaryFrame(state, move(-0.16, 0), { walkRequested: walk }).candidate) {
      return { state: encodePublicV14Head(state, 1, fresh.lineage).state,
        bootstrap: null, saveRevision: 1, lineage: fresh.lineage }
    }
  }
  throw new Error('No dry edge fixture')
}

describe('unmounted v14 controller runtime', () => {
  it('records exact accepted 50 ms frames, recommends checkpoint at 64, and rebases after CAS', async () => {
    const { runtime, writers, calls } = harness()
    expect(runtime.advanceFrame(move(0.24, 0), false).rejections[0]?.code).toBe('invalid_value')
    expect(runtime.status().pendingFrames).toBe(0)
    const first: PublicV14Frame = { intents: [{ type: 'look', yawDelta: 0.1, pitchDelta: 0 },
      { type: 'move', delta: { x: 0.16, z: 0 } }], walkRequested: walk }
    expect(runtime.advanceFrame(first.intents, first.walkRequested).rejections).toEqual([])
    expect(runtime.advanceFrame(move(0.16, 0), walk).rejections).toEqual([])
    for (let index = 0; index < 62; index++) {
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 64,
      checkpointRecommended: true, saveRevision: 0 })
    expect(writers.frames).not.toHaveBeenCalled()
    const outcome = await runtime.save()
    expect(outcome.status).toBe('saved')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ kind: 'frames', revision: 0 })
    expect((calls[0].value as PublicV14Frame[])[0]).toEqual(first)
    expect((calls[0].value as PublicV14Frame[])[1]).toEqual({ intents: move(0.16, 0),
      walkRequested: true })
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0,
      checkpointRecommended: false, saveRevision: 1 })
    expect(runtime.preview().tick).toBe(64)
    expect(await runtime.save()).toEqual({ status: 'unchanged' })
  })

  it('saves a Greenway-to-streamed boundary and resumes the receiving authority', async () => {
    const { runtime, calls } = harness(edgeStart())
    expect(runtime.advanceFrame(move(-0.16, 0), walk).rejections).toEqual([])
    expect(runtime.view()).toMatchObject({ movementOwner: 'streamed', pendingBoundary: true })
    expect((await runtime.save()).status).toBe('saved')
    expect(calls[0].value).toEqual([{ intents: move(-0.16, 0), walkRequested: true }])
    expect(runtime.status()).toMatchObject({ saveRevision: 2, pendingFrames: 0 })
    expect(runtime.view()).toMatchObject({ movementOwner: 'streamed', pendingBoundary: false })
    expect(runtime.advanceFrame(move(0.16, 0), walk).rejections).toEqual([])
    expect(runtime.view().movementOwner).toBe('greenway')
  })

  it('flushes an outbound frame but never routes a streamed action to D1', async () => {
    const { runtime, writers, calls } = harness(edgeStart())
    expect(runtime.advanceFrame(move(-0.16, 0), walk).rejections).toEqual([])
    expect(await runtime.action({ type: 'equip_item', itemId: 'woodcutters_axe',
      slot: 'mainHand' })).toEqual({ status: 'rejected', reason: 'unavailable_here' })
    expect(calls.map((call) => call.kind)).toEqual(['frames'])
    expect(writers.action).not.toHaveBeenCalled()
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0,
      saveRevision: 2 })
  })

  it('flushes all pending frames before an action, then rebases from its CAS', async () => {
    const { runtime, calls } = harness()
    runtime.advanceFrame([], false)
    runtime.advanceFrame([], false)
    const intent: PublicWorldIntent = { type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' }
    const outcome = await runtime.action(intent)
    expect(outcome).toMatchObject({ status: 'saved', resetWalkRequested: false })
    expect(calls.map((call) => [call.kind, call.revision])).toEqual([
      ['frames', 0], ['action', 1]])
    expect(calls[0].value).toEqual(Array(2).fill({ intents: [], walkRequested: false }))
    expect(runtime.status()).toMatchObject({ saveRevision: 2, pendingFrames: 0, gate: 'open' })
    expect(runtime.preview().tick).toBe(3)
    expect(runtime.preview().player.equipment.mainHand).toBe('woodcutters_axe')
  })

  it('defers an airborne save and action without calling a writer, then saves landing', async () => {
    const { runtime, writers } = harness()
    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    expect(await runtime.save()).toEqual({ status: 'deferred-airborne' })
    expect(await runtime.action({ type: 'equip_item', itemId: 'woodcutters_axe',
      slot: 'mainHand' })).toEqual({ status: 'deferred-airborne' })
    expect(writers.frames).not.toHaveBeenCalled()
    expect(writers.action).not.toHaveBeenCalled()
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 1 })
    for (let index = 0; index < 30 && runtime.view().player.verticalVelocity !== 0; index++) {
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(runtime.view().player.verticalVelocity).toBe(0)
    expect((await runtime.save()).status).toBe('saved')
  })

  it('enforces a 128-frame cap and reserves landing frames before a late jump', async () => {
    const { runtime } = harness()
    for (let index = 0; index < 97; index++) {
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections[0]?.code)
      .toBe('unavailable_here')
    expect(runtime.advanceFrame(move(0.16, 0), true).rejections[0]?.code)
      .toBe('unavailable_here')
    expect(runtime.status().pendingFrames).toBe(97)
    for (let index = 97; index < 128; index++) runtime.advanceFrame([], false)
    expect(runtime.status()).toMatchObject({ gate: 'cap-paused', pendingFrames: 128,
      checkpointRequired: true })
    expect(runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
    expect((await runtime.save()).status).toBe('saved')
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0 })
    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
  })

  it('freezes a stale writer while retaining the unsaved preview and transcript', async () => {
    const { runtime, writers } = harness()
    runtime.advanceFrame(move(0.16, 0), true)
    const before = runtime.preview()
    let rejectStale = () => {}
    vi.mocked(writers.frames).mockImplementationOnce(() => new Promise((resolve) => {
      rejectStale = () => resolve({ ok: false, reason: 'revision-changed' })
    }))
    const saving = runtime.save()
    expect(runtime.status().gate).toBe('barrier')
    expect(runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
    rejectStale()
    expect(await saving).toEqual({ status: 'blocked', reason: 'revision-changed' })
    expect(runtime.status()).toMatchObject({ gate: 'blocked', blockedReason: 'revision-changed',
      pendingFrames: 1 })
    expect(runtime.preview()).toEqual(before)
    expect(runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
    expect(writers.action).not.toHaveBeenCalled()
  })

  it('reopens after a recoverable D1 action rejection', async () => {
    const { runtime, writers } = harness()
    vi.mocked(writers.action).mockResolvedValueOnce({ ok: false, reason: 'action-rejected' })
    expect(await runtime.action({ type: 'build_route', routeId: 'greenway_ladder',
      siteId: 'greenway_ladder:x:0' })).toEqual({ status: 'rejected', reason: 'action-rejected' })
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0 })
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
  })

  it('freezes a stale D1 action after a successful frame checkpoint', async () => {
    const { runtime, writers, calls } = harness()
    runtime.advanceFrame([], false)
    vi.mocked(writers.action).mockResolvedValueOnce({ ok: false, reason: 'revision-changed' })
    expect(await runtime.action({ type: 'equip_item', itemId: 'woodcutters_axe',
      slot: 'mainHand' })).toEqual({ status: 'blocked', reason: 'revision-changed' })
    expect(calls.map((call) => call.kind)).toEqual(['frames'])
    expect(runtime.status()).toMatchObject({ gate: 'blocked', pendingFrames: 0,
      saveRevision: 1, blockedReason: 'revision-changed' })
    expect(runtime.preview().tick).toBe(1)
    expect(runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
  })

  it('signals walk-toggle reset for a checked boots equip event', async () => {
    const fresh = freshStart(), store = fresh.state.greenway.stores[0]
    const point = store.position
    const floor = starterCliffSupportAt({ seed, profile: fresh.state.generationProfile,
      route: fresh.state.greenway.routes[0], built: false }, point)!.floorY
    const tile = starterCliffWorldTileAtGrid(seed, Math.ceil(point.x / 4 - 0.5),
      Math.ceil(point.z / 4 - 0.5))
    const mask = new Uint8Array(fresh.state.discoveryMask)
    const bit = encodeDiscoveredTileIds([tile.id])
    for (let index = 0; index < mask.length; index++) mask[index] |= bit[index]
    const state = { ...fresh.state, tick: 1, discoveryMask: mask,
      player: { ...fresh.state.player, position: { x: point.x, y: floor, z: point.z } } }
    const initial: PublicV14Start = { ...fresh, saveRevision: 1,
      state: encodePublicV14Head(state, 1, fresh.lineage).state }
    const { runtime } = harness(initial)
    const bought = await runtime.action({ type: 'buy_store_listing', storeId: store.id,
      listingId: PUBLIC_V11_BOOTS_LISTING_ID })
    expect(bought.status).toBe('saved')
    const equipped = await runtime.action({ type: 'equip_item', itemId: 'leather_boots', slot: 'feet' })
    expect(equipped).toMatchObject({ status: 'saved', resetWalkRequested: true })
    expect(runtime.view().player.equipment.feet).toBe('leather_boots')
    expect(runtime.advanceFrame(move(0.24, 0), false).rejections).toEqual([])
  })

  it('checkpoints streamed frames before a checked work CAS and rebases its event', async () => {
    const { runtime, calls } = harness(workStart(), true)
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(runtime.advanceFrame([], true).rejections).toEqual([])
    const result = await runtime.buildWork(bridgeId)
    expect(result).toMatchObject({ status: 'saved', events: [], resetWalkRequested: false,
      workEvent: { type: 'terrain_work_built', id: bridgeId, logsSpent: 8, xp: 80 } })
    expect(calls.map((call) => [call.kind, call.revision])).toEqual([
      ['frames', 1], ['work', 2]])
    expect(calls[1].value).toBe(bridgeId)
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0, saveRevision: 3 })
    expect(runtime.preview().terrainWorks.builtWorkIds).toEqual([bridgeId])
    expect(runtime.preview().tick).toBe(3)
  })

  it('defers streamed work while airborne without invoking either writer', async () => {
    const { runtime, writers, workWriter } = harness(workStart(), true)
    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    expect(await runtime.buildWork(bridgeId)).toEqual({ status: 'deferred-airborne' })
    expect(writers.frames).not.toHaveBeenCalled()
    expect(workWriter).not.toHaveBeenCalled()
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 1 })
    for (let index = 0; index < 30 && runtime.view().player.verticalVelocity !== 0; index++) {
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(runtime.view().player.verticalVelocity).toBe(0)
    expect((await runtime.buildWork(bridgeId)).status).toBe('saved')
  })

  it('keeps work unavailable in Greenway and when the optional writer is absent', async () => {
    const greenway = harness()
    greenway.runtime.advanceFrame([], false)
    expect(await greenway.runtime.buildWork(bridgeId)).toEqual({ status: 'rejected',
      reason: 'unavailable_here' })
    expect(greenway.calls.map((call) => call.kind)).toEqual(['frames'])
    const streamed = harness(workStart())
    expect(await streamed.runtime.buildWork(bridgeId)).toEqual({ status: 'rejected',
      reason: 'unavailable_here' })
    expect(streamed.runtime.status().gate).toBe('open')
  })

  it('reopens for expected work rejection but freezes on stale work CAS', async () => {
    const rejected = harness(workStart(), true)
    rejected.workWriter.mockResolvedValueOnce({ ok: false, reason: 'action-rejected' })
    expect(await rejected.runtime.buildWork(bridgeId)).toEqual({ status: 'rejected',
      reason: 'action-rejected' })
    expect(rejected.runtime.status().gate).toBe('open')
    const stale = harness(workStart(), true)
    stale.runtime.advanceFrame([], false)
    stale.workWriter.mockResolvedValueOnce({ ok: false, reason: 'revision-changed' })
    expect(await stale.runtime.buildWork(bridgeId)).toEqual({ status: 'blocked',
      reason: 'revision-changed' })
    expect(stale.calls.map((call) => call.kind)).toEqual(['frames'])
    expect(stale.runtime.status()).toMatchObject({ gate: 'blocked', pendingFrames: 0,
      saveRevision: 2, blockedReason: 'revision-changed' })
    expect(stale.runtime.preview().tick).toBe(2)
    expect(stale.runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
  })

  it('retains the unsaved transcript if the pre-work checkpoint loses CAS', async () => {
    const { runtime, writers, workWriter } = harness(workStart(), true)
    runtime.advanceFrame([], false)
    const preview = runtime.preview()
    vi.mocked(writers.frames).mockResolvedValueOnce({ ok: false, reason: 'revision-changed' })
    expect(await runtime.buildWork(bridgeId)).toEqual({ status: 'blocked',
      reason: 'revision-changed' })
    expect(workWriter).not.toHaveBeenCalled()
    expect(runtime.status()).toMatchObject({ gate: 'blocked', pendingFrames: 1,
      saveRevision: 1 })
    expect(runtime.preview()).toEqual(preview)
  })
})
