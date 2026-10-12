import { describe, expect, it, vi } from 'vitest'
import { createPublicV32ControllerRuntime } from './PublicV32ControllerRuntime'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { highlandLandmark } from './domain/highlandContent'
import { applyPublicV26ReturnHome } from './domain/publicWorldV26Escape'
import { nearbyWorldTileIds } from './domain/publicWorldDiscovery'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import { resolvePublicV23Surface } from './domain/publicWorldV14Terrain'
import { createFreshPublicV17Head } from './domain/publicWorldV17Snapshot'
import { publicV17StarterSupportAt } from './domain/publicWorldV17StarterMovement'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root } from './domain/publicWorldV26Snapshot'
import { createPublicV27Root } from './domain/publicWorldV27Snapshot'
import { createPublicV28Root } from './domain/publicWorldV28Snapshot'
import { createPublicV29Root } from './domain/publicWorldV29Snapshot'
import { createPublicV30Root } from './domain/publicWorldV30Snapshot'
import { createPublicV31Root } from './domain/publicWorldV31Snapshot'
import { createPublicV32Root, replayPublicV32Witness } from './domain/publicWorldV32Snapshot'
import type { PublicV32Witness } from './domain/publicWorldV32Snapshot'
import type { PublicV32Start } from './domain/publicWorldV32Flow'

function atCrown(seed = 'greenway-alpha', offsetX = 0): PublicV32Start {
  const v17 = createFreshPublicV17Head(seed)
  const crown = highlandLandmark(seed)
  const point = { x: crown.tile.center.x + offsetX, z: crown.tile.center.z }
  const surface = resolvePublicV23Surface(v17.head.state, point, [])
  if (!surface) throw new Error('Missing Highland surface')
  const state = { ...v17.head.state, movementOwner: 'streamed' as const,
    discoveryMask: encodeDiscoveredTileIds([...new Set([
      ...decodeDiscoveredTileIds(v17.head.state.discoveryMask),
      ...nearbyWorldTileIds(crown.tile.center, 8), crown.tile.id])].sort()),
    player: { ...v17.head.state.player,
      position: { ...point, y: surface.floorY } } }
  const v23 = createPublicV23Root(seed, { state,
    greenwayWorks: v17.head.greenwayWorks, saveRevision: 1, lineage: v17.lineage })
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  const v31 = createPublicV31Root(v30)
  const v32 = createPublicV32Root(v31)
  return { head: v32.head, lineage: v32.lineage }
}

function writerFor(start: PublicV32Start) {
  let current = structuredClone(start)
  const write = vi.fn(async (revision: number, lineage: PublicV32Start['lineage'],
    witness: PublicV32Witness) => {
    if (revision !== current.head.saveRevision || !samePublicV14Value(lineage, current.lineage))
      return { ok: false as const, reason: 'revision-changed' }
    const next = replayPublicV32Witness(current.head, witness)
    if (!next) return { ok: false as const, reason: 'frame-rejected' }
    current = { lineage, head: { ...current.head, ...next,
      saveRevision: revision + 1, witness } }
    return { ok: true as const, value: current }
  })
  return { write, current: () => current }
}

describe('V32 controller runtime', () => {
  it('flushes pending V31 frames before a checked Crown study, then reconstructs core', async () => {
    const start = atCrown(), writer = writerFor(start)
    const runtime = createPublicV32ControllerRuntime(start, writer.write)
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    const witness = { kind: 'highland-discover/v1' as const,
      landmarkId: highlandLandmark(start.head.state.seed).id }
    expect(await runtime.action(witness)).toMatchObject({ status: 'saved' })
    expect(writer.write.mock.calls.map((call) => call[2].kind))
      .toEqual(['frame-batch/v1', 'highland-discover/v1'])
    expect(writer.write.mock.calls.every((call) => call.length === 3)).toBe(true)
    expect(runtime.preview().state.highland.landmarkDiscovered).toBe(true)
    expect(runtime.committed()).toEqual(writer.current())
    expect(runtime.status().pendingFrames).toBe(0)
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(runtime.committed()).toEqual(writer.current())
  }, 120_000)

  it('rejects a repeated study without a second write', async () => {
    const start = atCrown(), writer = writerFor(start)
    const runtime = createPublicV32ControllerRuntime(start, writer.write)
    const witness = { kind: 'highland-discover/v1' as const,
      landmarkId: highlandLandmark(start.head.state.seed).id }
    expect(await runtime.action(witness)).toMatchObject({ status: 'saved' })
    expect(await runtime.action(witness)).toEqual({ status: 'rejected', reason: 'already_studied' })
    expect(writer.write).toHaveBeenCalledOnce()
  }, 120_000)

  it('checks the post-flush position, not the stale pre-movement Crown radius', async () => {
    const start = atCrown('greenway-alpha', 7.95), writer = writerFor(start)
    const runtime = createPublicV32ControllerRuntime(start, writer.write)
    expect(Math.hypot(start.head.state.player.position.x
      - highlandLandmark(start.head.state.seed).tile.center.x,
    start.head.state.player.position.z
      - highlandLandmark(start.head.state.seed).tile.center.z)).toBeLessThan(8)
    expect(runtime.advanceFrame([{ type: 'move', delta: { x: 0.16, z: 0 } }], false)
      .rejections).toEqual([])
    expect(runtime.preview().state.player.position.x).toBeGreaterThan(
      highlandLandmark(start.head.state.seed).tile.center.x + 8)
    expect(await runtime.action({ kind: 'highland-discover/v1',
      landmarkId: highlandLandmark(start.head.state.seed).id }))
      .toEqual({ status: 'rejected', reason: 'too_far' })
    expect(writer.write.mock.calls.map((call) => call[2].kind)).toEqual(['frame-batch/v1'])
    expect(runtime.committed().head.state.highland.landmarkDiscovered).toBe(false)
  }, 120_000)

  it('blocks a forged writer successor and keeps the committed head unchanged', async () => {
    const start = atCrown()
    const runtime = createPublicV32ControllerRuntime(start, async (revision, lineage, witness) => {
      const next = replayPublicV32Witness(start.head, witness)!
      return { ok: true, value: { lineage, head: { ...start.head, ...next,
        state: { ...next.state, player: { ...next.state.player,
          coins: next.state.player.coins + 80 } },
        saveRevision: revision + 1, witness } } }
    })
    expect(await runtime.action({ kind: 'highland-discover/v1',
      landmarkId: highlandLandmark(start.head.state.seed).id }))
      .toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(runtime.committed()).toEqual(start)
    expect(runtime.status().gate).toBe('blocked')
  }, 120_000)

  it('passes a one-use, witness-bound owned frame proof only in opted-in play', async () => {
    const start = atCrown()
    let current = structuredClone(start)
    let calls = 0
    const runtime = createPublicV32ControllerRuntime(start,
      async (revision, lineage, witness, proof) => {
        calls += 1
        expect(witness.kind).toBe('frame-batch/v1')
        expect(proof).toBeTypeOf('function')
        if (!proof) throw new Error('Missing private proof')
        if (calls === 1) {
          expect(proof(revision + 1, witness)).toBeNull()
          expect(proof(revision, witness)).toBeNull()
        } else {
          const expected = proof(revision, witness)
          expect(expected).toEqual(replayPublicV32Witness(current.head, witness))
          expect(proof(revision, witness)).toBeNull()
          if (expected) expected.state.player.coins += 40
        }
        const next = replayPublicV32Witness(current.head, witness)!
        current = { lineage, head: { ...current.head, ...next,
          saveRevision: revision + 1, witness } }
        return { ok: true as const, value: current }
      }, undefined, true)
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(runtime.advanceFrame([{ type: 'look', yawDelta: 0.01, pitchDelta: 0 }], false)
      .rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(calls).toBe(2)
    expect(runtime.committed()).toEqual(current)
  }, 120_000)

  it('retains the inherited checked Return Home rejection without mutating Highland', async () => {
    const start = atCrown(), writer = writerFor(start)
    const returnHome = vi.fn(async () => ({ ok: false as const, reason: 'not_trapped' }))
    const runtime = createPublicV32ControllerRuntime(start, writer.write, returnHome)
    expect(await runtime.returnHome()).toEqual({ status: 'rejected', reason: 'not_trapped' })
    expect(returnHome).toHaveBeenCalledOnce()
    expect(runtime.committed()).toEqual(start)
    expect(runtime.preview().state.highland).toEqual(start.head.state.highland)
  }, 120_000)

  it('returns a trapped player home after a saved Highland study without losing that study', async () => {
    const start = atCrown(), studyWriter = writerFor(start)
    const studying = createPublicV32ControllerRuntime(start, studyWriter.write)
    expect(await studying.action({ kind: 'highland-discover/v1',
      landmarkId: highlandLandmark(start.head.state.seed).id }))
      .toMatchObject({ status: 'saved' })
    const studied = studying.committed()
    const place = { x: 12, z: 4 }
    const support = publicV17StarterSupportAt({ seed: studied.head.state.seed,
      profile: studied.head.state.generationProfile,
      route: studied.head.state.greenway.routes.find((entry) =>
        entry.id === 'greenway_ladder') ?? null,
      built: studied.head.state.greenway.builtRouteIds.includes('greenway_ladder'),
      greenwayWorks: studied.head.greenwayWorks }, place)
    if (!support || support.kind !== 'ground') throw new Error('Missing trapped-site floor')
    const trapped: PublicV32Start = { ...studied, head: { ...studied.head,
      terrain: { ...studied.head.terrain,
        columns: [{ gx: 3, gz: 1, openDepth: 8, rewardDepth: 8, pitLadder: false }] },
      state: { ...studied.head.state, movementOwner: 'greenway',
        player: { ...studied.head.state.player, verticalVelocity: 0,
          position: { ...place, y: support.floorY } } } } }
    const before = { state: trapped.head.state, greenwayWorks: trapped.head.greenwayWorks,
      regionalWorks: trapped.head.regionalWorks, terrain: trapped.head.terrain,
      nextHomeAtMs: trapped.head.nextHomeAtMs }
    expect(applyPublicV26ReturnHome(before, 10_000).progress).toBeDefined()
    let current = structuredClone(trapped)
    const returnHome = vi.fn(async (revision: number, lineage: PublicV32Start['lineage']) => {
      const witness = { kind: 'return-home/v1' as const, atMs: 10_000 }
      const next = replayPublicV32Witness(current.head, witness)
      if (!next) return { ok: false as const, reason: 'frame-rejected' }
      current = { lineage, head: { ...current.head, ...next,
        saveRevision: revision + 1, witness } }
      return { ok: true as const, value: current }
    })
    const runtime = createPublicV32ControllerRuntime(trapped, async () =>
      ({ ok: false, reason: 'unexpected-write' }), returnHome)
    expect(await runtime.returnHome()).toMatchObject({ status: 'saved' })
    expect(returnHome).toHaveBeenCalledOnce()
    expect(runtime.committed()).toEqual(current)
    expect(runtime.preview().state.player.position).toMatchObject({ x: 0, z: 0 })
    expect(runtime.preview().state.highland.landmarkDiscovered).toBe(true)
    expect(runtime.preview().nextHomeAtMs).toBe(1_810_000)
  }, 120_000)
})
