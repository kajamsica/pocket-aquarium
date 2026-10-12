import { describe, expect, it, vi } from 'vitest'
import { createPublicV15ControllerRuntime } from './PublicV15ControllerRuntime'
import type { PublicV15ControllerWriters } from './PublicV15ControllerRuntime'
import { encodeDiscoveredTileIds } from './domain/discoveryMask'
import { createPublicV15ContinuousSession } from './domain/publicWorldV15ContinuousSession'
import { advancePublicV15GreenwayAction } from './domain/publicWorldV15Flow'
import type { PublicV15Start } from './domain/publicWorldV15Flow'
import { confirmPublicV14TerrainWork } from './domain/publicWorldV14TerrainWork'
import { resolvePublicV14Surface } from './domain/publicWorldV14Terrain'
import type { PublicWorldIntent } from './domain/publicWorldRuntime'
import { createFreshPublicV15Head } from './domain/publicWorldV15Snapshot'
import { PUBLIC_V15_STARTER_BRIDGE_ID, publicWorldV15StarterSites } from './domain/publicWorldV15StarterSites'
import { confirmPublicV15StarterWork } from './domain/publicWorldV15StarterWork'
import { resolveTerrainWorkSite } from './domain/terrainWorks'

const seed = 'greenway-alpha'
const freshStart = (): PublicV15Start => {
  const { head, lineage } = createFreshPublicV15Head(seed)
  return { state: head.state, starterWorks: head.starterWorks, bootstrap: null,
    saveRevision: 0, lineage }
}
function bridgeStart(): PublicV15Start {
  const fresh = freshStart()
  const bridge = publicWorldV15StarterSites(seed)[0]
  if (bridge.kind !== 'bridge') throw new Error('Missing bridge fixture')
  const bits = encodeDiscoveredTileIds(bridge.footprintTileIds)
  const mask = new Uint8Array(fresh.state.discoveryMask)
  for (let index = 0; index < mask.length; index++) mask[index] |= bits[index]
  return { ...fresh, saveRevision: 1,
    state: { ...fresh.state, tick: 1, discoveryMask: mask,
      player: { ...fresh.state.player,
        position: { ...bridge.from },
        inventory: [...fresh.state.player.inventory, { itemId: 'logs', quantity: 8 }] } } }
}
const streamedBridgeId = 'works1:bridge:-102:92:z'
function streamedStart(): PublicV15Start {
  const fresh = freshStart()
  const site = resolveTerrainWorkSite(seed, streamedBridgeId)
  if (!site || site.kind !== 'bridge') throw new Error('Missing streamed bridge fixture')
  const floor = resolvePublicV14Surface(fresh.state, site.from)
  if (!floor) throw new Error('Missing streamed floor')
  const bits = encodeDiscoveredTileIds(site.footprintTileIds)
  const mask = new Uint8Array(fresh.state.discoveryMask)
  for (let index = 0; index < mask.length; index++) mask[index] |= bits[index]
  return { ...fresh, saveRevision: 1,
    state: { ...fresh.state, tick: 1, movementOwner: 'streamed', discoveryMask: mask,
      player: { ...fresh.state.player,
        position: { ...site.from, y: floor.floorY },
        inventory: [...fresh.state.player.inventory, { itemId: 'logs', quantity: 8 }] } } }
}
function harness(initial = freshStart()) {
  let server = initial
  const calls: { kind: 'frames' | 'action' | 'work' | 'starterWork'; revision: number;
    payload: unknown }[] = []
  const writers: PublicV15ControllerWriters = {
    frames: vi.fn(async (frames, revision, lineage) => {
      calls.push({ kind: 'frames', revision, payload: structuredClone(frames) })
      if (revision !== server.saveRevision) return { ok: false as const, reason: 'revision-changed' }
      const replay = createPublicV15ContinuousSession(server)
      const events = []
      for (const frame of frames) {
        const result = replay.advanceFrame(frame.intents, { walkRequested: frame.walkRequested })
        if (result.rejections.length) return { ok: false as const, reason: 'frame-rejected' }
        events.push(...result.events)
      }
      const saved = replay.snapshotForSave()
      if (saved.status === 'deferred-airborne') return { ok: false as const, reason: 'frame-rejected' }
      server = { ...saved.progress, bootstrap: null, saveRevision: revision + 1, lineage }
      return { ok: true as const, value: { start: server, events } }
    }),
    action: vi.fn(async (intent, revision, lineage) => {
      calls.push({ kind: 'action', revision, payload: structuredClone(intent) })
      if (revision !== server.saveRevision) return { ok: false as const, reason: 'revision-changed' }
      const result = advancePublicV15GreenwayAction(server, intent)
      if (result.rejections.length) return { ok: false as const, reason: 'action-rejected' }
      server = { ...result.progress, bootstrap: null, saveRevision: revision + 1, lineage }
      return { ok: true as const, value: { start: server, events: result.events } }
    }),
    work: vi.fn(async (id, revision, lineage) => {
      calls.push({ kind: 'work', revision, payload: id })
      if (revision !== server.saveRevision) return { ok: false as const, reason: 'revision-changed' }
      const result = confirmPublicV14TerrainWork(server.state, id)
      if (!result.candidate) return { ok: false as const, reason: 'action-rejected' }
      server = { ...server, state: result.candidate, saveRevision: revision + 1, lineage }
      return { ok: true as const, value: { start: server, event: result.event } }
    }),
    starterWork: vi.fn(async (id, revision, lineage) => {
      calls.push({ kind: 'starterWork', revision, payload: id })
      if (revision !== server.saveRevision) return { ok: false as const, reason: 'revision-changed' }
      const result = confirmPublicV15StarterWork({ state: server.state,
        starterWorks: server.starterWorks }, id)
      if (!result.progress) return { ok: false as const, reason: 'action-rejected' }
      server = { ...result.progress, bootstrap: null, saveRevision: revision + 1, lineage }
      return { ok: true as const, value: { start: server, event: result.event } }
    }),
  }
  return { runtime: createPublicV15ControllerRuntime(initial, writers), writers, calls,
    server: () => server }
}

describe('native v15 controller runtime', () => {
  it('rejects a v1 lineage and requires the starter-work progress pair', () => {
    const start = freshStart()
    const writers = harness().writers
    expect(() => createPublicV15ControllerRuntime({ ...start,
      lineage: { ...start.lineage, rulesProfile: 'starter-crossing/v1' } as never }, writers))
      .toThrow('validated v15 start')
    expect(() => createPublicV15ControllerRuntime({ ...start,
      starterWorks: undefined } as never, writers)).toThrow('validated v15 start')
  })

  it('records a canonical bounded witness and rebases only after its checked writer', async () => {
    const { runtime, writers, calls } = harness()
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.24, z: 0 } }], false)
      .rejections[0]?.code).toBe('invalid_value')
    expect(runtime.status().pendingFrames).toBe(0)
    const frame: PublicWorldIntent[] = [{ type: 'look', yawDelta: 0.1, pitchDelta: 0 },
      { type: 'move', delta: { x: 0.16, z: 0 } }]
    expect(runtime.advanceFrame(frame, true).rejections).toEqual([])
    for (let index = 1; index < 64; index++) {
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 64,
      checkpointRecommended: true, saveRevision: 0 })
    expect(writers.frames).not.toHaveBeenCalled()
    expect((await runtime.save()).status).toBe('saved')
    expect(calls[0]).toMatchObject({ kind: 'frames', revision: 0 })
    expect((calls[0].payload as { intents: PublicWorldIntent[]; walkRequested: boolean }[])[0])
      .toEqual({ intents: frame, walkRequested: true })
    expect((calls[0].payload as unknown[]).length).toBe(64)
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0,
      saveRevision: 1 })
    expect(runtime.preview()).toMatchObject({ state: { tick: 64 },
      starterWorks: { bridgeBuilt: false, bankCacheDug: false } })
  })

  it('reserves landing frames and pauses at 128 until a checkpoint', async () => {
    const { runtime } = harness()
    for (let index = 0; index < 97; index++) {
      expect(runtime.advanceFrame([], false).rejections).toEqual([])
    }
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.16, z: 0 } }], true)
      .rejections[0]?.code).toBe('unavailable_here')
    for (let index = 97; index < 128; index++) runtime.advanceFrame([], false)
    expect(runtime.status()).toMatchObject({ gate: 'cap-paused', pendingFrames: 128,
      checkpointRequired: true })
    expect(runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
    expect((await runtime.save()).status).toBe('saved')
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0 })
  })

  it('flushes the full pair before a Greenway action', async () => {
    const { runtime, calls } = harness()
    runtime.advanceFrame([], false)
    const intent: PublicWorldIntent = { type: 'equip_item', itemId: 'woodcutters_axe',
      slot: 'mainHand' }
    expect(await runtime.action(intent)).toMatchObject({ status: 'saved',
      resetWalkRequested: false })
    expect(calls.map((call) => [call.kind, call.revision])).toEqual([
      ['frames', 0], ['action', 1]])
    expect(runtime.preview().state.player.equipment.mainHand).toBe('woodcutters_axe')
    expect(runtime.preview().starterWorks).toEqual({ bridgeBuilt: false, bankCacheDug: false })
  })

  it('commits the fixed bridge only through the starter-work writer', async () => {
    const { runtime, writers, calls } = harness(bridgeStart())
    expect(confirmPublicV15StarterWork(runtime.preview(), PUBLIC_V15_STARTER_BRIDGE_ID))
      .toMatchObject({ progress: { starterWorks: { bridgeBuilt: true } } })
    runtime.advanceFrame([], false)
    expect(confirmPublicV15StarterWork(runtime.preview(), PUBLIC_V15_STARTER_BRIDGE_ID))
      .toMatchObject({ progress: { starterWorks: { bridgeBuilt: true } } })
    const outcome = await runtime.buildStarterWork(PUBLIC_V15_STARTER_BRIDGE_ID)
    expect(outcome).toEqual({ status: 'saved', events: [], resetWalkRequested: false,
      workEvent: { type: 'terrain_work_built', id: PUBLIC_V15_STARTER_BRIDGE_ID,
        tick: 2, sequence: expect.any(Number), logsSpent: 8, stoneGained: 0, xp: 80 } })
    expect(calls.map((call) => [call.kind, call.revision])).toEqual([
      ['frames', 1], ['starterWork', 2]])
    expect(writers.work).not.toHaveBeenCalled()
    expect(runtime.preview().starterWorks).toEqual({ bridgeBuilt: true, bankCacheDug: false })
    expect(runtime.preview().state.player.skillXp.construction).toBe(80)
    expect(runtime.status()).toMatchObject({ gate: 'open', pendingFrames: 0,
      saveRevision: 3 })
  })

  it('flushes streamed frames before a checked streamed work commit', async () => {
    const { runtime, writers, calls } = harness(streamedStart())
    runtime.advanceFrame([], false)
    const outcome = await runtime.buildWork(streamedBridgeId)
    expect(outcome).toMatchObject({ status: 'saved',
      workEvent: { type: 'terrain_work_built', id: streamedBridgeId,
        logsSpent: 8, xp: 80 } })
    expect(calls.map((call) => [call.kind, call.revision])).toEqual([
      ['frames', 1], ['work', 2]])
    expect(writers.starterWork).not.toHaveBeenCalled()
    expect(runtime.preview().starterWorks).toEqual({ bridgeBuilt: false, bankCacheDug: false })
    expect(runtime.preview().state.terrainWorks.builtWorkIds).toContain(streamedBridgeId)
  })

  it('never calls a starter writer for hidden or unavailable work', async () => {
    const { runtime, writers } = harness()
    expect(await runtime.buildStarterWork(PUBLIC_V15_STARTER_BRIDGE_ID))
      .toEqual({ status: 'rejected', reason: 'undiscovered' })
    expect(await runtime.buildWork(PUBLIC_V15_STARTER_BRIDGE_ID))
      .toEqual({ status: 'rejected', reason: 'unavailable_here' })
    expect(writers.starterWork).not.toHaveBeenCalled()
    expect(writers.work).not.toHaveBeenCalled()
  })

  it('freezes and retains unsaved preview when a frame writer is stale', async () => {
    const { runtime, writers } = harness()
    runtime.advanceFrame([{ type: 'move', delta: { x: 0.16, z: 0 } }], true)
    const before = runtime.preview()
    vi.mocked(writers.frames).mockResolvedValueOnce({ ok: false, reason: 'revision-changed' })
    expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'revision-changed' })
    expect(runtime.status()).toMatchObject({ gate: 'blocked', pendingFrames: 1,
      saveRevision: 0 })
    expect(runtime.preview()).toEqual(before)
    expect(runtime.advanceFrame([], false).rejections[0]?.code).toBe('unavailable_here')
  })

  it.each(['state', 'starterWorks', 'saveRevision', 'lineage', 'events'] as const)(
    'cold-fails a successful frame writer that changes %s', async (field) => {
      const { runtime, writers } = harness()
      runtime.advanceFrame([], false)
      const before = runtime.preview()
      const revision = runtime.status().saveRevision
      vi.mocked(writers.frames).mockImplementationOnce(async () => {
        const start = { ...freshStart(), saveRevision: revision + 1,
          state: { ...before.state, tick: before.state.tick + 1 },
          starterWorks: before.starterWorks }
        const altered = field === 'state' ? { ...start,
          state: { ...start.state, player: { ...start.state.player, coins: 999 } } }
          : field === 'starterWorks' ? { ...start,
            starterWorks: { ...start.starterWorks, bridgeBuilt: true } }
            : field === 'saveRevision' ? { ...start, saveRevision: revision + 2 }
              : field === 'lineage' ? { ...start,
                lineage: { ...start.lineage, seed: 'foreign-seed' } } : start
        return { ok: true, value: { start: altered, events: field === 'events'
          ? [{ type: 'player_jumped' as const, tick: 1, sequence: 1 }] : [] } }
      })
      expect(await runtime.save()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
      expect(runtime.status()).toMatchObject({ gate: 'blocked', pendingFrames: 1,
        saveRevision: 0 })
      expect(runtime.preview()).toEqual(before)
    })

  it('cold-fails a starter writer that claims success without the flag and materials transition', async () => {
    const { runtime, writers } = harness(bridgeStart())
    const before = runtime.preview()
    vi.mocked(writers.starterWork).mockResolvedValueOnce({ ok: true,
      value: { start: { ...bridgeStart(), saveRevision: 2 },
        event: { type: 'terrain_work_built', id: PUBLIC_V15_STARTER_BRIDGE_ID,
          tick: before.state.tick, sequence: before.state.eventSequence + 1,
          logsSpent: 8, stoneGained: 0, xp: 80 } } })
    expect(await runtime.buildStarterWork(PUBLIC_V15_STARTER_BRIDGE_ID))
      .toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(runtime.preview()).toEqual(before)
    expect(runtime.status()).toMatchObject({ gate: 'blocked', saveRevision: 1 })
  })

  it('cold-fails malformed success and forged Greenway action progress', async () => {
    const malformed = harness()
    malformed.runtime.advanceFrame([], false)
    vi.mocked(malformed.writers.frames).mockResolvedValueOnce({ ok: true, value: null } as never)
    expect(await malformed.runtime.save()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(malformed.runtime.status().pendingFrames).toBe(1)

    const forged = harness()
    const before = forged.runtime.preview()
    vi.mocked(forged.writers.action).mockResolvedValueOnce({ ok: true,
      value: { start: { ...freshStart(), saveRevision: 1,
        state: { ...before.state, player: { ...before.state.player, coins: 999 } } },
      events: [{ type: 'item_equipped', itemId: 'woodcutters_axe',
        slot: 'mainHand', tick: 1, sequence: 1 }] } })
    expect(await forged.runtime.action({ type: 'equip_item', itemId: 'woodcutters_axe',
      slot: 'mainHand' })).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(forged.runtime.preview()).toEqual(before)
  })
})
