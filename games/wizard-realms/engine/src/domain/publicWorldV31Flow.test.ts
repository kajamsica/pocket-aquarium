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
import { createAtomicV31Store } from './atomicV31Database'
import { startFreshPublicV24World } from './publicWorldV24Flow'
import { startPublicV25 } from './publicWorldV25Flow'
import { inspectPublicV26, startPublicV26 } from './publicWorldV26Flow'
import { inspectPublicV27, startPublicV27 } from './publicWorldV27Flow'
import { inspectPublicV28, startPublicV28 } from './publicWorldV28Flow'
import { inspectPublicV29, startPublicV29 } from './publicWorldV29Flow'
import { commitPublicV30, inspectPublicV30, startPublicV30 } from './publicWorldV30Flow'
import { PUBLIC_V31_DATABASE_NAME } from './publicWorldV31Migration'
import { commitPublicV31, inspectPublicV31, resumePublicV31, startPublicV31 } from './publicWorldV31Flow'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'

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
    v30: createAtomicV30Store(factory), v31: createAtomicV31Store(factory) }
}
type World = ReturnType<typeof world>
const inspect = (w: World) => inspectPublicV31(w.locks, w.v31, w.v30, w.v29, w.v28,
  w.v27, w.v26, w.v25, w.v24, w.v23, w.v17)
const start = (w: World, receipt: Parameters<typeof startPublicV31>[12]) =>
  startPublicV31(w.locks, w.v31, w.v30, w.v29, w.v28, w.v27, w.v26,
    w.v25, w.v24, w.v23, w.v17, seed, receipt)
const resume = (w: World, revision: number, lineage: unknown) =>
  resumePublicV31(w.locks, w.v31, w.v30, w.v29, w.v28, w.v27, w.v26,
    w.v25, w.v24, w.v23, w.v17, revision, lineage)
const commit = (w: World, revision: number, lineage: unknown, witness: unknown) =>
  commitPublicV31(w.locks, w.v31, w.v30, w.v29, w.v28, w.v27, w.v26,
    w.v25, w.v24, w.v23, w.v17, revision, lineage,
    witness as Parameters<typeof commitPublicV31>[13])

async function checkedSource(w: World) {
  const v24 = await startFreshPublicV24World(w.locks, w.v24, w.v23, w.v17, seed)
  if (!v24.ok) throw new Error(v24.reason)
  const v25 = await startPublicV25(w.locks, w.v25, w.v24, w.v23, w.v17, seed, v24.value)
  if (!v25.ok) throw new Error(v25.reason)
  const available26 = await inspectPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17)
  if (!available26.ok || available26.value.status !== 'migration-available') throw new Error('V26 source')
  const v26 = await startPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17,
    seed, available26.value.sourceReceipt)
  if (!v26.ok) throw new Error(v26.reason)
  const available27 = await inspectPublicV27(w.locks, w.v27, w.v26, w.v25,
    w.v24, w.v23, w.v17)
  if (!available27.ok || available27.value.status !== 'migration-available') throw new Error('V27 source')
  const v27 = await startPublicV27(w.locks, w.v27, w.v26, w.v25, w.v24,
    w.v23, w.v17, seed, available27.value.sourceReceipt)
  if (!v27.ok) throw new Error(v27.reason)
  const available28 = await inspectPublicV28(w.locks, w.v28, w.v27, w.v26,
    w.v25, w.v24, w.v23, w.v17)
  if (!available28.ok || available28.value.status !== 'migration-available') throw new Error('V28 source')
  const v28 = await startPublicV28(w.locks, w.v28, w.v27, w.v26, w.v25,
    w.v24, w.v23, w.v17, seed, available28.value.sourceReceipt)
  if (!v28.ok) throw new Error(v28.reason)
  const available29 = await inspectPublicV29(w.locks, w.v29, w.v28, w.v27,
    w.v26, w.v25, w.v24, w.v23, w.v17)
  if (!available29.ok || available29.value.status !== 'migration-available') throw new Error('V29 source')
  const v29 = await startPublicV29(w.locks, w.v29, w.v28, w.v27, w.v26,
    w.v25, w.v24, w.v23, w.v17, seed, available29.value.sourceReceipt)
  if (!v29.ok) throw new Error(v29.reason)
  const available30 = await inspectPublicV30(w.locks, w.v30, w.v29, w.v28, w.v27,
    w.v26, w.v25, w.v24, w.v23, w.v17)
  if (!available30.ok || available30.value.status !== 'migration-available') throw new Error('V30 source')
  const v30 = await startPublicV30(w.locks, w.v30, w.v29, w.v28, w.v27,
    w.v26, w.v25, w.v24, w.v23, w.v17, seed, available30.value.sourceReceipt)
  if (!v30.ok) throw new Error(v30.reason)
  const checkpoint = await commitPublicV30(w.locks, w.v30, w.v29, w.v28, w.v27,
    w.v26, w.v25, w.v24, w.v23, w.v17, 0, v30.value.lineage, { kind: 'checkpoint' })
  if (!checkpoint.ok) throw new Error(checkpoint.reason)
  const checked = await w.v30.readChecked()
  if (checked.status !== 'valid') throw new Error('V30 root')
  return { v30: checkpoint.value, root: checked.root }
}

describe('V31 complete source pin and checked writer', () => {
  it('copies the full V30 root once, replays, and rejects stale writes and changed source', async () => {
    const w = world(), source = await checkedSource(w)
    expect(PUBLIC_V31_DATABASE_NAME).toBe('wizard-realms:world:v31')
    expect(source.root.previous?.saveRevision).toBe(0)
    const available = await inspect(w)
    if (!available.ok || available.value.status !== 'migration-available') throw new Error('V31 source')
    expect(available.value.sourceReceipt).toEqual(source.root)
    expect(await start(w, { ...source.root, previous: null }))
      .toEqual({ ok: false, reason: 'invalid-source' })
    const count = w.acquisitions()
    const started = await start(w, available.value.sourceReceipt)
    expect(w.acquisitions() - count).toBe(1)
    if (!started.ok) throw new Error(started.reason)
    expect(started.value.lineage.sourceReceipt).toEqual(source.root)
    expect(started.value.head.raisedSoilCells).toEqual([])
    expect((await w.v30.readChecked())).toMatchObject({ status: 'valid', root: source.root })
    expect(await resume(w, 0, started.value.lineage)).toEqual(started)
    expect(await start(w, source.root)).toEqual({ ok: false, reason: 'target-conflict' })
    expect(await commit(w, 0, started.value.lineage,
      { kind: 'soil-place/v1', gx: 0, gz: 0, extra: true }))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    const saved = await commit(w, 0, started.value.lineage, { kind: 'checkpoint' })
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.value.head.saveRevision).toBe(1)
    expect(await commit(w, 0, started.value.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    const changed = await commitPublicV30(w.locks, w.v30, w.v29, w.v28, w.v27,
      w.v26, w.v25, w.v24, w.v23, w.v17, source.v30.head.saveRevision,
      source.v30.lineage, { kind: 'checkpoint' })
    if (!changed.ok) throw new Error(changed.reason)
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-changed' } })
    expect(await resume(w, 1, started.value.lineage)).toEqual({ ok: false, reason: 'source-changed' })
    expect(await commit(w, 1, started.value.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'source-changed' })
  }, 240_000)

  it('rejects a fabricated successor and consumes checked proof only once', async () => {
    const w = world(), source = await checkedSource(w)
    const started = await start(w, source.root)
    if (!started.ok) throw new Error(started.reason)
    const read = await w.v31.readChecked()
    if (read.status !== 'valid') throw new Error('V31 root')
    const forged = { ...read.root, head: { ...read.root.head,
      saveRevision: 1, witness: { kind: 'checkpoint' },
      raisedSoilCells: [{ gx: 2, gz: 2 }] }, previous: read.root.head }
    expect(await w.v31.commit(read.proof, forged as typeof read.root)).toBe('invalid')
    expect(await w.v31.commit(read.proof, read.root)).toBe('invalid')
    expect((await w.v31.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0, raisedSoilCells: [] } } })
  }, 240_000)
})
