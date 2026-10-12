import { describe, expect, it, vi } from 'vitest'
import { createPublicV17ControllerRuntime } from './PublicV17ControllerRuntime'
import type { PublicV17ControllerWriters } from './PublicV17ControllerRuntime'
import { encodeDiscoveredTileIds } from './domain/discoveryMask'
import { createPublicV17ContinuousSession } from './domain/publicWorldV17ContinuousSession'
import { advancePublicV17GreenwayAction } from './domain/publicWorldV17GreenwayFrame'
import type { PublicV17Start } from './domain/publicWorldV17Flow'
import { confirmPublicV17GreenwayWork } from './domain/publicWorldV17GreenwayWork'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { createFreshPublicV17Head } from './domain/publicWorldV17Snapshot'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { confirmPublicV14TerrainWork } from './domain/publicWorldV14TerrainWork'

const seed = 'wizard-realms'
function fresh(): PublicV17Start {
  const { head, lineage } = createFreshPublicV17Head(seed)
  return { state: head.state, greenwayWorks: head.greenwayWorks,
    bootstrap: null, saveRevision: 0, lineage }
}
function bridgeStart(): PublicV17Start {
  const start = fresh()
  const site = resolvePublicV17GreenwaySite(seed, 'works4:bridge:greenway-creek:0')!
  if (site.kind !== 'bridge') throw new Error('Missing bridge fixture')
  const x = site.from.x, z = site.from.z - 0.6
  const y = publicV17StarterSupportAt({ seed, profile: start.state.generationProfile,
    route: null, built: false, greenwayWorks: start.greenwayWorks }, { x, z })!.floorY
  const mask = new Uint8Array(start.state.discoveryMask)
  const bits = encodeDiscoveredTileIds(site.footprintTileIds)
  for (let index = 0; index < mask.length; index++) mask[index] |= bits[index]
  return { ...start, saveRevision: 1, state: { ...start.state,
    discoveryMask: mask, player: { ...start.state.player,
      position: { x, y, z }, inventory: [...start.state.player.inventory,
        { itemId: 'logs', quantity: 8 }] } } }
}
function harness(initial = fresh()) {
  let server = initial
  const calls: [string, number][] = []
  const writers: PublicV17ControllerWriters = {
    frames: vi.fn(async (frames, revision, lineage) => {
      calls.push(['frames', revision])
      if (revision !== server.saveRevision) return { ok: false as const, reason: 'revision-changed' }
      const session = createPublicV17ContinuousSession(server), events = []
      for (const frame of frames) {
        const result = session.advanceFrame(frame.intents, { walkRequested: frame.walkRequested })
        if (result.rejections.length) return { ok: false as const, reason: 'frame-rejected' }
        events.push(...result.events)
      }
      const ready = session.snapshotForSave()
      if (ready.status === 'deferred-airborne') return { ok: false as const, reason: 'frame-rejected' }
      server = { ...ready.progress, bootstrap: null, saveRevision: revision + 1, lineage }
      return { ok: true as const, value: { start: server, events } }
    }),
    action: vi.fn(async (intent, revision, lineage) => {
      calls.push(['action', revision])
      const next = advancePublicV17GreenwayAction({ state: server.state,
        greenwayWorks: server.greenwayWorks }, intent)
      if (next.rejections.length) return { ok: false as const, reason: 'action-rejected' }
      server = { ...next.progress, bootstrap: null, saveRevision: revision + 1, lineage }
      return { ok: true as const, value: { start: server, events: next.events } }
    }),
    greenwayWork: vi.fn(async (id, revision, lineage) => {
      calls.push(['greenwayWork', revision])
      const next = confirmPublicV17GreenwayWork({ state: server.state,
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
  return { runtime: createPublicV17ControllerRuntime(initial, writers), writers, calls }
}

describe('native v17 controller save barrier', () => {
  it('returns detached scalar pose snapshots before and after frames and rebase', async () => {
    const { runtime } = harness(fresh())
    const before = runtime.poseSnapshot(), view = runtime.view()
    expect(before).toEqual({ tick: view.tick, position: view.player.position, yaw: view.player.yaw })
    const changed = runtime.poseSnapshot()
    changed.position.x = 999
    expect(runtime.poseSnapshot()).toEqual(before)
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.13, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    const after = runtime.poseSnapshot()
    expect(after.tick).toBe(before.tick + 1)
    expect(after.yaw).toBeCloseTo(before.yaw + 0.13)
    expect(before).toEqual({ tick: view.tick, position: view.player.position, yaw: view.player.yaw })
    expect((await runtime.save()).status).toBe('saved')
    expect(runtime.poseSnapshot()).toEqual(after)
  })
  it('checkpoints bounded frame witnesses and rejects stale writer responses', async () => {
    const { runtime, calls } = harness()
    for (let index = 0; index < 128; index++) {
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(runtime.status()).toMatchObject({ gate: 'cap-paused', pendingFrames: 128 })
    expect((await runtime.save()).status).toBe('saved')
    expect(calls).toEqual([['frames', 0]])
    expect(runtime.status()).toMatchObject({ gate: 'open', saveRevision: 1,
      pendingFrames: 0 })
    const stale = harness()
    stale.runtime.advanceFrame([], false)
    const before = stale.runtime.preview()
    vi.mocked(stale.writers.frames).mockResolvedValueOnce({ ok: false, reason: 'revision-changed' })
    expect(await stale.runtime.save()).toEqual({ status: 'blocked', reason: 'revision-changed' })
    expect(stale.runtime.preview()).toEqual(before)
  })

  it('flushes frames before one snapped works4 confirmation, then rebases exactly', async () => {
    const { runtime, calls } = harness(bridgeStart())
    runtime.advanceFrame([], false)
    const result = await runtime.buildGreenwayWork('works4:bridge:greenway-creek:0')
    expect(result).toMatchObject({ status: 'saved', workEvent: { kind: 'bridge',
      logsSpent: 8, xp: 80 } })
    expect(calls).toEqual([['frames', 1], ['greenwayWork', 2]])
    expect(runtime.preview().greenwayWorks.builtBridgeIds)
      .toEqual(['works4:bridge:greenway-creek:0'])
    expect(await harness().runtime.buildGreenwayWork('works4:bridge:greenway-creek:0'))
      .toMatchObject({ status: 'rejected', reason: 'undiscovered' })
  })

  it('blocks when a checked action rejects a locally accepted candidate', async () => {
    const start = fresh()
    start.state.player.inventory.push({ itemId: 'leather_boots', quantity: 1 })
    const { runtime, writers, calls } = harness({ ...start, saveRevision: 1 })
    runtime.advanceFrame([], false)
    const preview = runtime.preview()
    const intent = { type: 'equip_item', itemId: 'leather_boots', slot: 'feet' } as const
    expect(advancePublicV17GreenwayAction(preview, intent).rejections).toEqual([])
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
    expect(confirmPublicV17GreenwayWork(preview,
      'works4:bridge:greenway-creek:0').progress).not.toBeNull()
    vi.mocked(writers.greenwayWork).mockResolvedValueOnce({ ok: false,
      reason: 'action-rejected' })
    expect(await runtime.buildGreenwayWork('works4:bridge:greenway-creek:0'))
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
        : runtime.buildGreenwayWork('works4:bridge:greenway-creek:0')
      await writerStarted
      expect(runtime.status().gate).toBe('barrier')
      expect(runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
      expect(await runtime.save()).toEqual({ status: 'busy' })
      expect(await runtime.action({ type: 'unequip_item', slot: 'feet' }))
        .toEqual({ status: 'busy' })
      expect(await runtime.buildGreenwayWork('works4:bridge:greenway-creek:0'))
        .toEqual({ status: 'busy' })
      expect(writers.action).toHaveBeenCalledTimes(kind === 'action' ? 1 : 0)
      expect(writers.greenwayWork).toHaveBeenCalledTimes(kind === 'work' ? 1 : 0)
      release()
      expect(await writing).toEqual({ status: 'blocked', reason: 'revision-changed' })
    })

  it('freezes on forged successful work instead of promoting local preview', async () => {
    const { runtime, writers } = harness(bridgeStart())
    const before = runtime.preview()
    vi.mocked(writers.greenwayWork).mockResolvedValueOnce({ ok: true, value: {
      start: { ...bridgeStart(), saveRevision: 2 }, event: {
        type: 'terrain_work_built', id: 'works4:bridge:greenway-creek:0',
        kind: 'bridge', tick: before.state.tick,
        sequence: before.state.eventSequence + 1, logsSpent: 8, stoneGained: 0, xp: 80,
      } } })
    expect(await runtime.buildGreenwayWork('works4:bridge:greenway-creek:0'))
      .toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(runtime.preview()).toEqual(before)
  })

  it('continues preview frames during a checked checkpoint and replays the tail', async () => {
    const { runtime, writers, calls } = harness()
    runtime.advanceFrame([], false)
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const writeFrames = writers.frames
    vi.mocked(writers.frames).mockImplementationOnce(async (frames, revision, lineage) => {
      await held
      expect(frames).toHaveLength(1)
      return writeFrames(frames, revision, lineage)
    })
    const save = runtime.save()
    expect(runtime.status().gate).toBe('checkpointing')
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    expect(runtime.advanceFrame([], false).rejections).toEqual([])
    const preview = runtime.preview()
    expect(await runtime.action({ type: 'unequip_item', slot: 'feet' })).toEqual({ status: 'busy' })
    expect(await runtime.buildGreenwayWork('works4:bridge:greenway-creek:0'))
      .toEqual({ status: 'busy' })
    expect(await runtime.save()).toEqual({ status: 'busy' })
    release()
    expect((await save).status).toBe('saved')
    expect(runtime.preview()).toEqual(preview)
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 2,
      saveRevision: 1 })
    expect((await runtime.save()).status).toBe('saved')
    expect(calls).toEqual([['frames', 0], ['frames', 1]])
  })

  it('preserves optimistic frames when the checked writer reports a conflict', async () => {
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

  it('caps frames during the checkpoint and defers a still-airborne tail', async () => {
    const { runtime, writers } = harness()
    runtime.advanceFrame([], false)
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const writeFrames = writers.frames
    vi.mocked(writers.frames).mockImplementationOnce(async (frames, revision, lineage) => {
      await held
      return writeFrames(frames, revision, lineage)
    })
    const save = runtime.save()
    expect(runtime.advanceFrame([{ type: 'jump' }], false).rejections).toEqual([])
    const preview = runtime.preview()
    release()
    expect((await save).status).toBe('saved')
    expect(runtime.preview()).toEqual(preview)
    expect(runtime.status()).toMatchObject({ pendingFrames: 1, saveRevision: 1 })
    expect(await runtime.save()).toEqual({ status: 'deferred-airborne' })
    for (let index = 0; index < 126; index++) runtime.advanceFrame([], false)
    expect(runtime.status().pendingFrames).toBe(127)
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.16, z: 0 } }], false)
      .rejections[0]?.code).toBe('unavailable_here')
    runtime.advanceFrame([], false)
    expect(runtime.status().pendingFrames).toBe(128)
    expect(runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
    expect((await runtime.save()).status).toBe('saved')
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
            builtBridgeIds: ['works4:bridge:greenway-creek:0'] } }
            : field === 'saveRevision' ? { ...start, saveRevision: revision + 2 }
              : field === 'lineage' ? { ...start,
                lineage: { ...start.lineage, seed: 'foreign-seed' } }
                : field === 'extra' ? { ...start, unauthorized: true } : start
        return { ok: true as const, value: { start: changed as PublicV17Start,
          events: field === 'events' ? [{ type: 'player_jumped' as const,
            tick: 1, sequence: 1 }] : [] } }
      })
      expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
      expect(runtime.preview()).toEqual(before)
      expect(runtime.status()).toMatchObject({ pendingFrames: 1, saveRevision: 0 })
    })
})
