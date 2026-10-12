import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV17Store } from './atomicV17Database'
import { createAtomicV23Store } from './atomicV23Database'
import { createAtomicV24Store } from './atomicV24Database'
import { createAtomicV25Store } from './atomicV25Database'
import { createAtomicV26Store } from './atomicV26Database'
import { createAtomicV27Store } from './atomicV27Database'
import { createAtomicV28Store } from './atomicV28Database'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { startFreshPublicV24World } from './publicWorldV24Flow'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { startPublicV25 } from './publicWorldV25Flow'
import { createPublicV26Root } from './publicWorldV26Snapshot'
import { inspectPublicV26, startPublicV26 } from './publicWorldV26Flow'
import { createPublicV27Root } from './publicWorldV27Snapshot'
import { commitPublicV27, inspectPublicV27, startPublicV27 } from './publicWorldV27Flow'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import { createPublicV28Migration, decodePublicV28Lineage,
  decodePublicV28SourceReceipt, PUBLIC_V28_DATABASE_NAME, PUBLIC_V28_SCHEMA } from './publicWorldV28Migration'
import { createPublicV28Root, decodePublicV28BridgeIds, decodePublicV28CheckedSuccessor,
  decodePublicV28Root, replayPublicV28Witness } from './publicWorldV28Snapshot'
import { sameStrictBoundedRaw } from './strictBoundedRaw'
import { commitPublicV28, inspectPublicV28, resumePublicV28, startPublicV28 } from './publicWorldV28Flow'

const seed = 'wizard-realms'
function source() {
  const v23 = createPublicV23Root(seed)
  const v24 = createPublicV24Root({ head: v23.head, lineage: v23.lineage })
  const v25 = createPublicV25Root({ head: v24.head, lineage: v24.lineage })
  const v26 = createPublicV26Root({ head: v25.head, lineage: v25.lineage })
  const v27 = createPublicV27Root({ head: v26.head, lineage: v26.lineage })
  return { head: v27.head, lineage: v27.lineage }
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
    v28: createAtomicV28Store(factory) }
}
type World = ReturnType<typeof world>
const inspect = (w: World) => inspectPublicV28(w.locks, w.v28, w.v27, w.v26,
  w.v25, w.v24, w.v23, w.v17)
const start = (w: World, receipt: Parameters<typeof startPublicV28>[9]) =>
  startPublicV28(w.locks, w.v28, w.v27, w.v26, w.v25, w.v24, w.v23, w.v17, seed, receipt)
const resume = (w: World, revision: number, lineage: unknown) =>
  resumePublicV28(w.locks, w.v28, w.v27, w.v26, w.v25, w.v24, w.v23, w.v17, revision, lineage)
const commit = (w: World, revision: number, lineage: unknown, witness: unknown) =>
  commitPublicV28(w.locks, w.v28, w.v27, w.v26, w.v25, w.v24, w.v23, w.v17,
    revision, lineage, witness as Parameters<typeof commitPublicV28>[10])

async function startV27(w: World) {
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
  return v27.value
}

describe('V28 pinned V27 bridge-store skeleton', () => {
  it('retains full-decoder fallback for frozen lineage and rejects forged atomic successors', async () => {
    const store = createAtomicV28Store(new IDBFactory()), genesis = createPublicV28Root(source())
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Missing empty V28 store')
    expect(await store.commit(missing.proof, genesis)).toBe('committed')
    const checked = await store.readChecked()
    if (checked.status !== 'valid') throw new Error('Missing V28 genesis')
    const frozen = { lineage: Object.freeze({ ...checked.root.lineage }),
      previous: checked.root.head, head: { ...checked.root.head, saveRevision: 1,
        witness: { kind: 'checkpoint' as const } } }
    expect(await store.commit(checked.proof, frozen)).toBe('committed')
    const saved = await store.readChecked()
    if (saved.status !== 'valid') throw new Error('Missing V28 checkpoint')
    const next = { lineage: saved.root.lineage, previous: saved.root.head,
      head: { ...saved.root.head, saveRevision: 2,
        witness: { kind: 'checkpoint' as const } } }
    expect(await store.commit(saved.proof, { ...next,
      lineage: { ...next.lineage, seed: 'forged' } })).toBe('invalid')
    const after = await store.readChecked()
    if (after.status !== 'valid') throw new Error('V28 root changed on invalid commit')
    expect(await store.commit(after.proof, { ...next,
      previous: { ...next.previous, saveRevision: 0 } })).toBe('invalid')
    const last = await store.readChecked()
    if (last.status !== 'valid') throw new Error('V28 root changed on invalid previous')
    expect(await store.commit(last.proof, { ...next,
      head: { ...next.head, witness: { kind: 'checkpoint', extra: true } as never } })).toBe('invalid')
    expect(await store.readChecked()).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1 } } })
  }, 30_000)

  it('matches full-root successor decoding for canonical frame and forged heads', () => {
    const genesis = createPublicV28Root(source())
    const first = { lineage: genesis.lineage, previous: genesis.head,
      head: { ...genesis.head, saveRevision: 1, witness: { kind: 'checkpoint' as const } } }
    const before = decodePublicV28Root(first)
    if (!before) throw new Error('Invalid first V28 save')
    const frame = { kind: 'frame-batch/v1' as const,
      frames: [{ intents: [{ type: 'move' as const, delta: { x: 0.1, z: 0 } }],
        walkRequested: false }] }
    const moved = replayPublicV28Witness(before.head, frame)
    if (!moved) throw new Error('Invalid V28 frame fixture')
    const next = { lineage: before.lineage, previous: before.head,
      head: { ...before.head, ...moved, saveRevision: 2, witness: frame } }
    for (const candidate of [next,
      { ...next, head: { ...next.head, saveRevision: 3 } },
      { ...next, head: { ...next.head, witness: { kind: 'checkpoint', extra: true } } },
      { ...next, head: { ...next.head, state: { ...next.head.state,
        player: { ...next.head.state.player, coins: next.head.state.player.coins + 1 } } } },
      { ...next, head: { ...next.head, riverBridgeIds: ['works6:river-bridge:-14'] } },
    ]) {
      expect(sameStrictBoundedRaw(candidate.lineage, before.lineage, 3 << 20)).toBe(true)
      expect(sameStrictBoundedRaw(candidate.previous, before.head, 3 << 20)).toBe(true)
      expect(decodePublicV28CheckedSuccessor(before, candidate))
        .toEqual(decodePublicV28Root(candidate))
    }
    const frozenLineage = { ...next, lineage: Object.freeze({ ...next.lineage }) }
    expect(sameStrictBoundedRaw(frozenLineage.lineage, before.lineage, 3 << 20)).toBe(false)
    expect(decodePublicV28Root(frozenLineage)).not.toBeNull()
  }, 30_000)

  it('pins exact V27 progress in new V28 genesis and rejects malformed lineage/ledger', () => {
    const receipt = source(), untouched = structuredClone(receipt)
    const migrated = createPublicV28Migration(receipt)
    expect([PUBLIC_V28_SCHEMA, PUBLIC_V28_DATABASE_NAME]).toEqual([
      'wizard-world/v28', 'wizard-realms:world:v28'])
    expect(migrated.lineage).toEqual({ origin: 'v27-migration', seed,
      rulesProfile: 'connected-river-bridges/v1', sourceReceipt: receipt })
    expect(migrated.progress).toEqual({ state: receipt.head.state,
      greenwayWorks: receipt.head.greenwayWorks, regionalWorks: receipt.head.regionalWorks,
      terrain: receipt.head.terrain, nextHomeAtMs: receipt.head.nextHomeAtMs,
      riverBridgeIds: [] })
    expect(migrated.progress.state).not.toBe(receipt.head.state)
    expect(receipt).toEqual(untouched)
    const root = createPublicV28Root(receipt)
    expect(decodePublicV28Root(root)).toEqual(root)
    expect(decodePublicV28Lineage(root.lineage)).toEqual(root.lineage)
    expect(decodePublicV28SourceReceipt({ ...receipt, previous: null })).toBeNull()
    expect(decodePublicV28SourceReceipt({ ...receipt, head: { ...receipt.head,
      schemaVersion: PUBLIC_V28_SCHEMA } })).toBeNull()
    expect(decodePublicV28Lineage({ ...root.lineage, seed: 'other' })).toBeNull()
    expect(decodePublicV28Lineage({ ...root.lineage, extra: true })).toBeNull()
    expect(() => createPublicV28Root({ ...receipt, previous: null })).toThrow(RangeError)
    expect(decodePublicV28BridgeIds(['works6:river-bridge:-14', 'works6:river-bridge:2']))
      .toEqual(['works6:river-bridge:-14', 'works6:river-bridge:2'])
    for (const ids of [['works6:river-bridge:01'], ['works6:river-bridge:256'],
      ['works6:river-bridge:2', 'works6:river-bridge:-14'],
      ['works6:river-bridge:2', 'works6:river-bridge:2']])
      expect(decodePublicV28BridgeIds(ids)).toBeNull()
    expect(decodePublicV28BridgeIds(Array.from({ length: 129 }, (_, gx) =>
      `works6:river-bridge:${gx}`).sort())).toBeNull()
    expect(decodePublicV28Root({ ...root, head: { ...root.head,
      riverBridgeIds: ['works6:river-bridge:-14'] } })).toBeNull()
  }, 30_000)

  it('checks three-slot replay and atomic CAS while leaving the V27 source independent', async () => {
    const factory = new IDBFactory(), v27Store = createAtomicV27Store(factory)
    const old = await v27Store.readChecked()
    if (old.status !== 'missing') throw new Error('Expected empty V27 store')
    const receipt = source()
    expect(await v27Store.commit(old.proof, { lineage: receipt.lineage,
      head: receipt.head, previous: null })).toBe('committed')
    const store = createAtomicV28Store(factory), missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected empty V28 store')
    const genesis = createPublicV28Root(receipt)
    expect(await store.commit(missing.proof, { ...genesis, extra: true } as never)).toBe('invalid')
    const retry = await store.readChecked()
    if (retry.status !== 'missing') throw new Error('Expected empty V28 after invalid candidate')
    expect(await store.commit(retry.proof, genesis)).toBe('committed')
    const competitor = createAtomicV28Store(factory)
    const left = await store.readChecked(), right = await competitor.readChecked()
    if (left.status !== 'valid' || right.status !== 'valid') throw new Error('Missing V28 genesis')
    const witness = { kind: 'checkpoint' as const }
    const before = { state: left.root.head.state, greenwayWorks: left.root.head.greenwayWorks,
      regionalWorks: left.root.head.regionalWorks, terrain: left.root.head.terrain,
      nextHomeAtMs: left.root.head.nextHomeAtMs, riverBridgeIds: left.root.head.riverBridgeIds }
    const replayed = replayPublicV28Witness(before, witness)
    if (!replayed) throw new Error('Expected V28 inherited checkpoint')
    const next = { lineage: left.root.lineage, previous: left.root.head,
      head: { ...left.root.head, ...replayed, saveRevision: 1, witness } }
    expect(decodePublicV28Root(next)).toEqual(next)
    expect(await store.commit(left.proof, next)).toBe('committed')
    expect(await competitor.commit(right.proof, next)).toBe('revision-changed')
    expect((await createAtomicV28Store(factory).readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1 } } })
    expect((await v27Store.readChecked())).toMatchObject({ status: 'valid',
      root: { head: receipt.head } })
  }, 30_000)

  it('migrates the live V27 head under one lock, then rejects stale CAS and source changes', async () => {
    const w = world()
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-v23-missing' } })
    const v27 = await startV27(w)
    const available = await inspect(w)
    if (!available.ok || available.value.status !== 'migration-available')
      throw new Error('Expected V28 migration')
    expect(available.value.sourceReceipt).toEqual(v27)
    const v27Before = await w.v27.readChecked(), count = w.acquisitions()
    const startAt = performance.now()
    const started = await start(w, available.value.sourceReceipt)
    expect(performance.now() - startAt).toBeLessThan(30_000)
    expect(w.acquisitions() - count).toBe(1)
    if (!started.ok) throw new Error(started.reason)
    expect(started.value.head.riverBridgeIds).toEqual([])
    expect(await resume(w, 0, started.value.lineage)).toEqual(started)
    expect(await resume(w, 0, Object.freeze({ ...started.value.lineage }))).toEqual(started)
    expect(await commit(w, 0,
      { ...started.value.lineage, seed: 'forged' }, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'lineage-changed' })
    expect(await commit(w, 0, started.value.lineage,
      { kind: 'river-bridge/v1', id: 'works6:river-bridge:-14' }))
      .toEqual({ ok: false, reason: 'frame-rejected' })
    expect(await commit(w, 0, started.value.lineage,
      { kind: 'river-bridge/v1', id: 'works6:river-bridge:-014' }))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    const commitAt = performance.now()
    const saved = await commit(w, 0, started.value.lineage, { kind: 'checkpoint' })
    expect(performance.now() - commitAt).toBeLessThan(30_000)
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.value.head.saveRevision).toBe(1)
    expect(await commit(w, 0, started.value.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect(await w.v27.readChecked()).toEqual(v27Before)
    const sourceChanged = await commitPublicV27(w.locks, w.v27, w.v26, w.v25,
      w.v24, w.v23, w.v17, 0, v27.lineage, { kind: 'checkpoint' })
    if (!sourceChanged.ok) throw new Error(sourceChanged.reason)
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-changed' } })
    expect(await resume(w, 1, started.value.lineage))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect(await commit(w, 1, started.value.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'source-changed' })
  }, 120_000)
})
