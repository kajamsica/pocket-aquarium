import { afterEach, describe, expect, it, vi } from 'vitest'

const proofControl = vi.hoisted(() => ({
  mode: 'normal' as 'normal' | 'drop' | 'mismatch', seen: [] as boolean[] }))
vi.mock('./PublicV28ControllerRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PublicV28ControllerRuntime')>()
  const create: typeof actual.createPublicV28ControllerRuntime = (initial, write, returnHome) =>
    actual.createPublicV28ControllerRuntime(initial, (revision, lineage, witness, proof) => {
      proofControl.seen.push(!!proof)
      if (proofControl.mode === 'drop') return write(revision, lineage, witness)
      if (proofControl.mode === 'mismatch' && proof) {
        const changed = structuredClone(proof)
        Reflect.set(changed.state, 'eventSequence', changed.state.eventSequence + 1)
        return write(revision, lineage, witness, changed)
      }
      return proof ? write(revision, lineage, witness, proof)
        : write(revision, lineage, witness)
    }, returnHome)
  return { ...actual, createPublicV28ControllerRuntime: create }
})

import { createPublicV30ControllerRuntime } from './PublicV30ControllerRuntime'
import { decodeDiscoveredTileIds, encodeDiscoveredTileIds } from './domain/discoveryMask'
import { samePublicV14Value } from './domain/publicWorldV14Validation'
import { resolvePublicV17GreenwaySite } from './domain/publicWorldV17GreenwaySites'
import { createPublicV23Root } from './domain/publicWorldV23Snapshot'
import { createPublicV24Root } from './domain/publicWorldV24Snapshot'
import { createPublicV25Root } from './domain/publicWorldV25Snapshot'
import { createPublicV26Root } from './domain/publicWorldV26Snapshot'
import { createPublicV27Root } from './domain/publicWorldV27Snapshot'
import { createPublicV28Root } from './domain/publicWorldV28Snapshot'
import { createPublicV29Root } from './domain/publicWorldV29Snapshot'
import { createPublicV30Root, replayPublicV30Witness } from './domain/publicWorldV30Snapshot'
import type { PublicV30Witness } from './domain/publicWorldV30Snapshot'
import type { PublicV30Start } from './domain/publicWorldV30Flow'

const seed = 'wizard-realms', bridgeId = 'works4:bridge:greenway-creek:0'
const frame = (index: number) => [{ type: 'move' as const,
  delta: { x: index % 2 ? -0.02 : 0.02, z: 0 } }]

function genesis(): PublicV30Start {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  const v29 = createPublicV29Root({ head: v28.head, lineage: v28.lineage })
  const v30 = createPublicV30Root({ head: v29.head, lineage: v29.lineage })
  return { head: v30.head, lineage: v30.lineage }
}
const fresh = genesis()

function initial(claimed = false): PublicV30Start {
  const start = structuredClone(fresh)
  if (!claimed) return start
  const site = resolvePublicV17GreenwaySite(seed, bridgeId)
  if (!site || site.kind !== 'bridge') throw new Error('Missing canonical bridge')
  return { ...start, head: { ...start.head, claimedBridgeheadId: bridgeId,
    greenwayWorks: { ...start.head.greenwayWorks, builtBridgeIds: [bridgeId] },
    state: { ...start.head.state,
      discoveryMask: encodeDiscoveredTileIds([...new Set([
        ...decodeDiscoveredTileIds(start.head.state.discoveryMask),
        ...site.footprintTileIds])].sort()),
      player: { ...start.head.state.player, xp: start.head.state.player.xp + 80,
        skillXp: { ...start.head.state.player.skillXp, construction: 80 } } } } }
}

function writerFor(start: PublicV30Start) {
  let current = start
  const write = vi.fn(async (revision: number, lineage: PublicV30Start['lineage'],
    witness: PublicV30Witness) => {
    if (revision !== current.head.saveRevision || !samePublicV14Value(lineage, current.lineage))
      return { ok: false as const, reason: 'revision-changed' }
    const next = replayPublicV30Witness(current.head, witness)
    if (!next) return { ok: false as const, reason: 'frame-rejected' }
    current = { lineage, head: { ...current.head, ...next,
      saveRevision: revision + 1, witness } }
    return { ok: true as const, value: current }
  })
  return { write, current: () => current }
}

afterEach(() => { proofControl.mode = 'normal'; proofControl.seen = [] })

describe('V30 inherited checked frame proof', () => {
  it.each([false, true])('saves 64 frames with canonical claim present: %s', async (claimed) => {
    const start = initial(claimed), writer = writerFor(start)
    const runtime = createPublicV30ControllerRuntime(start, writer.write)
    for (let index = 0; index < 64; index++)
      expect(runtime.advanceFrame(frame(index), false).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    const witness = writer.write.mock.calls[0]?.[2]
    const replayed = replayPublicV30Witness(start.head, witness)
    expect(runtime.preview()).toMatchObject(replayed!)
    expect(runtime.committed()).toEqual(writer.current())
    expect(runtime.committed().head.claimedBridgeheadId)
      .toBe(claimed ? bridgeId : null)
    expect(proofControl.seen).toEqual([true])
    expect(createPublicV30ControllerRuntime(runtime.committed(), writer.write).preview())
      .toEqual(runtime.preview())
  }, 60_000)

  it.each(['drop', 'mismatch'] as const)('falls back for a %s frame proof', async (mode) => {
    proofControl.mode = mode
    const start = initial(), writer = writerFor(start)
    const runtime = createPublicV30ControllerRuntime(start, writer.write)
    expect(runtime.advanceFrame(frame(0), false).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(runtime.preview()).toMatchObject(
      replayPublicV30Witness(start.head, writer.write.mock.calls[0]?.[2])!)
    expect(proofControl.seen).toEqual([true])
  })

  it('binds the opt-in proof to an exact witness and isolates writer mutation', async () => {
    const start = initial(), writer = writerFor(start)
    let calls = 0
    const runtime = createPublicV30ControllerRuntime(start,
      async (revision, lineage, witness, proof) => {
        calls += 1
        expect(proof).toBeTypeOf('function')
        if (!proof) throw new Error('Missing frame proof')
        if (calls === 1) {
          expect(proof(revision, { ...witness, extra: true })).toBeNull()
          expect(proof(revision, witness)).toBeNull()
        } else {
          expect(proof(revision, witness)).toEqual(replayPublicV30Witness(writer.current().head,
            witness))
          expect(proof(revision, witness)).toBeNull()
        }
        const result = await writer.write(revision, lineage, structuredClone(witness))
        Reflect.set(witness, 'extra', true)
        return result
      }, undefined, true)
    expect(runtime.advanceFrame(frame(0), false).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(runtime.advanceFrame(frame(1), false).rejections).toEqual([])
    expect(await runtime.save()).toMatchObject({ status: 'saved' })
    expect(runtime.committed()).toEqual(writer.current())
    expect(calls).toBe(2)
  }, 60_000)

  it('blocks a forged claimed ID and a stale or mismatched writer', async () => {
    const built = initial(true)
    const forged: PublicV30Start = { ...built, head: { ...built.head,
      claimedBridgeheadId: 'works4:bridge:greenway-creek:1' } }
    const denied = writerFor(forged)
    const invalid = createPublicV30ControllerRuntime(forged, denied.write)
    expect(invalid.advanceFrame(frame(0), false).rejections).toEqual([])
    expect(await invalid.save()).toEqual({ status: 'blocked', reason: 'local-replay' })
    expect(denied.write).not.toHaveBeenCalled()

    const start = initial()
    const stale = createPublicV30ControllerRuntime(start,
      async () => ({ ok: false as const, reason: 'revision-changed' }))
    expect(stale.advanceFrame(frame(0), false).rejections).toEqual([])
    expect(await stale.save()).toEqual({ status: 'blocked', reason: 'revision-changed' })
    expect(stale.committed()).toEqual(start)

    const writer = writerFor(start)
    const mismatched = createPublicV30ControllerRuntime(start, async (revision, lineage, witness) => {
      const result = await writer.write(revision, lineage, witness)
      return result.ok ? { ok: true as const, value: { ...result.value,
        head: { ...result.value.head, claimedBridgeheadId: bridgeId } } } : result
    })
    expect(mismatched.advanceFrame(frame(0), false).rejections).toEqual([])
    expect(await mismatched.save()).toEqual({ status: 'blocked', reason: 'writer-mismatch' })
    expect(mismatched.committed()).toEqual(start)
  }, 30_000)

  it('keeps actions and Return Home on their existing writer paths', async () => {
    const start = initial(), writer = writerFor(start)
    const home = vi.fn(async () => ({ ok: false as const, reason: 'not_trapped' }))
    const runtime = createPublicV30ControllerRuntime(start, writer.write, home)
    expect(await runtime.action({ kind: 'legacy-action', intent: {
      type: 'equip_item', itemId: 'woodcutters_axe', slot: 'mainHand' } }))
      .toMatchObject({ status: 'saved' })
    expect(proofControl.seen).toEqual([false])
    expect(writer.write.mock.calls[0]).toHaveLength(3)
    expect(await runtime.returnHome()).toEqual({ status: 'rejected', reason: 'not_trapped' })
    expect(home).toHaveBeenCalledOnce()
    expect(writer.write).toHaveBeenCalledTimes(1)
  })
})
