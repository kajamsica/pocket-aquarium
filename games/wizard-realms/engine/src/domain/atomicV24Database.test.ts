import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV23Store } from './atomicV23Database'
import { createAtomicV24Store } from './atomicV24Database'
import { createAtomicV17Store } from './atomicV17Database'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root, PUBLIC_V24_DATABASE_NAME } from './publicWorldV24Snapshot'
import type { PublicV24Root } from './publicWorldV24Snapshot'
import { commitPublicV17Snapshot, startFreshPublicV17 } from './publicWorldV17Flow'
import { inspectPublicV23, startPublicV23 } from './publicWorldV23Flow'
import { inspectPublicV24, startPublicV24 } from './publicWorldV24Flow'

const seed = 'greenway-alpha'
const source = () => createPublicV23Root(seed)
const genesis = (): PublicV24Root => createPublicV24Root(source())
const checkpoint = (before: PublicV24Root): PublicV24Root => ({
  lineage: structuredClone(before.lineage), previous: structuredClone(before.head),
  head: { ...structuredClone(before.head), saveRevision: before.head.saveRevision + 1,
    witness: { kind: 'checkpoint' } },
})
async function valid(store: ReturnType<typeof createAtomicV24Store>,
  onPhase?: Parameters<ReturnType<typeof createAtomicV24Store>['readChecked']>[0]) {
  const read = await store.readChecked(onPhase)
  if (read.status !== 'valid') throw new Error(`Expected valid V24 root, got ${read.status}`)
  return read
}
async function started(factory = new IDBFactory()) {
  const store = createAtomicV24Store(factory), missing = await store.readChecked()
  if (missing.status !== 'missing') throw new Error(`Expected missing V24 root, got ${missing.status}`)
  expect(await store.commit(missing.proof, genesis())).toBe('committed')
  return store
}
async function openRoot(factory: IDBFactory) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PUBLIC_V24_DATABASE_NAME, 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
const noteHit = (hits: number[]) => (sample: { phase: string }) => {
  if (sample.phase === 'v24-validated-cache-hit') hits.push(1)
}

describe('atomic V24 root', () => {
  it('returns detached hot roots and proofs with the same replay result as a cold instance', async () => {
    const factory = new IDBFactory(), warm = await started(factory)
    const hits: number[] = []
    const first = await valid(warm, noteHit(hits))
    expect(hits).toEqual([1])
    const original = structuredClone(first.root)
    first.root.head.state.discoveryMask[0] ^= 1
    first.root.head.state.player.coins++
    const second = await valid(warm, noteHit(hits))
    const coldStore = createAtomicV24Store(factory)
    const shared = await valid(coldStore, noteHit(hits))
    expect(shared.root).toEqual(original)
    expect(hits).toEqual([1, 1, 1])
    await createAtomicV24Store(new IDBFactory()).readChecked()
    const cold = await valid(coldStore, noteHit(hits))
    expect(hits).toEqual([1, 1, 1])
    expect((await valid(coldStore, noteHit(hits))).root).toEqual(original)
    expect(hits).toEqual([1, 1, 1, 1])
    expect(second.root).toEqual(original)
    expect(cold.root).toEqual(original)
    expect((await valid(warm, () => { throw new Error('trace failed') })).root).toEqual(original)
    expect(await warm.commit(first.proof, checkpoint(first.root))).toBe('invalid')
    const next = checkpoint(second.root)
    expect((await Promise.all([warm.commit(second.proof, next),
      coldStore.commit(cold.proof, next)])).sort())
      .toEqual(['committed', 'revision-changed'])
    expect((await valid(warm)).root).toEqual(next)
  })

  it('retains at most one factory-and-name-keyed V24 cache entry across store instances', async () => {
    const firstFactory = new IDBFactory(), first = await started(firstFactory)
    const sibling = createAtomicV24Store(firstFactory), hits: number[] = []
    expect((await valid(sibling, noteHit(hits))).root).toEqual((await valid(first)).root)
    expect(hits).toEqual([1])
    const secondFactory = new IDBFactory(), second = await started(secondFactory)
    expect((await valid(second, noteHit(hits))).status).toBe('valid')
    expect(hits).toEqual([1, 1])
    expect((await valid(sibling, noteHit(hits))).status).toBe('valid')
    expect(hits).toEqual([1, 1])
    expect((await valid(second, noteHit(hits))).status).toBe('valid')
    expect(hits).toEqual([1, 1])
  })

  it('promotes missing to valid while leaving the V23 source record untouched', async () => {
    const factory = new IDBFactory(), old = createAtomicV23Store(factory)
    const oldMissing = await old.readChecked()
    if (oldMissing.status !== 'missing') throw new Error('Expected missing V23 root')
    const oldRoot = { ...source(), previous: null }
    expect(await old.commit(oldMissing.proof, oldRoot)).toBe('committed')
    const oldBefore = await old.readChecked()
    const store = createAtomicV24Store(factory), missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected missing V24 root')
    const next = createPublicV24Root({ head: oldRoot.head, lineage: oldRoot.lineage })
    const phases: Array<{ phase: string; durationMs: number }> = []
    expect(await store.commit(missing.proof, next, (sample) => { phases.push(sample) })).toBe('committed')
    expect(phases.map((sample) => sample.phase)).toEqual([
      'atomic-candidate-preflight', 'idb-open', 'cas-read-put', 'transaction-completion'])
    expect(phases.every((sample) => Number.isFinite(sample.durationMs) && sample.durationMs >= 0))
      .toBe(true)
    expect((await valid(store)).root).toEqual(next)
    expect(await old.readChecked()).toMatchObject({ status: 'valid', root: oldBefore.status === 'valid'
      ? oldBefore.root : null })
  })

  it('consumes opaque proofs once and rejects forged or non-replayable candidates', async () => {
    const store = await started(), before = await valid(store), next = checkpoint(before.root)
    expect(await store.commit({}, next)).toBe('invalid')
    const forged = structuredClone(next)
    forged.head.state.player.coins++
    expect(await store.commit(before.proof, forged)).toBe('invalid')
    expect(await store.commit(before.proof, next)).toBe('invalid')
    expect((await valid(store)).root).toEqual(before.root)
    const retry = await valid(store)
    expect(await store.commit(retry.proof, next)).toBe('committed')
    const hits: number[] = []
    expect((await valid(store, noteHit(hits))).root).toEqual(next)
    expect(hits).toEqual([1])
  })

  it('enforces same-transaction CAS for concurrent readers and stale predecessors', async () => {
    const store = await started(), left = await valid(store), right = await valid(store)
    const next = checkpoint(left.root)
    const failedTrace = () => { throw new Error('trace failed') }
    expect((await Promise.all([store.commit(left.proof, next, failedTrace),
      store.commit(right.proof, next, failedTrace)])).sort())
      .toEqual(['committed', 'revision-changed'])
    const later = await valid(store)
    expect(await store.commit(later.proof, next)).toBe('invalid')
    expect((await valid(store)).root).toEqual(next)
  })

  it('blocks partial and tampered roots instead of treating them as missing', async () => {
    const factory = new IDBFactory(), store = createAtomicV24Store(factory)
    await store.readChecked()
    const db = await openRoot(factory)
    await new Promise<void>((resolve) => {
      const tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').put(genesis().lineage, 'lineage')
      tx.oncomplete = () => resolve()
    })
    db.close()
    expect(await store.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v24-root' })

    const corruptFactory = new IDBFactory(), validStore = await started(corruptFactory)
    const hits: number[] = []
    const saved = await valid(validStore, noteHit(hits)), altered = structuredClone(saved.root)
    expect(hits).toEqual([1])
    altered.head.state.player.coins++
    const corruptDb = await openRoot(corruptFactory)
    await new Promise<void>((resolve) => {
      const tx = corruptDb.transaction('records', 'readwrite')
      tx.objectStore('records').put(altered, 'root')
      tx.oncomplete = () => resolve()
    })
    corruptDb.close()
    expect(await validStore.readChecked(noteHit(hits)))
      .toEqual({ status: 'blocked', reason: 'invalid-v24-root' })
    expect(hits).toEqual([1])

    const extraFactory = new IDBFactory(), extraStore = await started(extraFactory)
    expect((await valid(extraStore, noteHit(hits))).status).toBe('valid')
    const extraDb = await openRoot(extraFactory)
    await new Promise<void>((resolve) => {
      const tx = extraDb.transaction('records', 'readwrite')
      tx.objectStore('records').put({ stray: true }, 'stray')
      tx.oncomplete = () => resolve()
    })
    extraDb.close()
    expect(await extraStore.readChecked(noteHit(hits)))
      .toEqual({ status: 'blocked', reason: 'invalid-v24-root' })
    expect(hits).toEqual([1, 1])
  })

  it('does not reuse warm validation for equal mask bytes with noncanonical backing', async () => {
    for (const offset of [0, 1]) {
      const factory = new IDBFactory(), store = await started(factory), hits: number[] = []
      const saved = await valid(store, noteHit(hits))
      expect(hits).toEqual([1])
      const raw = structuredClone(saved.root)
      const mask = raw.head.state.discoveryMask
      const view = new Uint8Array(new ArrayBuffer(mask.byteLength + 1), offset, mask.length)
      view.set(mask)
      const state = raw.head.state as { discoveryMask: Uint8Array }
      state.discoveryMask = view
      const db = await openRoot(factory)
      await new Promise<void>((resolve) => {
        const tx = db.transaction('records', 'readwrite')
        tx.objectStore('records').put(raw, 'root')
        tx.oncomplete = () => resolve()
      })
      db.close()
      expect(await store.readChecked(noteHit(hits)))
        .toEqual({ status: 'blocked', reason: 'invalid-v24-root' })
      expect(hits).toEqual([1])
    }
  })

  it('reports an aborted V24 write as storage failure without publishing or touching V23', async () => {
    const factory = new IDBFactory(), old = createAtomicV23Store(factory)
    const oldMissing = await old.readChecked()
    if (oldMissing.status !== 'missing') throw new Error('Expected missing V23 root')
    expect(await old.commit(oldMissing.proof, { ...source(), previous: null })).toBe('committed')
    const oldBefore = await old.readChecked(), store = createAtomicV24Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected missing V24 root')
    const original = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args) {
      const request = original.apply(this, args)
      if (this.transaction.db.name === PUBLIC_V24_DATABASE_NAME) this.transaction.abort()
      return request
    })
    try { expect(await store.commit(missing.proof, genesis())).toBe('storage-error') }
    finally { spy.mockRestore() }
    const hits: number[] = []
    expect((await store.readChecked(noteHit(hits))).status).toBe('missing')
    expect(hits).toEqual([])
    const retry = await store.readChecked()
    if (retry.status !== 'missing') throw new Error('Failed write seeded V24 root')
    expect(await store.commit(retry.proof, genesis())).toBe('committed')
    expect((await valid(store, noteHit(hits))).status).toBe('valid')
    expect(hits).toEqual([1])
    expect(await old.readChecked()).toMatchObject({ status: 'valid', root: oldBefore.status === 'valid'
      ? oldBefore.root : null })
  })

  it('does not let a warm V24 root hide transitive V17 source drift', async () => {
    const factory = new IDBFactory(), gate = { request: async <T,>(
      _name: string, _options: { mode: 'exclusive' }, body: () => T | Promise<T>) => body() }
    const v17 = createAtomicV17Store(factory), v23 = createAtomicV23Store(factory)
    const v24 = createAtomicV24Store(factory)
    const source = await startFreshPublicV17(gate, v17, seed)
    if (!source.ok) throw new Error(source.reason)
    const inspection = await inspectPublicV23(gate, v23, v17)
    if (!inspection.ok || inspection.value.status !== 'migration-available')
      throw new Error('Expected V17 promotion receipt')
    const migrated = await startPublicV23(gate, v23, v17, seed, inspection.value.sourceReceipt)
    if (!migrated.ok) throw new Error(migrated.reason)
    const promoted = await startPublicV24(gate, v24, v23, v17, seed,
      { head: migrated.value.head, lineage: migrated.value.lineage })
    if (!promoted.ok) throw new Error(promoted.reason)
    const hits: number[] = []
    expect((await valid(v24, noteHit(hits))).status).toBe('valid')
    expect(hits).toEqual([1])
    expect((await commitPublicV17Snapshot(gate, v17,
      { state: source.value.state, greenwayWorks: source.value.greenwayWorks },
      0, source.value.lineage)).ok).toBe(true)
    expect(await inspectPublicV24(gate, v24, v23, v17))
      .toEqual({ ok: true, value: { status: 'blocked', reason: 'source-changed' } })
  })
})
