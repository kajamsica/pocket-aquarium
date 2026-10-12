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
import { createAtomicV30Store } from './atomicV30Database'
import { startFreshPublicV24World } from './publicWorldV24Flow'
import { startPublicV25 } from './publicWorldV25Flow'
import { inspectPublicV26, startPublicV26 } from './publicWorldV26Flow'
import { inspectPublicV27, startPublicV27 } from './publicWorldV27Flow'
import { inspectPublicV28, startPublicV28 } from './publicWorldV28Flow'
import { commitPublicV29, inspectPublicV29, startPublicV29 } from './publicWorldV29Flow'
import { createPublicV30Migration, decodePublicV30Lineage,
  decodePublicV30SourceReceipt, PUBLIC_V30_DATABASE_NAME,
  PUBLIC_V30_SCHEMA } from './publicWorldV30Migration'
import { commitPublicV30, inspectPublicV30, resumePublicV30,
  startPublicV30 } from './publicWorldV30Flow'
import type { PublicV30WriterTiming } from './publicWorldV30Flow'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import { sameStrictBoundedRaw } from './strictBoundedRaw'

const seed = 'wizard-realms'

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
    v28: createAtomicV28Store(factory), v29: createAtomicV29Store(factory),
    v30: createAtomicV30Store(factory) }
}
type World = ReturnType<typeof world>
const inspect = (w: World) => inspectPublicV30(w.locks, w.v30, w.v29, w.v28, w.v27,
  w.v26, w.v25, w.v24, w.v23, w.v17)
const start = (w: World, receipt: Parameters<typeof startPublicV30>[11]) =>
  startPublicV30(w.locks, w.v30, w.v29, w.v28, w.v27, w.v26, w.v25,
    w.v24, w.v23, w.v17, seed, receipt)
const resume = (w: World, revision: number, lineage: unknown) =>
  resumePublicV30(w.locks, w.v30, w.v29, w.v28, w.v27, w.v26, w.v25,
    w.v24, w.v23, w.v17, revision, lineage)
const commit = (w: World, revision: number, lineage: unknown, witness: unknown,
  onPhase?: PublicV30WriterTiming) =>
  commitPublicV30(w.locks, w.v30, w.v29, w.v28, w.v27, w.v26, w.v25,
    w.v24, w.v23, w.v17, revision, lineage,
    witness as Parameters<typeof commitPublicV30>[12], onPhase)

async function startV29(w: World) {
  const v24 = await startFreshPublicV24World(w.locks, w.v24, w.v23, w.v17, seed)
  if (!v24.ok) throw new Error(v24.reason)
  const v25 = await startPublicV25(w.locks, w.v25, w.v24, w.v23, w.v17, seed, v24.value)
  if (!v25.ok) throw new Error(v25.reason)
  const available26 = await inspectPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17)
  if (!available26.ok || available26.value.status !== 'migration-available')
    throw new Error('V26 source missing')
  const v26 = await startPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17,
    seed, available26.value.sourceReceipt)
  if (!v26.ok) throw new Error(v26.reason)
  const available27 = await inspectPublicV27(w.locks, w.v27, w.v26, w.v25,
    w.v24, w.v23, w.v17)
  if (!available27.ok || available27.value.status !== 'migration-available')
    throw new Error('V27 source missing')
  const v27 = await startPublicV27(w.locks, w.v27, w.v26, w.v25, w.v24,
    w.v23, w.v17, seed, available27.value.sourceReceipt)
  if (!v27.ok) throw new Error(v27.reason)
  const available28 = await inspectPublicV28(w.locks, w.v28, w.v27, w.v26,
    w.v25, w.v24, w.v23, w.v17)
  if (!available28.ok || available28.value.status !== 'migration-available')
    throw new Error('V28 source missing')
  const v28 = await startPublicV28(w.locks, w.v28, w.v27, w.v26, w.v25,
    w.v24, w.v23, w.v17, seed, available28.value.sourceReceipt)
  if (!v28.ok) throw new Error(v28.reason)
  const available29 = await inspectPublicV29(w.locks, w.v29, w.v28, w.v27,
    w.v26, w.v25, w.v24, w.v23, w.v17)
  if (!available29.ok || available29.value.status !== 'migration-available')
    throw new Error('V29 source missing')
  const v29 = await startPublicV29(w.locks, w.v29, w.v28, w.v27, w.v26,
    w.v25, w.v24, w.v23, w.v17, seed, available29.value.sourceReceipt)
  if (!v29.ok) throw new Error(v29.reason)
  return v29.value
}

describe('V30 source-preserving migration and live ancestry', () => {
  it('copies an exact V29 source once, rejects malformed receipts and blocks changed ancestry', async () => {
    const w = world()
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-v23-missing' } })
    const v29 = await startV29(w)
    const before = await w.v29.readChecked()
    const available = await inspect(w)
    if (!available.ok || available.value.status !== 'migration-available')
      throw new Error('V30 migration not available')
    expect(available.value.sourceReceipt).toEqual(v29)
    expect([PUBLIC_V30_SCHEMA, PUBLIC_V30_DATABASE_NAME]).toEqual([
      'wizard-world/v30', 'wizard-realms:world:v30'])
    const migrated = createPublicV30Migration(v29)
    expect(migrated.progress).toEqual({ state: v29.head.state,
      greenwayWorks: v29.head.greenwayWorks, regionalWorks: v29.head.regionalWorks,
      terrain: v29.head.terrain, nextHomeAtMs: v29.head.nextHomeAtMs,
      riverBridgeIds: v29.head.riverBridgeIds, miningTools: v29.head.miningTools,
      claimedBridgeheadId: null })
    expect(migrated.progress.state).not.toBe(v29.head.state)
    expect(decodePublicV30SourceReceipt({ ...v29, extra: true })).toBeNull()
    expect(decodePublicV30SourceReceipt({ ...v29, head: { ...v29.head,
      state: { ...v29.head.state, seed: 'forged' } } })).toBeNull()
    expect(decodePublicV30Lineage({ ...migrated.lineage, seed: 'forged' })).toBeNull()
    const count = w.acquisitions()
    const started = await start(w, available.value.sourceReceipt)
    expect(w.acquisitions() - count).toBe(1)
    if (!started.ok) throw new Error(started.reason)
    expect(started.value.head.claimedBridgeheadId).toBeNull()
    expect(await w.v29.readChecked()).toEqual(before)
    expect(sameStrictBoundedRaw((await w.v29.readChecked()), before, 3 << 20)).toBe(true)
    expect(await resume(w, 0, started.value.lineage)).toEqual(started)
    expect(await start(w, available.value.sourceReceipt)).toEqual({ ok: false,
      reason: 'target-conflict' })
    const throwing: PublicV30WriterTiming = () => { throw new Error('trace failed') }
    const forged = { kind: 'bridgehead-claim/v1', bridgeId: 'works3:bridge:1',
      reward: 'coins' }
    const invalid = await commit(w, 0, started.value.lineage, forged)
    expect(invalid).toEqual({ ok: false, reason: 'invalid-witness' })
    expect(await commit(w, 0, started.value.lineage, forged, throwing)).toEqual(invalid)
    expect((await w.v30.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 } } })
    const saved = await commit(w, 0, started.value.lineage, { kind: 'checkpoint' })
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.value.head.saveRevision).toBe(1)
    const stale = await commit(w, 0, started.value.lineage, { kind: 'checkpoint' })
    expect(stale).toEqual({ ok: false, reason: 'revision-changed' })
    expect(await commit(w, 0, started.value.lineage,
      { kind: 'checkpoint' }, throwing)).toEqual(stale)
    const samples: Array<{ phase: string; durationMs: number }> = []
    const timed = await commit(w, 1, started.value.lineage,
      { kind: 'checkpoint' }, (sample) => { samples.push(sample) })
    if (!timed.ok) throw new Error(timed.reason)
    expect(timed.value.head).toEqual({ ...saved.value.head, saveRevision: 2 })
    expect(samples.map((sample) => sample.phase)).toEqual([
      'lock-wait', 'v30-checked-read', 'v29-ancestry-inspect',
      'lineage-witness-replay', 'v30-commit'])
    for (const sample of samples) {
      expect(Object.keys(sample).sort()).toEqual(['durationMs', 'phase'])
      expect(Number.isFinite(sample.durationMs)).toBe(true)
      expect(sample.durationMs).toBeGreaterThanOrEqual(0)
    }
    const traced = await commit(w, 2, started.value.lineage,
      { kind: 'checkpoint' }, throwing)
    if (!traced.ok) throw new Error(traced.reason)
    expect(traced.value.head).toEqual({ ...saved.value.head, saveRevision: 3 })
    expect(await w.v29.readChecked()).toEqual(before)
    const changed = await commitPublicV29(w.locks, w.v29, w.v28, w.v27, w.v26,
      w.v25, w.v24, w.v23, w.v17, 0, v29.lineage, { kind: 'checkpoint' })
    if (!changed.ok) throw new Error(changed.reason)
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-changed' } })
    expect(await resume(w, 3, started.value.lineage))
      .toEqual({ ok: false, reason: 'source-changed' })
    const blocked = await commit(w, 3, started.value.lineage, { kind: 'checkpoint' })
    expect(blocked).toEqual({ ok: false, reason: 'source-changed' })
    expect(await commit(w, 3, started.value.lineage,
      { kind: 'checkpoint' }, throwing)).toEqual(blocked)
    expect((await w.v30.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 3 } } })
  }, 240_000)
})
