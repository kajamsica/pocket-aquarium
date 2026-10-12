import { IDBFactory } from 'fake-indexeddb'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAtomicV34Store } from '../domain/atomicV34Database'
import { discoveryMaskHasTileId } from '../domain/discoveryMask'
import { MIREGLASS_RING_ID, mireglassFairyRing } from '../domain/mireglassContent'
import { commitPublicV34 } from '../domain/publicWorldV34Flow'
import { replayPublicV33Witness } from '../domain/publicWorldV33Snapshot'
import { decodePublicV34Root } from '../domain/publicWorldV34Snapshot'
import type { PublicV34Root } from '../domain/publicWorldV34Snapshot'
import { createSyntheticV34TwoRingFixture } from './syntheticV34TwoRingFixture'

let fixture: PublicV34Root
beforeAll(() => { fixture = createSyntheticV34TwoRingFixture() }, 120_000)

describe('test-only synthetic V34 two-ring fixture', () => {
  it('is checked and labels its seeded prior Mireglass discovery', () => {
    expect(decodePublicV34Root(fixture)).toEqual(fixture)
    expect(fixture.lineage.sourceRevision).toBe(1)
    expect(fixture.head.state.movementOwner).toBe('greenway')
    expect(fixture.head.state.player.verticalVelocity).toBe(0)
    expect(fixture.head.state.player.discoveredRingIds)
      .toEqual([MIREGLASS_RING_ID, 'ring-greenway'])
    expect(discoveryMaskHasTileId(fixture.head.state.discoveryMask,
      mireglassFairyRing(fixture.head.state.seed).tile.id)).toBe(true)
    expect(replayPublicV33Witness(fixture.head, {
      kind: 'fairy-ring-travel/v1', sourceRingId: 'ring-greenway',
      targetRingId: MIREGLASS_RING_ID })).not.toBeNull()
  }, 120_000)

  it('persists outbound travel, post-arrival movement, return travel, and another move', async () => {
    const store = createAtomicV34Store(new IDBFactory(), 'v34-synthetic-two-ring-test')
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw Error('Expected empty test-only store')
    expect(await store.commit(missing.proof, fixture)).toBe('committed')
    const locks = { request: async (_name: string, _options: unknown,
      body: () => Promise<unknown>) => body() } as never
    const out = await commitPublicV34(locks, store, 0, fixture.lineage, {
      kind: 'fairy-ring-travel/v1', sourceRingId: 'ring-greenway',
      targetRingId: MIREGLASS_RING_ID })
    expect(out).toMatchObject({ ok: true, value: { head: { saveRevision: 1,
      state: { movementOwner: 'streamed' } } } })
    if (!out.ok) throw Error(out.reason)
    const frame = { kind: 'frame-batch/v1' as const, frames: [{
      intents: [{ type: 'move' as const, delta: { x: 0.1, z: 0 } }],
      walkRequested: false }] }
    const moved = await commitPublicV34(locks, store, 1, out.value.lineage, frame)
    expect(moved).toMatchObject({ ok: true, value: { head: { saveRevision: 2 } } })
    if (!moved.ok) throw Error(moved.reason)
    expect(moved.value.head.state.player.position.x)
      .not.toBe(out.value.head.state.player.position.x)
    const back = await commitPublicV34(locks, store, 2, moved.value.lineage, {
      kind: 'fairy-ring-travel/v1', sourceRingId: MIREGLASS_RING_ID,
      targetRingId: 'ring-greenway' })
    expect(back).toMatchObject({ ok: true, value: { head: { saveRevision: 3,
      state: { movementOwner: 'greenway' } } } })
    if (!back.ok) throw Error(back.reason)
    const movedAgain = await commitPublicV34(locks, store, 3, back.value.lineage, frame)
    expect(movedAgain).toMatchObject({ ok: true, value: { head: { saveRevision: 4 } } })
    if (!movedAgain.ok) throw Error(movedAgain.reason)
    expect(movedAgain.value.head.state.player.position.x)
      .not.toBe(back.value.head.state.player.position.x)
    const readback = await store.readChecked()
    expect(readback).toMatchObject({ status: 'valid', root: { head: { saveRevision: 4 },
      previous: { saveRevision: 3 } } })
    if (readback.status !== 'valid') throw Error('Expected checked V34 readback')
    expect(decodePublicV34Root(readback.root)).toEqual(readback.root)
  }, 120_000)
})
