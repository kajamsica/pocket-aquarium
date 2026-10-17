/** The V43 promotion fence must preserve the checked V42 root and reject old writers. */
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
// Initialize the established V41 ancestry before V42's cross-version module graph.
import './atomicV41Database'
import { createAtomicV42Store } from './atomicV42Database'
import type { AtomicV42StoreTrace } from './atomicV42Database'
import { createFreshPublicV42Root, decodePublicV42CheckedSuccessor,
  PUBLIC_V42_DATABASE_NAME, replayPublicV42Witness } from './publicWorldV42Snapshot'
import type { PublicV42Root } from './publicWorldV42Snapshot'

const seed = 'wizard-realms'
const idle = { kind: 'frame-batch/v1' as const,
  frames: [{ intents: [], walkRequested: true }] }

function successor(root: PublicV42Root): PublicV42Root {
  const progress = replayPublicV42Witness(root.head, idle)
  if (!progress) throw new Error('Expected V42 idle frame')
  const next = { lineage: root.lineage, previous: root.head,
    head: { ...progress, schemaVersion: root.head.schemaVersion,
      saveRevision: root.head.saveRevision + 1, witness: idle } }
  if (!decodePublicV42CheckedSuccessor(root, next)) throw new Error('Invalid V42 test edge')
  return next
}

async function record(factory: IDBFactory, key: string, next?: unknown): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PUBLIC_V42_DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('records', next === undefined ? 'readonly' : 'readwrite')
      const records = tx.objectStore('records')
      const request = next === undefined ? records.get(key) : records.put(next, key)
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}

describe('atomic V42 successor fence', () => {
  it('reports only numeric, opt-in store subphases without changing checked records', async () => {
    const factory = new IDBFactory(), store = createAtomicV42Store(factory)
    await record(factory, 'root', createFreshPublicV42Root(seed))
    const samples: Parameters<AtomicV42StoreTrace>[0][] = []
    const read = await store.readChecked((sample) => samples.push(sample))
    if (read.status !== 'valid') throw new Error('Expected checked root')
    expect(samples.map(({ operation, phase }) => [operation, phase])).toEqual([
      ['readChecked', 'open'], ['readChecked', 'transaction'],
      ['readChecked', 'request-wait'], ['readChecked', 'tx-completion'],
      ['readChecked', 'decode'], ['readChecked', 'clone'],
    ])
    const expected = successor(read.root)
    expect(await store.commit(read.proof, expected, (sample) => samples.push(sample)))
      .toBe('committed')
    expect(samples.slice(6).map(({ operation, phase }) => [operation, phase])).toEqual([
      ['commit', 'validate'], ['commit', 'candidate-clone'], ['commit', 'open'],
      ['commit', 'transaction'], ['commit', 'request-wait'], ['commit', 'cas'],
      ['commit', 'put'], ['commit', 'tx-completion'],
    ])
    for (const sample of samples) {
      expect(Object.keys(sample).sort()).toEqual(['durationMs', 'operation', 'phase'])
      expect(Number.isFinite(sample.durationMs)).toBe(true)
      expect(sample.durationMs).toBeGreaterThanOrEqual(0)
    }
    expect(await record(factory, 'root')).toEqual(expected)
    expect(await record(factory, 'v43-successor')).toBeUndefined()
  }, 30000)

  it('ignores a failing trace and still enforces one-use proof and stale CAS', async () => {
    const factory = new IDBFactory(), store = createAtomicV42Store(factory)
    await record(factory, 'root', createFreshPublicV42Root(seed))
    const badTrace: AtomicV42StoreTrace = () => { throw new Error('trace failed') }
    const stale = await store.readChecked(badTrace)
    const current = await store.readChecked()
    if (stale.status !== 'valid' || current.status !== 'valid')
      throw new Error('Expected checked roots')
    expect(await store.commit(current.proof, successor(current.root), badTrace))
      .toBe('committed')
    expect(await store.commit(stale.proof, successor(stale.root), badTrace))
      .toBe('revision-changed')
    expect(await store.commit(stale.proof, successor(stale.root), badTrace))
      .toBe('invalid')
    expect((await store.readChecked(badTrace)).status).toBe('valid')
  }, 30000)

  it('co-creates a checked fresh root and pending fence before old V42 can write', async () => {
    const factory = new IDBFactory(), store = createAtomicV42Store(factory)
    const oldTab = createAtomicV42Store(factory)
    const stale = await oldTab.readChecked()
    if (stale.status !== 'missing') throw new Error('Expected empty V42 store')
    expect(await store.bootstrapFreshSuccessor(seed)).toBe('committed')
    const promotion = await store.readForPromotion()
    if (promotion.status !== 'valid') throw new Error('Expected checked bootstrap')
    expect(promotion.root).toEqual(createFreshPublicV42Root(seed))
    expect(promotion.marker).toEqual({ schemaVersion: 'v43-successor/v1',
      phase: 'pending', sourceRevision: 0,
      sourceFingerprint: promotion.sourceFingerprint })
    expect((await oldTab.readChecked()).status).toBe('blocked')
    expect(await oldTab.commit(stale.proof, createFreshPublicV42Root(seed)))
      .toBe('revision-changed')
    expect(await store.bootstrapFreshSuccessor(seed)).toBe('revision-changed')
    expect((await store.readForPromotion())).toMatchObject({ status: 'valid',
      marker: { phase: 'pending' } })
  }, 30000)

  it('requires zero V42 records and preserves existing or malformed records', async () => {
    for (const [key, raw] of [
      ['root', createFreshPublicV42Root(seed)],
      ['root', { malformed: true }],
      ['unexpected', { unrelated: true }],
    ] as const) {
      const factory = new IDBFactory(), store = createAtomicV42Store(factory)
      await record(factory, key, raw)
      expect(await store.bootstrapFreshSuccessor(seed)).toBe('revision-changed')
      expect(await record(factory, key)).toEqual(raw)
      expect(await record(factory, 'v43-successor')).toBeUndefined()
    }
    const factory = new IDBFactory(), store = createAtomicV42Store(factory)
    const results = await Promise.all([
      store.bootstrapFreshSuccessor(seed), store.bootstrapFreshSuccessor(seed)])
    expect(results.sort()).toEqual(['committed', 'revision-changed'])
  }, 30000)

  it('rejects unsupported developer seeds without creating either record', async () => {
    const factory = new IDBFactory(), store = createAtomicV42Store(factory)
    expect(await store.bootstrapFreshSuccessor('wizard-realms-dev')).toBe('invalid-seed')
    expect(await store.readForPromotion()).toEqual({ status: 'missing' })
    expect(await record(factory, 'root')).toBeUndefined()
    expect(await record(factory, 'v43-successor')).toBeUndefined()
  }, 30000)

  it('rolls back both records when the pending-marker write transaction aborts', async () => {
    const factory = new IDBFactory(), store = createAtomicV42Store(factory)
    const original = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(
      function(this: IDBObjectStore, ...args) {
        const request = original.apply(this, args)
        if (this.transaction.db.name === PUBLIC_V42_DATABASE_NAME
          && args[1] === 'v43-successor')
          request.addEventListener('success', () => this.transaction.abort())
        return request
      })
    try { expect(await store.bootstrapFreshSuccessor(seed)).toBe('storage-error') }
    finally { spy.mockRestore() }
    expect(await store.readForPromotion()).toEqual({ status: 'missing' })
    expect(await record(factory, 'root')).toBeUndefined()
    expect(await record(factory, 'v43-successor')).toBeUndefined()
    expect(await store.bootstrapFreshSuccessor(seed)).toBe('committed')
  }, 30000)

  it('reserves and finalizes idempotently while old readers and writers fail closed', async () => {
    const factory = new IDBFactory(), oldTab = createAtomicV42Store(factory)
    const store = createAtomicV42Store(factory), root = createFreshPublicV42Root(seed)
    await record(factory, 'root', root)
    const beforeBytes = JSON.stringify(await record(factory, 'root'))
    const old = await oldTab.readChecked()
    if (old.status !== 'valid') throw new Error('Expected checked old tab')
    const read = await store.readForPromotion()
    if (read.status !== 'valid') throw new Error('Expected checked source')
    expect(read.marker).toBeNull()
    expect(read.sourceFingerprint).toMatch(/^v42-canonical-sha256\/v1:[0-9a-f]{64}$/)
    expect(await store.transitionSuccessor(read.proof, 'pending')).toBe('committed')
    expect(await store.transitionSuccessor(read.proof, 'pending')).toBe('invalid')
    expect(await oldTab.commit(old.proof, successor(old.root))).toBe('revision-changed')
    expect(await oldTab.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v42-root' })
    expect(JSON.stringify(await record(factory, 'root'))).toBe(beforeBytes)

    const pending = await store.readForPromotion()
    if (pending.status !== 'valid') throw new Error('Expected pending marker')
    expect(pending.marker).toMatchObject({ phase: 'pending', sourceRevision: 0,
      sourceFingerprint: read.sourceFingerprint })
    expect(await store.transitionSuccessor(pending.proof, 'pending')).toBe('unchanged')
    const finalize = await store.readForPromotion()
    const staleMarker = await store.readForPromotion()
    if (finalize.status !== 'valid') throw new Error('Expected pending marker')
    expect(await store.transitionSuccessor(finalize.proof, 'finalized')).toBe('committed')
    if (staleMarker.status !== 'valid') throw new Error('Expected pending marker')
    expect(await store.transitionSuccessor(staleMarker.proof, 'conflict'))
      .toBe('revision-changed')
    const finalized = await store.readForPromotion()
    if (finalized.status !== 'valid') throw new Error('Expected finalized marker')
    expect(finalized.marker?.phase).toBe('finalized')
    expect(await store.transitionSuccessor(finalized.proof, 'finalized')).toBe('unchanged')
    expect(JSON.stringify(await record(factory, 'root'))).toBe(beforeBytes)
  }, 30000)

  it('rejects a changed checked V42 source before reserving', async () => {
    const factory = new IDBFactory(), store = createAtomicV42Store(factory)
    await record(factory, 'root', createFreshPublicV42Root(seed))
    const promotion = await store.readForPromotion(), writer = await store.readChecked()
    if (promotion.status !== 'valid' || writer.status !== 'valid')
      throw new Error('Expected checked reads')
    expect(await store.commit(writer.proof, successor(writer.root))).toBe('committed')
    expect(await store.transitionSuccessor(promotion.proof, 'pending'))
      .toBe('revision-changed')
    expect(await record(factory, 'v43-successor')).toBeUndefined()
    expect((await store.readForPromotion())).toMatchObject({ status: 'valid',
      root: { head: { saveRevision: 1 } }, marker: null })
  }, 30000)

  it('rejects malformed markers and makes conflict terminal without changing root bytes', async () => {
    const factory = new IDBFactory(), store = createAtomicV42Store(factory)
    await record(factory, 'root', createFreshPublicV42Root(seed))
    const read = await store.readForPromotion()
    if (read.status !== 'valid') throw new Error('Expected source')
    const bytes = JSON.stringify(await record(factory, 'root'))
    expect(await store.transitionSuccessor(read.proof, 'finalized')).toBe('invalid')
    const reserve = await store.readForPromotion()
    if (reserve.status !== 'valid') throw new Error('Expected source')
    expect(await store.transitionSuccessor(reserve.proof, 'pending')).toBe('committed')
    const pending = await store.readForPromotion()
    if (pending.status !== 'valid') throw new Error('Expected pending')
    expect(await store.transitionSuccessor(pending.proof, 'conflict')).toBe('committed')
    const conflict = await store.readForPromotion()
    if (conflict.status !== 'valid') throw new Error('Expected conflict')
    expect(await store.transitionSuccessor(conflict.proof, 'conflict')).toBe('unchanged')
    const blocked = await store.readForPromotion()
    if (blocked.status !== 'valid') throw new Error('Expected conflict')
    expect(await store.transitionSuccessor(blocked.proof, 'finalized')).toBe('invalid')
    expect(JSON.stringify(await record(factory, 'root'))).toBe(bytes)
    await record(factory, 'v43-successor', { phase: 'pending' })
    expect(await store.readForPromotion()).toEqual({ status: 'blocked',
      reason: 'invalid-successor-marker' })
    expect((await store.readChecked()).status).toBe('blocked')
    expect(JSON.stringify(await record(factory, 'root'))).toBe(bytes)
  }, 30000)
})
