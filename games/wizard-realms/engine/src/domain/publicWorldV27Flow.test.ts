import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createAtomicV17Store } from './atomicV17Database'
import { createAtomicV23Store } from './atomicV23Database'
import { createAtomicV24Store } from './atomicV24Database'
import { createAtomicV25Store } from './atomicV25Database'
import { createAtomicV26Store } from './atomicV26Database'
import { createAtomicV27Store } from './atomicV27Database'
import { startFreshPublicV24World } from './publicWorldV24Flow'
import { startPublicV25 } from './publicWorldV25Flow'
import { commitPublicV26, inspectPublicV26, startPublicV26 } from './publicWorldV26Flow'
import { PUBLIC_V7_LOCK_NAME } from './publicWorldV7'
import { commitPublicV27, inspectPublicV27, resumePublicV27,
  startPublicV27 } from './publicWorldV27Flow'

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
    v26: createAtomicV26Store(factory), v27: createAtomicV27Store(factory) }
}
type World = ReturnType<typeof world>
const inspect = (w: World) => inspectPublicV27(w.locks, w.v27, w.v26, w.v25, w.v24, w.v23, w.v17)
const start = (w: World, receipt: Parameters<typeof startPublicV27>[8]) =>
  startPublicV27(w.locks, w.v27, w.v26, w.v25, w.v24, w.v23, w.v17, seed, receipt)
const resume = (w: World, revision: number, lineage: unknown) =>
  resumePublicV27(w.locks, w.v27, w.v26, w.v25, w.v24, w.v23, w.v17, revision, lineage)
const commit = (w: World, revision: number, lineage: unknown,
  witness: Parameters<typeof commitPublicV27>[9]) =>
  commitPublicV27(w.locks, w.v27, w.v26, w.v25, w.v24, w.v23, w.v17, revision, lineage, witness)

async function startV26(w: World) {
  const v24 = await startFreshPublicV24World(w.locks, w.v24, w.v23, w.v17, seed)
  if (!v24.ok) throw new Error(v24.reason)
  const v25 = await startPublicV25(w.locks, w.v25, w.v24, w.v23, w.v17, seed, v24.value)
  if (!v25.ok) throw new Error(v25.reason)
  const available = await inspectPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17)
  if (!available.ok || available.value.status !== 'migration-available')
    throw new Error('Expected checked V26 migration receipt')
  const started = await startPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17,
    seed, available.value.sourceReceipt)
  if (!started.ok) throw new Error(started.reason)
  return started.value
}

describe('V27 checked migration and writer', () => {
  it('migrates the exact live V26 head under one lock, commits and reloads without changing V26', async () => {
    const w = world()
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-v23-missing' } })
    const v26 = await startV26(w)
    const advanced = await commitPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17,
      0, v26.lineage, { kind: 'checkpoint' })
    if (!advanced.ok) throw new Error(advanced.reason)
    const sourceBefore = await w.v26.readChecked(), available = await inspect(w)
    if (!available.ok || available.value.status !== 'migration-available')
      throw new Error('Expected checked V27 migration receipt')
    expect(available.value.sourceReceipt).toEqual(advanced.value)
    const before = w.acquisitions(), started = await start(w, available.value.sourceReceipt)
    expect(w.acquisitions() - before).toBe(1)
    if (!started.ok) throw new Error(started.reason)
    expect(started.value.lineage.sourceReceipt).toEqual(advanced.value)
    expect(started.value.head.saveRevision).toBe(0)
    expect(await resume(w, 0, started.value.lineage)).toEqual(started)
    const saved = await commit(w, 0, started.value.lineage, { kind: 'checkpoint' })
    if (!saved.ok) throw new Error(saved.reason)
    expect(saved.value.head.saveRevision).toBe(1)
    expect(await resume(w, 1, started.value.lineage)).toEqual(saved)
    expect(await w.v26.readChecked()).toEqual(sourceBefore)
  }, 30_000)

  it('rejects V26 source changes for inspect, resume, start and commit', async () => {
    const w = world(), v26 = await startV26(w), available = await inspect(w)
    if (!available.ok || available.value.status !== 'migration-available')
      throw new Error('Expected V27 migration receipt')
    const advanced = await commitPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17,
      0, v26.lineage, { kind: 'checkpoint' })
    if (!advanced.ok) throw new Error(advanced.reason)
    expect(await start(w, available.value.sourceReceipt)).toEqual({ ok: false, reason: 'source-changed' })
    const updated = await inspect(w)
    if (!updated.ok || updated.value.status !== 'migration-available')
      throw new Error('Expected refreshed V27 migration receipt')
    const started = await start(w, updated.value.sourceReceipt)
    if (!started.ok) throw new Error(started.reason)
    const later = await commitPublicV26(w.locks, w.v26, w.v25, w.v24, w.v23, w.v17,
      1, v26.lineage, { kind: 'checkpoint' })
    if (!later.ok) throw new Error(later.reason)
    expect(await inspect(w)).toEqual({ ok: true,
      value: { status: 'blocked', reason: 'source-changed' } })
    expect(await resume(w, 0, started.value.lineage)).toEqual({ ok: false, reason: 'source-changed' })
    expect(await commit(w, 0, started.value.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'source-changed' })
    expect((await w.v27.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 0 } } })
  }, 30_000)

  it('rejects stale revisions and forged witness/lineage without advancing the root', async () => {
    const w = world()
    await startV26(w)
    const available = await inspect(w)
    if (!available.ok || available.value.status !== 'migration-available')
      throw new Error('Expected V27 migration receipt')
    const started = await start(w, available.value.sourceReceipt)
    if (!started.ok) throw new Error(started.reason)
    expect(await commit(w, 0, { ...started.value.lineage, seed: 'forged' },
      { kind: 'checkpoint' })).toEqual({ ok: false, reason: 'lineage-changed' })
    expect(await commit(w, 0, started.value.lineage,
      { kind: 'checkpoint', extra: true } as never))
      .toEqual({ ok: false, reason: 'invalid-witness' })
    const saved = await commit(w, 0, started.value.lineage, { kind: 'checkpoint' })
    if (!saved.ok) throw new Error(saved.reason)
    expect(await resume(w, 0, started.value.lineage)).toEqual({ ok: false, reason: 'revision-changed' })
    expect(await commit(w, 0, started.value.lineage, { kind: 'checkpoint' }))
      .toEqual({ ok: false, reason: 'revision-changed' })
    expect((await w.v27.readChecked())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1 } } })
  }, 30_000)
})
