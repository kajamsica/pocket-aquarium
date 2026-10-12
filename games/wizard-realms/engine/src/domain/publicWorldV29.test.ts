import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV17Store } from './atomicV17Database'
import { createAtomicV23Store } from './atomicV23Database'
import { createAtomicV24Store } from './atomicV24Database'
import { createAtomicV25Store } from './atomicV25Database'
import { createAtomicV26Store } from './atomicV26Database'
import { createAtomicV27Store } from './atomicV27Database'
import { createAtomicV28Store } from './atomicV28Database'
import { createAtomicV29Store } from './atomicV29Database'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { startFreshPublicV24World } from './publicWorldV24Flow'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { startPublicV25 } from './publicWorldV25Flow'
import { createPublicV26Root } from './publicWorldV26Snapshot'
import { inspectPublicV26, startPublicV26 } from './publicWorldV26Flow'
import { createPublicV27Root } from './publicWorldV27Snapshot'
import { inspectPublicV27, startPublicV27 } from './publicWorldV27Flow'
import { createPublicV28Root } from './publicWorldV28Snapshot'
import { commitPublicV28, inspectPublicV28, startPublicV28 } from './publicWorldV28Flow'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import { createPublicV29Migration, decodePublicV29Lineage,
  decodePublicV29SourceReceipt, PUBLIC_V29_DATABASE_NAME, PUBLIC_V29_SCHEMA } from './publicWorldV29Migration'
import { createPublicV29Root, decodePublicV29CheckedSuccessor,
  decodePublicV29Root, replayPublicV29Witness } from './publicWorldV29Snapshot'
import { commitPublicV29, inspectPublicV29, requestPublicV29ReturnHome,
  resumePublicV29, startPublicV29 } from './publicWorldV29Flow'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

const seed = 'wizard-realms'
function source() {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  const v28 = createPublicV28Root({ head: v27.head, lineage: v27.lineage })
  return { head: v28.head, lineage: v28.lineage }
}

function world() {
  const factory = new IDBFactory()
  let active = false, acquisitions = 0
  const locks = { request: async <T,>(name: string, options: { mode: 'exclusive' },
    body: () => T | Promise<T>): Promise<T> => {
    expect(name).toBe(PUBLIC_V7_LOCK_NAME)
    expect(options).toEqual({ mode: 'exclusive' })
    if (active) throw new Error('Nested world lock')
    active = true; acquisitions++
    try { return await body() } finally { active = false }
  } }
  return { locks, acquisitions: () => acquisitions,
    v17: createAtomicV17Store(factory), v23: createAtomicV23Store(factory),
    v24: createAtomicV24Store(factory), v25: createAtomicV25Store(factory),
    v26: createAtomicV26Store(factory), v27: createAtomicV27Store(factory),
    v28: createAtomicV28Store(factory), v29: createAtomicV29Store(factory) }
}
type World = ReturnType<typeof world>
const inspect = (w: World) => inspectPublicV29(w.locks, w.v29, w.v28, w.v27, w.v26,
  w.v25, w.v24, w.v23, w.v17)
const start = (w: World, receipt: Parameters<typeof startPublicV29>[10]) =>
  startPublicV29(w.locks, w.v29, w.v28, w.v27, w.v26, w.v25, w.v24, w.v23,
    w.v17, seed, receipt)
const resume = (w: World, revision: number, lineage: unknown) =>
  resumePublicV29(w.locks, w.v29, w.v28, w.v27, w.v26, w.v25, w.v24,
    w.v23, w.v17, revision, lineage)
const commit = (w: World, revision: number, lineage: unknown, witness: unknown) =>
  commitPublicV29(w.locks, w.v29, w.v28, w.v27, w.v26, w.v25, w.v24,
    w.v23, w.v17, revision, lineage, witness as Parameters<typeof commitPublicV29>[11])

async function startV28(w: World) {
  const v24 = await startFreshPublicV24World(w.locks, w.v24, w.v23, w.v17, seed)
  if (!v24.ok) throw new Error(v24.reason)
  const v25 = await startPublicV25(w.locks, w.v25, w.v24, w.v23, w.v17, seed, v24.value)
  if (!v25.ok) throw new Error(v25.reason)
  const v26Available = await inspectPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17)
  if (!v26Available.ok || v26Available.value.status !== 'migration-available')
    throw new Error('Expected V26 migration')
  const v26 = await startPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17,
    seed, v26Available.value.sourceReceipt)
  if (!v26.ok) throw new Error(v26.reason)
  const v27Available = await inspectPublicV27(w.locks, w.v27, w.v26, w.v25, w.v24, w.v23, w.v17)
  if (!v27Available.ok || v27Available.value.status !== 'migration-available')
    throw new Error('Expected V27 migration')
  const v27 = await startPublicV27(w.locks, w.v27, w.v26, w.v25, w.v24, w.v23,
    w.v17, seed, v27Available.value.sourceReceipt)
  if (!v27.ok) throw new Error(v27.reason)
  const v28Available = await inspectPublicV28(w.locks, w.v28, w.v27, w.v26,
    w.v25, w.v24, w.v23, w.v17)
  if (!v28Available.ok || v28Available.value.status !== 'migration-available')
    throw new Error('Expected V28 migration')
  const v28 = await startPublicV28(w.locks, w.v28, w.v27, w.v26, w.v25,
    w.v24, w.v23, w.v17, seed, v28Available.value.sourceReceipt)
  if (!v28.ok) throw new Error(v28.reason)
  return v28.value
}

describe('V29 checked V28 excavation foundation', () => {
  it('migrates the exact V28 state and initializes only the new sidecar', () => {
    const receipt = source(), untouched = structuredClone(receipt)
    const migrated = createPublicV29Migration(receipt)
    expect([PUBLIC_V29_SCHEMA, PUBLIC_V29_DATABASE_NAME]).toEqual([
      'wizard-world/v29', 'wizard-realms:world:v29'])
    expect(migrated.lineage).toEqual({ origin: 'v28-migration', seed,
      rulesProfile: 'deep-excavation/v1', sourceReceipt: receipt })
    expect(migrated.progress).toEqual({ state: receipt.head.state,
      greenwayWorks: receipt.head.greenwayWorks, regionalWorks: receipt.head.regionalWorks,
      terrain: receipt.head.terrain, nextHomeAtMs: receipt.head.nextHomeAtMs,
      riverBridgeIds: receipt.head.riverBridgeIds,
      miningTools: { basicPickOwned: false, enchantedPickOwned: false, activePick: null } })
    expect(migrated.progress.state).not.toBe(receipt.head.state)
    expect(receipt).toEqual(untouched)
    const root = createPublicV29Root(receipt)
    expect(decodePublicV29Root(root)).toEqual(root)
    expect(decodePublicV29Lineage(root.lineage)).toEqual(root.lineage)
    expect(decodePublicV29SourceReceipt({ ...receipt, previous: null })).toBeNull()
    expect(decodePublicV29Lineage({ ...root.lineage, seed: 'other' })).toBeNull()
    expect(decodePublicV29Root({ ...root, head: { ...root.head,
      miningTools: { basicPickOwned: false, enchantedPickOwned: false,
        activePick: 'basic' } } })).toBeNull()
    expect(() => createPublicV29Root({ ...receipt, extra: true })).toThrow(RangeError)
  }, 30_000)

  it('matches complete reload decoding for guarded successors and rejects forged saves', () => {
    const genesis = createPublicV29Root(source())
    const checkpoint = { lineage: genesis.lineage, previous: genesis.head,
      head: { ...genesis.head, saveRevision: 1, witness: { kind: 'checkpoint' as const } } }
    const before = decodePublicV29Root(checkpoint)
    if (!before) throw new Error('Invalid first V29 save')
    const frame = { kind: 'frame-batch/v1' as const,
      frames: [{ intents: [{ type: 'move' as const, delta: { x: 0.1, z: 0 } }],
        walkRequested: false }] }
    const moved = replayPublicV29Witness(before.head, frame)
    if (!moved) throw new Error('Invalid V29 frame fixture')
    const next = { lineage: before.lineage, previous: before.head,
      head: { ...before.head, ...moved, saveRevision: 2, witness: frame } }
    for (const candidate of [next,
      { ...next, head: { ...next.head, saveRevision: 3 } },
      { ...next, head: { ...next.head, witness: { kind: 'checkpoint', extra: true } } },
      { ...next, head: { ...next.head, state: { ...next.head.state,
        player: { ...next.head.state.player, coins: next.head.state.player.coins + 1 } } } },
      { ...next, head: { ...next.head, miningTools: { basicPickOwned: true,
        enchantedPickOwned: false, activePick: 'basic' } } },
    ]) {
      expect(sameStrictBoundedRaw(candidate.lineage, before.lineage, 3 << 20)).toBe(true)
      expect(sameStrictBoundedRaw(candidate.previous, before.head, 3 << 20)).toBe(true)
      expect(decodePublicV29CheckedSuccessor(before, candidate))
        .toEqual(decodePublicV29Root(candidate))
    }
    const frozenLineage = { ...next, lineage: Object.freeze({ ...next.lineage }) }
    expect(sameStrictBoundedRaw(frozenLineage.lineage, before.lineage, 3 << 20)).toBe(false)
    expect(decodePublicV29Root(frozenLineage)).not.toBeNull()
  }, 30_000)

  it('uses one-shot atomic proof and rejects stale CAS while preserving the V28 source', async () => {
    const factory = new IDBFactory(), store = createAtomicV29Store(factory)
    const receipt = source(), genesis = createPublicV29Root(receipt)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Missing V29 store')
    expect(await store.commit(missing.proof, { ...genesis, extra: true } as never)).toBe('invalid')
    const retry = await store.readChecked()
    if (retry.status !== 'missing') throw new Error('Missing V29 store after invalid candidate')
    expect(await store.commit(retry.proof, genesis)).toBe('committed')
    const competitor = createAtomicV29Store(factory)
    const left = await store.readChecked(), right = await competitor.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('Missing V29 genesis')
    const witness = { kind: 'checkpoint' as const }
    const replayed = replayPublicV29Witness(left.root.head, witness)
    if (!replayed) throw new Error('Expected inherited checkpoint')
    const next = { lineage: left.root.lineage, previous: left.root.head,
      head: { ...left.root.head, ...replayed, saveRevision: 1, witness } }
    expect(await store.commit(left.proof, next)).toBe('committed')
    expect(await competitor.commit(right.proof, next)).toBe('revision-changed')
    expect((await createAtomicV29Store(factory).readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1 } } })
    const saved = await store.readChecked()
    if (saved.status !== 'valid') throw new Error('Missing V29 checkpoint')
    expect(await store.commit(saved.proof, { ...next, previous: {
      ...next.previous, saveRevision: 9 } })).toBe('invalid')
  }, 45_000)

  it('pins the live V28 source and blocks source changes without resetting a save', async () => {
    const w = world()
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-v23-missing' } })
    const v28 = await startV28(w)
    const available = await inspect(w)
    if (!available.ok || available.value.status !== 'migration-available')
      throw new Error('Expected V29 migration')
    expect(available.value.sourceReceipt).toEqual(v28)
    const v28Before = await w.v28.readChecked(), count = w.acquisitions()
    const started = await start(w, available.value.sourceReceipt)
    expect(w.acquisitions() - count).toBe(1)
    if (!started.ok) throw new Error(started.reason)
    expect(started.value.head.miningTools).toEqual({ basicPickOwned: false,
      enchantedPickOwned: false, activePick: null })
    expect(await resume(w, 0, started.value.lineage)).toEqual(started)
    expect(await resume(w, 0, Object.freeze({ ...started.value.lineage }))).toEqual(started)
    expect(await commit(w, 0, { ...started.value.lineage, seed: 'forged' },
      { kind: 'checkpoint' })).toEqual({ ok: false, reason: 'lineage-changed' })
    expect(await commit(w, 0, started.value.lineage, { kind: 'checkpoint', extra: true }))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    expect(await commit(w, 0, started.value.lineage,
      { kind: 'mining-tool/v1', action: { kind: 'buy', tier: 'basic', price: 0 } }))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    expect(await commit(w, 0, started.value.lineage,
      { kind: 'mining-tool/v1', action: { kind: 'buy', tier: 'basic' } }))
      .toEqual({ ok: false, reason: 'frame-rejected' })
    expect(await requestPublicV29ReturnHome(w.locks, w.v29, w.v28, w.v27, w.v26,
      w.v25, w.v24, w.v23, w.v17, 0, started.value.lineage))
      .toEqual({ ok: false, reason: 'not_trapped' })
    const saved = await commit(w, 0, started.value.lineage, { kind: 'checkpoint' })
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.value.head.saveRevision).toBe(1)
    expect(await commit(w, 0, started.value.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    let journey = saved.value
    const take = async (witness: unknown) => {
      const result = await commit(w, journey.head.saveRevision, journey.lineage, witness)
      if (!result.ok) throw new Error(`${JSON.stringify(witness)}: ${result.reason}`)
      journey = result.value
    }
    const walk = async (target: { x: number; z: number }, steps: number) => {
      const origin = journey.head.state.player.position
      await take({ kind: 'frame-batch/v1', frames: Array.from({ length: steps }, () => ({
        intents: [{ type: 'move', delta: { x: (target.x - origin.x) / steps,
          z: (target.z - origin.z) / steps } }], walkRequested: false })) })
    }
    const outfitter = journey.head.state.greenway.stores.find((entry) => entry.id === 'store-greenway')
    if (!outfitter) throw new Error('Missing Outfitters')
    await walk(outfitter.position, 40)
    await take({ kind: 'legacy-action', intent: { type: 'buy_store_listing',
      storeId: 'store-greenway', listingId: 'spade' } })
    await take({ kind: 'mining-tool/v1', action: { kind: 'buy', tier: 'basic' } })
    await take({ kind: 'legacy-action', intent: { type: 'equip_item',
      itemId: 'field_spade', slot: 'mainHand' } })
    await walk({ x: 1.5, z: 0 }, 50)
    for (let layer = 0; layer < 2; layer++)
      await take({ kind: 'terrain-action/v1', action: { kind: 'dig', gx: 1, gz: 0 } })
    await take({ kind: 'mining-tool/v1', action: { kind: 'equip', tier: 'basic' } })
    await take({ kind: 'deep-dig', gx: 1, gz: 0 })
    expect(journey.head.terrain.bag).toMatchObject({ soil: 2, stone: 1 })
    expect((await resume(w, journey.head.saveRevision, journey.lineage)))
      .toEqual({ ok: true, value: journey })
    await walk(outfitter.position, 50)
    await take({ kind: 'sell-mineral/v1', material: 'stone', quantity: 1 })
    expect(journey.head.terrain.bag.stone).toBe(0)
    expect(await resume(w, journey.head.saveRevision, journey.lineage))
      .toEqual({ ok: true, value: journey })
    const reloaded = await w.v29.readChecked()
    expect(reloaded).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: journey.head.saveRevision,
        terrain: { bag: { stone: 0 } } } } })
    if (reloaded.status !== 'valid') throw new Error('Missing sale save')
    expect(decodePublicV29Root(reloaded.root)).toEqual(reloaded.root)
    expect(await w.v28.readChecked()).toEqual(v28Before)
    const changed = await commitPublicV28(w.locks, w.v28, w.v27, w.v26,
      w.v25, w.v24, w.v23, w.v17, 0, v28.lineage, { kind: 'checkpoint' })
    if (!changed.ok) throw new Error(changed.reason)
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-changed' } })
    expect(await resume(w, journey.head.saveRevision, started.value.lineage))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect(await commit(w, journey.head.saveRevision, started.value.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'source-changed' })
  }, 240_000)
})
