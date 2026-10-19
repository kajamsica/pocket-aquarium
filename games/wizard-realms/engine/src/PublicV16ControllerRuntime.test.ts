import { describe, expect, it, vi } from 'vitest'
import { createPublicV16ControllerRuntime } from './PublicV16ControllerRuntime'
import type { PublicV16ControllerWriters } from './PublicV16ControllerRuntime'
import { encodeDiscoveredTileIds } from './domain/discoveryMask'
import { createPublicV16ContinuousSession } from './domain/publicWorldV16ContinuousSession'
import { advancePublicV16GreenwayAction } from './domain/publicWorldV16GreenwayFrame'
import type { PublicV16Start } from './domain/publicWorldV16Flow'
import { confirmPublicV16GreenwayWork } from './domain/publicWorldV16GreenwayWork'
import { resolvePublicV16GreenwaySite } from './domain/publicWorldV16GreenwaySites'
import { createFreshPublicV16Head } from './domain/publicWorldV16Snapshot'
import { publicV16StarterSupportAt } from './domain/publicWorldV16StarterMovement'
import { confirmPublicV14TerrainWork } from './domain/publicWorldV14TerrainWork'
import { resolvePublicV14Surface } from './domain/publicWorldV14Terrain'
import { resolveTerrainWorkSite } from './domain/terrainWorks'

const seed = 'wizard-realms'
function fresh(worldSeed = seed): PublicV16Start {
  const { head, lineage } = createFreshPublicV16Head(worldSeed)
  return { state: head.state, greenwayWorks: head.greenwayWorks,
    bootstrap: null, saveRevision: 0, lineage }
}
function bridgeStart(): PublicV16Start {
  const start = fresh(), site = resolvePublicV16GreenwaySite(seed, 'works3:bridge:1')!
  if (site.kind !== 'bridge') throw new Error('Missing bridge fixture')
  const x = site.from.x, z = site.from.z - 0.6
  const y = publicV16StarterSupportAt({ seed, profile: start.state.generationProfile,
    route: null, built: false, greenwayWorks: start.greenwayWorks }, { x, z })!.floorY
  const mask = new Uint8Array(start.state.discoveryMask)
  const bits = encodeDiscoveredTileIds(site.footprintTileIds)
  for (let i = 0; i < mask.length; i++) mask[i] |= bits[i]
  return { ...start, saveRevision: 1, state: { ...start.state,
    discoveryMask: mask, player: {
      ...start.state.player, position: { x, y, z }, inventory: [
        ...start.state.player.inventory, { itemId: 'logs', quantity: 8 }] } } }
}
function streamedStart(): PublicV16Start {
  const start = fresh('greenway-alpha'), id = 'works1:bridge:-102:92:z'
  const site = resolveTerrainWorkSite(start.state.seed, id)!
  if (site.kind !== 'bridge') throw new Error('Missing streamed bridge fixture')
  const floor = resolvePublicV14Surface(start.state, site.from)!
  const mask = new Uint8Array(start.state.discoveryMask)
  const bits = encodeDiscoveredTileIds(site.footprintTileIds)
  for (let i = 0; i < mask.length; i++) mask[i] |= bits[i]
  return { ...start, saveRevision: 1, state: { ...start.state, movementOwner: 'streamed',
    discoveryMask: mask, player: {
      ...start.state.player, position: { ...site.from, y: floor.floorY }, inventory: [
        ...start.state.player.inventory, { itemId: 'logs', quantity: 8 }] } } }
}
function harness(initial = fresh()) {
  let server = initial
  const calls: [string, number][] = []
  const writers: PublicV16ControllerWriters = {
    frames: vi.fn(async (frames, revision, lineage) => {
      calls.push(['frames', revision])
      if (revision !== server.saveRevision) return { ok: false as const, reason: 'revision-changed' }
      const replay = createPublicV16ContinuousSession(server), events = []
      for (const frame of frames) {
        const result = replay.advanceFrame(frame.intents, { walkRequested: frame.walkRequested })
        if (result.rejections.length) return { ok: false as const, reason: 'frame-rejected' }
        events.push(...result.events)
      }
      const snapshot = replay.snapshotForSave()
      if (snapshot.status === 'deferred-airborne') return { ok: false as const, reason: 'frame-rejected' }
      server = { ...snapshot.progress, bootstrap: null, saveRevision: revision + 1, lineage }
      return { ok: true as const, value: { start: server, events } }
    }),
    action: vi.fn(async (intent, revision, lineage) => {
      calls.push(['action', revision])
      const next = advancePublicV16GreenwayAction({ state: server.state,
        greenwayWorks: server.greenwayWorks }, intent)
      if (next.rejections.length) return { ok: false as const, reason: 'action-rejected' }
      server = { ...next.progress, bootstrap: null, saveRevision: revision + 1, lineage }
      return { ok: true as const, value: { start: server, events: next.events } }
    }),
    greenwayWork: vi.fn(async (id, revision, lineage) => {
      calls.push(['greenwayWork', revision])
      const next = confirmPublicV16GreenwayWork({ state: server.state,
        greenwayWorks: server.greenwayWorks }, id)
      if (!next.progress) return { ok: false as const, reason: next.rejection }
      server = { ...next.progress, bootstrap: null, saveRevision: revision + 1, lineage }
      return { ok: true as const, value: { start: server, event: next.event } }
    }),
    work: vi.fn(async (id, revision, lineage) => {
      calls.push(['work', revision])
      const next = confirmPublicV14TerrainWork(server.state, id)
      if (!next.candidate) return { ok: false as const, reason: next.rejection }
      server = { ...server, state: next.candidate, saveRevision: revision + 1, lineage }
      return { ok: true as const, value: { start: server, event: next.event } }
    }),
  }
  return { runtime: createPublicV16ControllerRuntime(initial, writers), writers, calls }
}

describe('native v16 controller save barrier', () => {
  it('bounds frame witnesses, reserves landing frames, and rebases after a checked checkpoint', async () => {
    const { runtime, calls } = harness()
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.24, z: 0 } }], false)
      .rejections[0]?.code).toBe('invalid_value')
    for (let i = 0; i < 97; i++) expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.16, z: 0 } }], true)
      .rejections[0]?.code).toBe('unavailable_here')
    for (let i = 97; i < 128; i++) runtime.advanceFrame([], false)
    expect(runtime.status()).toMatchObject({ gate: 'cap-paused', pendingFrames: 128,
      checkpointRecommended: true, checkpointRequired: true })
    expect((await runtime.save()).status).toBe('saved')
    expect(calls).toEqual([['frames', 0]])
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0, saveRevision: 1 })
  })

  it('flushes before a distinct works3 commit, preserves its kind, and rejects hidden sites', async () => {
    const { runtime, calls, writers } = harness(bridgeStart())
    runtime.advanceFrame([], false)
    const result = await runtime.buildGreenwayWork('works3:bridge:1')
    expect(result).toMatchObject({ status: 'saved', workEvent: { kind: 'bridge', logsSpent: 8, xp: 80 } })
    expect(calls).toEqual([['frames', 1], ['greenwayWork', 2]])
    expect(runtime.preview().greenwayWorks.builtBridgeIds).toEqual(['works3:bridge:1'])
    expect(await harness().runtime.buildGreenwayWork('works3:bridge:1'))
      .toMatchObject({ status: 'rejected', reason: 'undiscovered' })
    expect(writers.work).not.toHaveBeenCalled()
  })

  it('uses only the streamed writer outside Greenway', async () => {
    const { runtime, calls, writers } = harness(streamedStart())
    runtime.advanceFrame([], false)
    expect(await runtime.buildWork('works1:bridge:-102:92:z')).toMatchObject({ status: 'saved',
      workEvent: { logsSpent: 8 } })
    expect(calls).toEqual([['frames', 1], ['work', 2]])
    expect(writers.greenwayWork).not.toHaveBeenCalled()
  })

  it('flushes before actions and resets the gait toggle only on feet changes', async () => {
    const start = fresh()
    start.state.player.inventory.push({ itemId: 'leather_boots', quantity: 1 })
    const { runtime, calls } = harness({ ...start, saveRevision: 1 })
    runtime.advanceFrame([], false)
    expect(advancePublicV16GreenwayAction(runtime.preview(), { type: 'equip_item',
      itemId: 'leather_boots', slot: 'feet' }).rejections).toEqual([])
    expect(await runtime.action({ type: 'equip_item', itemId: 'leather_boots', slot: 'feet' }))
      .toMatchObject({ status: 'saved', resetWalkRequested: true })
    expect(calls).toEqual([['frames', 1], ['action', 2]])
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.24, z: 0 } }], false)
      .rejections).toEqual([])
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.24, z: 0 } }], true)
      .rejections[0]?.code).toBe('invalid_value')
  })

  it('blocks when a checked action rejects a locally accepted candidate', async () => {
    const start = fresh()
    start.state.player.inventory.push({ itemId: 'leather_boots', quantity: 1 })
    const { runtime, writers, calls } = harness({ ...start, saveRevision: 1 })
    runtime.advanceFrame([], false)
    const preview = runtime.preview()
    const intent = { type: 'equip_item', itemId: 'leather_boots', slot: 'feet' } as const
    expect(advancePublicV16GreenwayAction(preview, intent).rejections).toEqual([])
    vi.mocked(writers.action).mockResolvedValueOnce({ ok: false, reason: 'action-rejected' })
    expect(await runtime.action(intent)).toEqual({ status: 'blocked', reason: 'action-rejected' })
    expect(calls).toEqual([['frames', 1]])
    expect(writers.action).toHaveBeenCalledOnce()
    expect(runtime.preview()).toEqual(preview)
    expect(runtime.status()).toMatchObject({ gate: 'blocked', saveRevision: 2 })
  })

  it('blocks when a checked work writer rejects a locally accepted candidate', async () => {
    const { runtime, writers, calls } = harness(bridgeStart())
    runtime.advanceFrame([], false)
    const preview = runtime.preview()
    expect(confirmPublicV16GreenwayWork(preview, 'works3:bridge:1').progress).not.toBeNull()
    vi.mocked(writers.greenwayWork).mockResolvedValueOnce({ ok: false,
      reason: 'action-rejected' })
    expect(await runtime.buildGreenwayWork('works3:bridge:1'))
      .toEqual({ status: 'blocked', reason: 'action-rejected' })
    expect(calls).toEqual([['frames', 1]])
    expect(writers.greenwayWork).toHaveBeenCalledOnce()
    expect(runtime.preview()).toEqual(preview)
    expect(runtime.status()).toMatchObject({ gate: 'blocked', saveRevision: 2 })
  })

  it.each(['action', 'work'] as const)(
    'keeps the strict barrier during an in-flight %s writer', async (kind) => {
      const start = kind === 'action' ? fresh() : bridgeStart()
      if (kind === 'action') start.state.player.inventory.push({ itemId: 'leather_boots',
        quantity: 1 })
      const { runtime, writers } = harness({ ...start, saveRevision: 1 })
      runtime.advanceFrame([], false)
      let started!: () => void, release!: () => void
      const writerStarted = new Promise<void>((resolve) => { started = resolve })
      const held = new Promise<void>((resolve) => { release = resolve })
      if (kind === 'action') vi.mocked(writers.action).mockImplementationOnce(async () => {
        started()
        await held
        return { ok: false, reason: 'revision-changed' }
      })
      else vi.mocked(writers.greenwayWork).mockImplementationOnce(async () => {
        started()
        await held
        return { ok: false, reason: 'revision-changed' }
      })
      const writing = kind === 'action'
        ? runtime.action({ type: 'equip_item', itemId: 'leather_boots', slot: 'feet' })
        : runtime.buildGreenwayWork('works3:bridge:1')
      await writerStarted
      expect(runtime.status().gate).toBe('barrier')
      expect(runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
      expect(await runtime.save()).toEqual({ status: 'busy' })
      expect(await runtime.action({ type: 'unequip_item', slot: 'feet' }))
        .toEqual({ status: 'busy' })
      expect(await runtime.buildGreenwayWork('works3:bridge:1')).toEqual({ status: 'busy' })
      expect(writers.action).toHaveBeenCalledTimes(kind === 'action' ? 1 : 0)
      expect(writers.greenwayWork).toHaveBeenCalledTimes(kind === 'work' ? 1 : 0)
      release()
      expect(await writing).toEqual({ status: 'blocked', reason: 'revision-changed' })
    })

  it('freezes on stale or forged success without promoting the local preview', async () => {
    const stale = harness()
    stale.runtime.advanceFrame([], false)
    const before = stale.runtime.preview()
    vi.mocked(stale.writers.frames).mockResolvedValueOnce({ ok: false, reason: 'revision-changed' })
    expect(await stale.runtime.save()).toEqual({ status: 'blocked', reason: 'revision-changed' })
    expect(stale.runtime.preview()).toEqual(before)
    expect(stale.runtime.status().pendingFrames).toBe(1)
    const forged = harness(bridgeStart())
    const current = forged.runtime.preview()
    vi.mocked(forged.writers.greenwayWork).mockResolvedValueOnce({ ok: true, value: {
      start: { ...bridgeStart(), saveRevision: 2 }, event: { type: 'terrain_work_built',
        id: 'works3:bridge:1', tick: current.state.tick,
        sequence: current.state.eventSequence + 1, logsSpent: 8, stoneGained: 0, xp: 80,
        kind: 'bridge' } } })
    expect(await forged.runtime.buildGreenwayWork('works3:bridge:1'))
      .toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(forged.runtime.preview()).toEqual(current)
  })

  it('replays authoritative preview frames after a delayed checked checkpoint', async () => {
    const { runtime, writers } = harness()
    runtime.advanceFrame([], false)
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const writeFrames = writers.frames
    let batchLength = 0
    vi.mocked(writers.frames).mockImplementationOnce(async (frames, revision, lineage) => {
      batchLength = frames.length
      await held
      expect(frames).toHaveLength(1)
      return writeFrames(frames, revision, lineage)
    })
    const save = runtime.save()
    expect(runtime.status().gate).toBe('checkpointing')
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    const preview = runtime.preview()
    expect(batchLength).toBe(1)
    expect(runtime.status().pendingFrames).toBe(3)
    expect(await runtime.action({ type: 'unequip_item', slot: 'feet' })).toEqual({ status: 'busy' })
    expect(await runtime.buildGreenwayWork('works3:bridge:1')).toEqual({ status: 'busy' })
    expect(await runtime.save()).toEqual({ status: 'busy' })
    release()
    expect((await save).status).toBe('saved')
    expect(runtime.preview()).toEqual(preview)
    expect(runtime.status()).toMatchObject({ gate: 'open', saveRevision: 1,
      pendingFrames: 2 })
    expect((await runtime.save()).status).toBe('saved')
    expect(runtime.status()).toMatchObject({ saveRevision: 2, pendingFrames: 0 })
  })

  it('preserves the in-flight preview and tail on checked failure', async () => {
    const { runtime, writers } = harness()
    runtime.advanceFrame([], false)
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(writers.frames).mockImplementationOnce(async () => {
      await held
      return { ok: false, reason: 'revision-changed' }
    })
    const save = runtime.save()
    runtime.advanceFrame([], false)
    const preview = runtime.preview()
    release()
    expect(await save).toEqual({ status: 'blocked', reason: 'revision-changed' })
    expect(runtime.preview()).toEqual(preview)
    expect(runtime.status()).toMatchObject({ gate: 'blocked', pendingFrames: 2,
      saveRevision: 0 })
  })

  it('retains the tail when a delayed writer claims a mismatched success', async () => {
    const { runtime, writers } = harness()
    runtime.advanceFrame([], false)
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(writers.frames).mockImplementationOnce(async (_frames, revision, lineage) => {
      await held
      return { ok: true, value: { start: { ...fresh(), saveRevision: revision + 2,
        lineage }, events: [] } }
    })
    const save = runtime.save()
    runtime.advanceFrame([], false)
    const preview = runtime.preview()
    release()
    expect(await save).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(runtime.preview()).toEqual(preview)
    expect(runtime.status()).toMatchObject({ gate: 'blocked', pendingFrames: 2,
      saveRevision: 0 })
  })

  it('installs only the detached revision validated from an accessor-backed frame response', async () => {
    const { runtime, writers } = harness()
    runtime.advanceFrame([], false)
    vi.mocked(writers.frames).mockImplementationOnce(async (_frames, revision, lineage) => {
      const start = { ...runtime.preview(), bootstrap: null, saveRevision: revision + 1,
        lineage }
      let reads = 0
      Object.defineProperty(start, 'saveRevision', { enumerable: true, get: () =>
        ++reads === 1 ? revision + 1 : revision + 2 })
      return { ok: true, value: { start, events: [] } }
    })
    expect((await runtime.save()).status).toBe('saved')
    expect(runtime.status()).toMatchObject({ gate: 'open', saveRevision: 1,
      pendingFrames: 0 })
  })

  it('keeps the recorded event detached from a caller-mutated frame result', async () => {
    const { runtime } = harness()
    const frame = runtime.advanceFrame([{ type: 'look', yawDelta: 0.1,
      pitchDelta: 0 }], false)
    expect(frame.rejections).toEqual([])
    const returnedEvent = frame.events[0] as unknown as Record<string, unknown>
    returnedEvent.poison = () => null
    expect((await runtime.save()).status).toBe('saved')
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0,
      saveRevision: 1 })
  })

  it('bounds the optimistic tail and retains airborne frames for a later checkpoint', async () => {
    const { runtime, writers } = harness()
    for (let index = 0; index < 64; index++) runtime.advanceFrame([], false)
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const writeFrames = writers.frames
    vi.mocked(writers.frames).mockImplementationOnce(async (frames, revision, lineage) => {
      await held
      return writeFrames(frames, revision, lineage)
    })
    const save = runtime.save()
    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    for (let index = 1; index < 64; index++) runtime.advanceFrame([], false)
    expect(runtime.status()).toMatchObject({ gate: 'checkpointing', pendingFrames: 128,
      checkpointRequired: true })
    expect(runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
    const preview = runtime.preview()
    release()
    expect((await save).status).toBe('saved')
    expect(runtime.preview()).toEqual(preview)
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 64,
      saveRevision: 1 })
    expect((await runtime.save()).status).toBe('saved')
    expect(runtime.status().pendingFrames).toBe(0)
  })

  it.each(['state', 'greenwayWorks', 'saveRevision', 'lineage', 'extra', 'events'] as const)(
    'rejects a frame writer success with mismatched %s', async (field) => {
      const { runtime, writers } = harness()
      runtime.advanceFrame([], false)
      const before = runtime.preview()
      vi.mocked(writers.frames).mockImplementationOnce(async (_frames, revision) => {
        const start = { ...fresh(), ...before, saveRevision: revision + 1 }
        const changed = field === 'state' ? { ...start, state: { ...start.state,
          player: { ...start.state.player, coins: 999 } } }
          : field === 'greenwayWorks' ? { ...start, greenwayWorks: { ...start.greenwayWorks,
            builtBridgeIds: ['works3:bridge:1'] } }
            : field === 'saveRevision' ? { ...start, saveRevision: revision + 2 }
              : field === 'lineage' ? { ...start,
                lineage: { ...start.lineage, seed: 'foreign-seed' } }
                : field === 'extra' ? { ...start, unauthorized: true } : start
        return { ok: true as const, value: { start: changed as PublicV16Start,
          events: field === 'events' ? [{ type: 'player_jumped' as const,
            tick: 1, sequence: 1 }] : [] } }
      })
      expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
      expect(runtime.preview()).toEqual(before)
      expect(runtime.status()).toMatchObject({ pendingFrames: 1, saveRevision: 0 })
    })
})
