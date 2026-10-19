import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createAtomicV25Store } from './atomicV25Database'
import { createAtomicV26Store } from './atomicV26Database'
import { createPublicV23Root } from './publicWorldV23Snapshot'
import { createPublicV24Root } from './publicWorldV24Snapshot'
import { createPublicV25Root } from './publicWorldV25Snapshot'
import { PUBLIC_V26_DATABASE_NAME } from './publicWorldV26Migration'
import { createPublicV26Root } from './publicWorldV26Snapshot'
import type { PublicV26Root } from './publicWorldV26Snapshot'

const oldRoot = () => {
  const { head, lineage } = createPublicV24Root(createPublicV23Root('wizard-realms'))
  return createPublicV25Root({ head, lineage })
}
const genesis = () => {
  const { head, lineage } = oldRoot()
  return createPublicV26Root({ head, lineage })
}
const checkpoint = (before: PublicV26Root): PublicV26Root => ({ lineage: structuredClone(before.lineage),
  previous: structuredClone(before.head), head: { ...structuredClone(before.head),
    saveRevision: before.head.saveRevision + 1, witness: { kind: 'checkpoint' } } })
async function valid(store: ReturnType<typeof createAtomicV26Store>, onPhase?: (sample: { phase: string }) => void) {
  const read = await store.readChecked(onPhase)
  if (read.status !== 'valid') throw new Error(`Expected valid V26 root, got ${read.status}`)
  return read
}
async function started(factory = new IDBFactory()) {
  const store = createAtomicV26Store(factory), missing = await store.readChecked()
  if (missing.status !== 'missing') throw new Error('Expected missing V26 root')
  expect(await store.commit(missing.proof, genesis())).toBe('committed')
  return store
}
async function putRaw(factory: IDBFactory, key: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PUBLIC_V26_DATABASE_NAME, 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put(value, key)
    tx.oncomplete = () => resolve()
  })
  db.close()
}

describe('atomic V26 root', () => {
  it('isolates genesis and revision writes from the V25 database, including a fresh reader', async () => {
    const factory = new IDBFactory(), old = createAtomicV25Store(factory)
    const oldMissing = await old.readChecked()
    if (oldMissing.status !== 'missing') throw new Error('Expected missing V25 root')
    const oldSaved = oldRoot()
    expect(await old.commit(oldMissing.proof, oldSaved)).toBe('committed')
    const store = createAtomicV26Store(factory), missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected missing V26 root')
    const input = genesis(), untouched = structuredClone(input)
    expect(await store.commit(missing.proof, input)).toBe('committed')
    expect(input).toEqual(untouched)
    input.head.state.player.coins++
    expect((await valid(store)).root).toEqual(untouched)
    const first = await valid(store), next = checkpoint(first.root)
    expect(await store.commit(first.proof, next)).toBe('committed')
    expect((await valid(createAtomicV26Store(factory))).root).toEqual(next)
    expect(await old.readChecked()).toMatchObject({ status: 'valid', root: oldSaved })
  })

  it('consumes proofs, rejects forged roots, and resolves competing CAS writes', async () => {
    const store = await started(), left = await valid(store), right = await valid(store)
    const next = checkpoint(left.root), forged = structuredClone(next)
    forged.head.state.player.coins++
    expect(await store.commit({}, next)).toBe('invalid')
    expect(await store.commit(left.proof, forged)).toBe('invalid')
    expect(await store.commit(left.proof, next)).toBe('invalid')
    const retry = await valid(store)
    expect((await Promise.all([store.commit(retry.proof, next),
      store.commit(right.proof, next)])).sort()).toEqual(['committed', 'revision-changed'])
    const later = await valid(store)
    expect(await store.commit(later.proof, next)).toBe('invalid')
  })

  it('rejects extra candidate keys, partial records, and warm-cache raw tampering', async () => {
    const factory = new IDBFactory(), store = createAtomicV26Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected missing V26 root')
    expect(await store.commit(missing.proof, { ...genesis(), extra: true } as never)).toBe('invalid')
    await putRaw(factory, 'stray', { stray: true })
    expect(await store.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v26-root' })
    const cleanFactory = new IDBFactory(), clean = await started(cleanFactory), hits: string[] = []
    const note = (sample: { phase: string }) => hits.push(sample.phase)
    const saved = await valid(clean, note)
    expect(hits).toContain('v26-validated-cache-hit')
    saved.root.head.state.player.coins++
    expect((await valid(createAtomicV26Store(cleanFactory))).root).toEqual(genesis())
    await putRaw(cleanFactory, 'root', { ...genesis(), extra: true })
    expect(await clean.readChecked()).toEqual({ status: 'blocked', reason: 'invalid-v26-root' })
  })

  it('waits for transaction completion and reports an aborted write as storage failure', async () => {
    const factory = new IDBFactory(), store = createAtomicV26Store(factory)
    const missing = await store.readChecked()
    if (missing.status !== 'missing') throw new Error('Expected missing V26 root')
    const original = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args) {
      const request = original.apply(this, args)
      if (this.transaction.db.name === PUBLIC_V26_DATABASE_NAME) this.transaction.abort()
      return request
    })
    try { expect(await store.commit(missing.proof, genesis())).toBe('storage-error') }
    finally { spy.mockRestore() }
    expect((await store.readChecked()).status).toBe('missing')
  })
})
